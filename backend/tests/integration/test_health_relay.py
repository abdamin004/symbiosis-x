"""SX-25C: Ground receives only the approved, delayed status of an onboard health case."""

import hashlib
import json
import sqlite3
from contextlib import closing

from test_runs import local_client

GOLDEN_START = {"start_id": "health-relay", "scenario_id": "sx01-golden", "scenario_version": "1", "seed": 4242}
DRILL = {"operation_id": "op-chest-pain", "drill_id": "drill-chest-pain-v1",
         "reported_by": "SIM-01", "synthetic": True}
PRIVATE_MARKER = "PRIVATE-MARKER-sx25c"
# Everything that identifies the person, the drill or onboard timing must stay onboard.
PRIVATE_FIELDS = ("case-drill-chest-pain-v1", "drill-chest-pain-v1", "chest", "SIM-01", "SIM-02",
                  "training-placeholder", "opened_at_s", "acknowledged_by", "responsiveness", "vitals",
                  PRIVATE_MARKER)


def roles(client):
    tokens = client.post("/api/v1/demo/session").json()
    return lambda who: {"Authorization": "Bearer " + tokens[who]}


def step(client, as_role, run_id, advance_id, expected_step, target):
    response = client.post(f"/api/v1/runs/{run_id}/advance", headers=as_role("facilitator"),
                           json={"advance_id": advance_id, "expected_step": expected_step,
                                 "target_mission_s": target})
    assert response.status_code == 200, response.text


def assert_private_fields_absent(text):
    for marker in PRIVATE_FIELDS:
        assert marker not in text, marker


def test_delayed_case_packet_is_minimal(tmp_path):
    database = tmp_path / "health-relay.sqlite3"
    with local_client(database) as client:
        as_role = roles(client)
        run_id = client.post("/api/v1/runs", json=GOLDEN_START, headers=as_role("facilitator")).json()["run_id"]
        runs = f"/api/v1/runs/{run_id}"
        checkin = client.post(f"{runs}/crew/check-ins", headers=as_role("crew"), json={
            "check_in_id": "private-01", "crew_id": "SIM-01", "note": PRIVATE_MARKER, "synthetic": True})
        assert checkin.status_code == 201, checkin.text

        case = client.post(f"{runs}/crew/emergencies", json=DRILL, headers=as_role("crew")).json()
        share = client.post(f"{runs}/crew/emergencies/{case['case_id']}/relay",
                            json={"operation_id": "share-01"}, headers=as_role("crew"))
        assert share.status_code == 200, share.text
        receipt = share.json()
        alias = receipt["case_alias"]
        assert receipt == {"operation_id": "share-01", "case_alias": alias, "review_priority": "urgent",
                           "status": "open", "issued_at_s": 0, "deliver_at_s": 300}
        assert alias.startswith("health-case-")
        # A retry returns the same receipt; reusing the ID for another case is refused.
        assert client.post(f"{runs}/crew/emergencies/{case['case_id']}/relay",
                           json={"operation_id": "share-01"}, headers=as_role("crew")).json() == receipt
        assert client.post(f"{runs}/crew/emergencies/{case['case_id']}/relay", json={"operation_id": "share-01"},
                           headers=as_role("ground")).status_code == 403
        # The alias is random, not a hash Ground could recompute from the run and drill IDs.
        assert hashlib.sha256(f"{run_id}:{case['case_id']}".encode()).hexdigest()[:10] not in alias

        # Before delivery Ground has nothing about the case, and cannot acknowledge it.
        step(client, as_role, run_id, "to-60", 0, 60)
        pending = client.get(f"{runs}/ground", headers=as_role("ground"))
        assert pending.json()["health_cases"] == []
        assert_private_fields_absent(pending.text)
        assert alias not in pending.text
        early = client.post(f"{runs}/ground/health-cases/{alias}/acknowledgment", headers=as_role("ground"))
        assert (early.status_code, early.json()) == (404, {"detail": "CASE_NOT_DELIVERED"})

        # Crew acknowledges locally while Ground is still waiting: no Ground step gates it.
        local = client.post(f"{runs}/crew/emergencies/{case['case_id']}/acknowledgment",
                            json={"acknowledged_by": "SIM-02"}, headers=as_role("crew"))
        assert local.status_code == 200 and local.json()["status"] == "acknowledged"

        step(client, as_role, run_id, "to-360", 1, 360)
        delivered = client.get(f"{runs}/ground", headers=as_role("ground"))
        assert delivered.json()["health_cases"] == [{
            "case_alias": alias, "review_priority": "urgent", "status": "open",
            "delivered_at_s": 300, "ground_ack": "pending", "ground_acknowledged_at_s": None,
        }]
        assert_private_fields_absent(delivered.text)

        acknowledged = client.post(f"{runs}/ground/health-cases/{alias}/acknowledgment", headers=as_role("ground"))
        assert acknowledged.status_code == 200, acknowledged.text
        assert acknowledged.json()["ground_ack"] == "acknowledged"
        assert acknowledged.json()["ground_acknowledged_at_s"] == 360
        assert client.post(f"{runs}/ground/health-cases/{alias}/acknowledgment",
                           headers=as_role("ground")).json() == acknowledged.json()
        assert client.post(f"{runs}/ground/health-cases/{alias}/acknowledgment",
                           headers=as_role("crew")).status_code == 403
        # Ground's acknowledgment is its own record; the onboard case is unchanged.
        onboard = client.get(f"{runs}/crew/emergencies/{case['case_id']}", headers=as_role("crew")).json()
        assert onboard == local.json()

        # A later share of the same case keeps its alias, so Ground sees one case with the newer status.
        again = client.post(f"{runs}/crew/emergencies/{case['case_id']}/relay",
                            json={"operation_id": "share-02"}, headers=as_role("crew")).json()
        assert (again["case_alias"], again["status"], again["deliver_at_s"]) == (alias, "acknowledged", 660)

    with closing(sqlite3.connect(database)) as db:
        (payload,) = db.execute(
            "SELECT payload_json FROM messages WHERE run_id = ? AND message_id = 'health-case:share-01'",
            (run_id,)).fetchone()
        assert set(json.loads(payload)) == {"case_alias", "review_priority", "status"}
        shared = db.execute(
            """SELECT group_concat(payload_json) FROM events
               WHERE run_id = ? AND visibility = 'operational'""", (run_id,)).fetchone()[0]
        assert_private_fields_absent(shared)
        assert_private_fields_absent(" ".join(row[0] for row in db.execute(
            "SELECT payload_json FROM messages WHERE run_id = ?", (run_id,))))
