from test_runs import START, local_client

SUSPECT = "crew-wearables-v1:SIM-02:wrist-motion"
REPEAT = "crew-wearables-v1:SIM-02:wrist-recheck"


def start_wearable_run(client, headers, start_id):
    response = client.post(
        "/api/v1/runs", headers=headers["facilitator"],
        json={**START, "scenario_id": "crew-wearables", "start_id": start_id},
    )
    assert response.status_code == 200, response.text
    return f"/api/v1/runs/{response.json()['run_id']}"


def advance(client, headers, base, start, stop):
    for step in range(start, stop):
        command = {"advance_id": f"advance-{step}", "expected_step": step}
        response = client.post(base + "/advance", headers=headers["facilitator"], json=command)
        assert response.status_code == 200, response.text
        assert client.post(base + "/advance", headers=headers["facilitator"], json=command).json() == response.json()


def setup(client):
    return {
        role: {"Authorization": "Bearer " + token}
        for role, token in client.post("/api/v1/demo/session").json().items()
    }


def snapshot(client, headers, base, crew_id="SIM-02"):
    response = client.get(base + "/crew/wearables", params={"crew_id": crew_id}, headers=headers["crew"])
    assert response.status_code == 200, response.text
    return response.json()


def command(client, headers, base, task, action, observer="SIM-03", role="crew"):
    return client.post(
        base + "/crew/wearables/rechecks/" + task["task_id"], params={"crew_id": "SIM-02"},
        headers=headers[role], json={"action": action, "observer_id": observer},
    )


def test_suspect_wearable_sample_creates_one_recheck_and_resolution(tmp_path):
    with local_client(tmp_path / "recheck.sqlite3") as client:
        headers = setup(client)
        base = start_wearable_run(client, headers, "original")
        other = start_wearable_run(client, headers, "second")
        advance(client, headers, base, 0, 5)
        assert snapshot(client, headers, base)["recheck"] is None
        advance(client, headers, base, 5, 7)
        held = snapshot(client, headers, base)
        assert held["resting_trend"]["sample_count"] == 3
        assert SUSPECT not in held["resting_trend"]["evidence_ids"]
        assert held["channels"]["wristband"]["reading"]["evidence"]["event_id"] == SUSPECT
        assert held["channels"]["back_pod"]["reading"]["accepted"]["value"] == 0.8

        offer = held["recheck"]
        assert offer["opened_at_s"] == 72
        assert offer["status"] == "offered"
        assert offer["evidence_ids"] == [SUSPECT]
        assert snapshot(client, headers, base)["recheck"] == offer
        assert snapshot(client, headers, base, "SIM-03")["recheck"] is None
        assert command(client, headers, other, offer, "assign").status_code == 404
        assert command(client, headers, base, offer, "assign", role="ground").status_code == 403
        assert command(client, headers, base, offer, "assign", observer="SIM-02").status_code == 409
        assert command(client, headers, base, offer, "record").json()["detail"] == "RECHECK_NOT_ASSIGNED"

        assigned = command(client, headers, base, offer, "assign").json()
        assert assigned["status"] == "assigned"
        assert assigned["observer_id"] == "SIM-03"
        assert assigned["assigned_at_s"] == 90
        assert command(client, headers, base, offer, "assign").json() == assigned
        assert command(client, headers, base, offer, "record").json()["detail"] == "REPEAT_EVIDENCE_UNAVAILABLE"
        advance(client, headers, base, 7, 8)
        assert command(client, headers, base, offer, "record", observer="SIM-01").status_code == 409
        result = command(client, headers, base, offer, "record")
        assert result.status_code == 200, result.text
        verified = result.json()
        assert verified["status"] == "verified"
        assert verified["completed_at_s"] == 100
        assert verified["evidence_ids"] == [SUSPECT, REPEAT]
        assert command(client, headers, base, offer, "record").json() == verified

        persisted = snapshot(client, headers, base)
        assert persisted["recheck"] == verified
        wrist = persisted["channels"]["wristband"]
        assert [sample["event_id"] for sample in wrist["history"]].count(REPEAT) == 1
        repeat = wrist["reading"]["accepted"]
        assert (repeat["event_id"], repeat["quality"], repeat["value"]) == (REPEAT, "valid", 96)
        assert repeat["context"]["observer_id"] == "SIM-03"
        assert repeat["context"]["repeat_of_event_id"] == SUSPECT
        assert persisted["resting_trend"] == held["resting_trend"]
        assert snapshot(client, headers, other)["recheck"] is None
        advance(client, headers, other, 0, 7)
        other_offer = snapshot(client, headers, other)["recheck"]
        assert other_offer["status"] == "offered" and other_offer["task_id"] != offer["task_id"]
        assert command(client, headers, other, offer, "assign").status_code == 404
        ground = client.get(base + "/ground", headers=headers["ground"])
        assert ground.status_code == 200
        assert all(evidence not in ground.text for evidence in (SUSPECT, REPEAT, "wearable_recheck", "SIM-03"))


def test_busy_or_expired_recheck_stays_held(tmp_path):
    with local_client(tmp_path / "hold.sqlite3") as client:
        headers = setup(client)
        base = start_wearable_run(client, headers, "holds")
        advance(client, headers, base, 0, 6)
        busy = snapshot(client, headers, base)["recheck"]
        assert (busy["status"], busy["reason_code"]) == ("held", "OBSERVER_UNAVAILABLE")
        assert busy["available_observers"] == []
        assert command(client, headers, base, busy, "assign").json()["detail"] == "OBSERVER_UNAVAILABLE"

        advance(client, headers, base, 6, 7)
        assert command(client, headers, base, busy, "assign").json()["status"] == "assigned"
        advance(client, headers, base, 7, 9)
        expired = snapshot(client, headers, base)
        assert (expired["recheck"]["status"], expired["recheck"]["reason_code"]) == ("held", "EXPIRED")
        assert command(client, headers, base, busy, "record").json()["detail"] == "EXPIRED"
        assert REPEAT not in expired["recheck"]["evidence_ids"]
        assert all(sample["event_id"] != REPEAT for sample in expired["channels"]["wristband"]["history"])
