"""SX-24C: reminders follow the personal schedule; emergency takes precedence."""

from test_runs import local_client

GOLDEN = {"start_id": "followup", "scenario_id": "sx01-golden", "scenario_version": "1", "seed": 4242}
STEPS_S = (60, 360, 480, 600, 780)


def heart_rate(measurement_id, value, observed_at_s, context=None, quality="valid"):
    measurement = {"metric": "heart_rate", "unit": "bpm", "quality": quality,
                   "observed_at_s": observed_at_s, "source_id": "synthetic.watch.sim-01"}
    if quality != "unavailable":
        measurement["value"] = value
    return {"measurement_id": measurement_id, "crew_id": "SIM-01", "synthetic": True,
            "measurement": measurement, "context": {"activity": "rest"} if context is None else context}


def test_reminder_uses_personal_schedule(tmp_path):
    with local_client(tmp_path / "followup.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        run_id = client.post("/api/v1/runs", json=GOLDEN, headers=role("facilitator")).json()["run_id"]
        url = f"/api/v1/runs/{run_id}"
        step = iter(range(len(STEPS_S)))

        def advance_to(seconds):
            index = next(step)
            assert STEPS_S[index] == seconds
            response = client.post(f"{url}/advance", headers=role("facilitator"),
                                   json={"advance_id": f"to-{seconds}", "expected_step": index})
            assert response.json()["mission_s"] == seconds, response.text

        def followup():
            return client.get(f"{url}/crew", headers=role("crew")).json()["health_followup"]

        def by_metric(view):
            return {r["metric"]: r for r in view["reminders"]}

        # 00:00 — a resting heart rate outside the personal range is accepted.
        saved = client.post(f"{url}/crew/measurements", headers=role("crew"), json=heart_rate("hr-1", 95, 0))
        assert saved.status_code == 201, saved.text
        view = followup()
        assert view["schedule_version"] == "personal-monitoring-v1"
        assert view["precedence"] == "routine" and view["synthetic"] is True
        hr, bp = by_metric(view)["heart_rate"], by_metric(view)["blood_pressure"]
        assert (hr["last_accepted_at_s"], hr["due_at_s"], hr["status"]) == (0, 300, "scheduled")
        assert hr["action"] == "review_with_designated_role" and "SIM-02" in hr["reason"]
        assert (bp["last_accepted_at_s"], bp["due_at_s"], bp["status"]) == (None, 300, "scheduled")
        assert bp["action"] == "routine_check"

        # 01:00 — still before the due window.
        advance_to(60)
        assert {r["status"] for r in followup()["reminders"]} == {"scheduled"}

        # 06:00 — the fixed clock crosses the 05:00 due time: both overdue by one minute.
        advance_to(360)
        hr, bp = by_metric(followup())["heart_rate"], by_metric(followup())["blood_pressure"]
        assert (hr["status"], hr["overdue_by_s"]) == ("overdue", 60)
        assert (bp["status"], bp["overdue_by_s"]) == ("overdue", 60)

        # Acknowledge one: one overdue and one acknowledged reminder are distinguishable.
        ack_url = f"{url}/crew/reminders/{bp['reminder_id']}/acknowledgment"
        assert client.post(ack_url, headers=role("ground"),
                           json={"crew_id": "SIM-01", "acknowledged_by": "SIM-01"}).status_code == 403
        assert client.post(ack_url, headers=role("crew"),
                           json={"crew_id": "SIM-01", "acknowledged_by": "SIM-03"}).status_code == 422
        acked = client.post(ack_url, headers=role("crew"), json={"crew_id": "SIM-01", "acknowledged_by": "SIM-01"})
        assert acked.status_code == 200, acked.text
        assert (acked.json()["status"], acked.json()["acknowledged_at_s"]) == ("acknowledged", 360)
        assert client.post(ack_url, headers=role("crew"),
                           json={"crew_id": "SIM-01", "acknowledged_by": "SIM-01"}).json() == acked.json()
        statuses = {r["metric"]: r["status"] for r in followup()["reminders"]}
        assert statuses == {"heart_rate": "overdue", "blood_pressure": "acknowledged"}

        # A new accepted reading resets that metric's due time; an unassessable one asks for a repeat.
        advance_to(480)
        client.post(f"{url}/crew/measurements", headers=role("crew"), json=heart_rate("hr-2", 74, 480, context={}))
        hr = by_metric(followup())["heart_rate"]
        assert (hr["last_accepted_at_s"], hr["due_at_s"], hr["status"]) == (480, 780, "scheduled")
        assert hr["action"] == "repeat_measurement"

        # 13:00 — overdue again, with a repeat suggested. Emergency does not wait for that repeat.
        advance_to(600)
        advance_to(780)
        assert by_metric(followup())["heart_rate"]["status"] == "due"
        opened = client.post(f"{url}/crew/emergencies", headers=role("crew"), json={
            "operation_id": "chest-pain-1", "drill_id": "drill-chest-pain-v1",
            "reported_by": "SIM-01", "synthetic": True})
        assert opened.status_code == 201, opened.text
        case = opened.json()
        assert (case["status"], case["opened_at_s"], case["escalation"]["level"]) == ("open", 780, "local_alert")

        view = followup()
        assert view["precedence"] == "emergency"
        assert view["emergency"] == {"case_id": case["case_id"], "kind": "chest_pain", "opened_at_s": 780}
        reminders = by_metric(view)
        assert reminders["heart_rate"]["deferred_by_emergency"] is True
        # The acknowledged reminder keeps its due instance (no new reading) and is not deferred.
        assert reminders["blood_pressure"]["reminder_id"] == bp["reminder_id"]
        assert (reminders["blood_pressure"]["status"], reminders["blood_pressure"]["deferred_by_emergency"]) == (
            "acknowledged", False)

        # A local acknowledgment records the responder without resolving the emergency.
        emergency_ack = client.post(
            f"{url}/crew/emergencies/{case['case_id']}/acknowledgment",
            headers=role("crew"), json={"acknowledged_by": "SIM-02"},
        )
        assert emergency_ack.status_code == 200, emergency_ack.text
        view = followup()
        assert view["precedence"] == "emergency" and view["emergency"]["case_id"] == case["case_id"]
        assert by_metric(view)["heart_rate"]["deferred_by_emergency"] is True
        assert by_metric(view)["blood_pressure"]["deferred_by_emergency"] is False

        # Reminders are Crew-private: Ground's projection carries none of them.
        ground = client.get(f"{url}/ground", headers=role("ground")).text
        assert "health_followup" not in ground and "rem-SIM-01" not in ground


def test_reminder_schedule_starts_from_acceptance_time(tmp_path):
    """A delayed sample starts its personal interval when Crew accepts it, not when observed."""
    with local_client(tmp_path / "followup-received-time.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        run = client.post("/api/v1/runs", json={**GOLDEN, "start_id": "followup-received-time"},
                          headers=role("facilitator"))
        run_id = run.json()["run_id"]
        url = f"/api/v1/runs/{run_id}"

        to_60 = client.post(f"{url}/advance", headers=role("facilitator"),
                            json={"advance_id": "received-to-60", "expected_step": 0})
        assert to_60.status_code == 200 and to_60.json()["mission_s"] == 60
        reading = heart_rate("delayed-hr", 95, 0)
        saved = client.post(f"{url}/crew/measurements", headers=role("crew"), json=reading)
        assert saved.status_code == 201 and saved.json()["received_at_s"] == 60

        to_360 = client.post(f"{url}/advance", headers=role("facilitator"),
                             json={"advance_id": "received-to-360", "expected_step": 1,
                                   "target_mission_s": 360})
        assert to_360.status_code == 200 and to_360.json()["mission_s"] == 360
        crew = client.get(f"{url}/crew", headers=role("crew")).json()
        hr = next(item for item in crew["health_followup"]["reminders"] if item["metric"] == "heart_rate")
        assert (hr["last_accepted_at_s"], hr["due_at_s"], hr["status"]) == (60, 360, "due")
