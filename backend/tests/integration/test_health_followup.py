"""SX-24C: personal schedules create Crew-only follow-ups and emergency priority."""

from test_golden_step import GOLDEN_START, _step
from test_runs import authenticate, local_client


def test_reminder_uses_personal_schedule(tmp_path):
    with local_client(tmp_path / "health-followup.sqlite3") as client:
        credentials = client.post("/api/v1/demo/session").json()
        authenticate(client, "facilitator")
        run = client.post("/api/v1/runs", json=GOLDEN_START)
        assert run.status_code == 200, run.text
        run_id = run.json()["run_id"]
        root = f"/api/v1/runs/{run_id}"

        authenticate(client, "crew")
        reading_ids = []

        def save_reading(index, value, observed_at_s, received_at_s):
            reading = {
                "measurement_id": f"followup-heart-rate-{index}",
                "crew_id": "SIM-01",
                "synthetic": True,
                "measurement": {
                    "metric": "heart_rate", "value": value, "unit": "bpm",
                    "quality": "valid", "observed_at_s": observed_at_s,
                    "source_id": "synthetic.watch.sim-01",
                },
                "context": {"activity": "rest"},
            }
            saved = client.post(root + "/crew/measurements", json=reading)
            assert saved.status_code == 201, saved.text
            assert saved.json()["received_at_s"] == received_at_s
            reading_ids.append(reading["measurement_id"])

        save_reading(1, 72, 0, 0)

        # The one-minute personal demo interval is crossed on the mission clock.
        stepped = _step(client, run_id, advance_id="followup-to-60", expected_step=0, target_mission_s=60)
        assert stepped.status_code == 200, stepped.text
        assert stepped.json()["mission_s"] == 60
        authenticate(client, "crew")
        save_reading(2, 80, 30, 60)
        save_reading(3, 95, 60, 60)
        stepped = _step(client, run_id, advance_id="followup-to-360", expected_step=1, target_mission_s=360)
        assert stepped.status_code == 200, stepped.text
        assert stepped.json()["mission_s"] == 360
        authenticate(client, "crew")
        crew = client.get(root + "/crew").json()
        [overdue] = crew["health_reminders"]
        assert overdue["status"] == "overdue"
        assert overdue["due_at_s"] == 360
        assert overdue["last_accepted_at_s"] == 60
        assert overdue["assessment_id"] == reading_ids[-1]
        assert overdue["trend_status"] == "review"
        assert overdue["evidence_ids"] == reading_ids
        assert overdue["action"] == "review_assessment"
        assert overdue["designated_role"] == "authorized onboard reviewer"

        ack_url = root + f"/crew/reminders/{overdue['reminder_id']}/ack"
        acknowledged = client.post(ack_url)
        assert acknowledged.status_code == 200, acknowledged.text
        assert acknowledged.json()["status"] == "acknowledged"
        assert acknowledged.json()["acknowledgment"] == {
            "acknowledged_by": "SIM-01", "acknowledged_at_s": 360,
        }
        assert client.post(ack_url).json() == acknowledged.json()

        # Cross the next personal interval without recording a repeat. The
        # prior acknowledgment stays visible while the current occurrence is overdue.
        stepped = _step(client, run_id, advance_id="followup-to-480", expected_step=2, target_mission_s=480)
        assert stepped.status_code == 200, stepped.text
        authenticate(client, "crew")
        reminders = client.get(root + "/crew").json()["health_reminders"]
        assert {item["status"] for item in reminders} == {"overdue", "acknowledged"}
        assert len({item["reminder_id"] for item in reminders}) == 2

        # Emergency opens onboard immediately even though the routine repeat is overdue.
        emergency = client.post(root + "/crew/emergencies", json={
            "operation_id": "followup-emergency",
            "drill_id": "drill-chest-pain-v1",
            "reported_by": "SIM-01",
            "synthetic": True,
        })
        assert emergency.status_code == 201, emergency.text
        crew = client.get(root + "/crew").json()
        assert crew["emergency_precedence"] is True
        assert {item["status"] for item in crew["health_reminders"]} == {"overdue", "acknowledged"}
        assert client.post(
            root + f"/crew/reminders/{next(item['reminder_id'] for item in reminders if item['status'] == 'overdue')}/ack"
        ).status_code == 409

        ground = client.get(root + "/ground", headers={
            "Authorization": f"Bearer {credentials['ground']}",
        })
        assert ground.status_code == 200
        assert "health_reminders" not in ground.text
        assert "followup-heart-rate-1" not in ground.text
