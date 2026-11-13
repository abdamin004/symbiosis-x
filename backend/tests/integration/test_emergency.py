"""SX-25A: scripted emergency drills open one local case without Ground."""

import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

import symbiosis_x.application.runs as runs_module
import symbiosis_x.workflows.relay as relay_module
from symbiosis_x.main import create_app

START = {"start_id": "emergency-test", "scenario_id": "nominal", "scenario_version": "1", "seed": 42}
DRILLS = {
    "chest_pain": {"drill_id": "drill-chest-pain-v1", "reported_by": "SIM-01",
                   "subject": "SIM-01", "responder": "SIM-02", "report_kind": "direct_symptom_report"},
    "collapse": {"drill_id": "drill-collapse-v1", "reported_by": "SIM-04",
                 "subject": "SIM-03", "responder": "SIM-04", "report_kind": "bystander_report"},
}


def make_client(database):
    return TestClient(
        create_app(database_path=database, enable_local_demo=True),
        base_url="http://127.0.0.1", client=("127.0.0.1", 60000),
    )


def as_role(client, credentials, role):
    client.headers["Authorization"] = f"Bearer {credentials[role]}"


def start_and_advance(client, credentials):
    as_role(client, credentials, "facilitator")
    run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
    advanced = client.post(f"/api/v1/runs/{run_id}/advance", json={"advance_id": "a1", "expected_step": 0})
    assert advanced.status_code == 200, advanced.text
    return run_id


def disconnect_relay(monkeypatch):
    """Simulate a communication blackout: any relay call fails loudly."""
    def blackout(*_args, **_kwargs):
        raise ConnectionError("RELAY_DISCONNECTED")

    for module in (relay_module, runs_module):
        for name in ("queue_ground_snapshot", "deliver_due", "receive_due_advisories"):
            if hasattr(module, name):
                monkeypatch.setattr(module, name, blackout)


def relay_rows(database):
    with closing(sqlite3.connect(database)) as db:
        return (db.execute("SELECT count(*) FROM messages").fetchone()[0],
                db.execute("SELECT count(*) FROM snapshots").fetchone()[0])


@pytest.mark.parametrize("kind", ["chest_pain", "collapse"])
def test_emergency_cases_route_without_ground(tmp_path, monkeypatch, kind):
    database = tmp_path / "emergency.sqlite3"
    drill = DRILLS[kind]
    with make_client(database) as client:
        credentials = client.post("/api/v1/demo/session").json()
        run_id = start_and_advance(client, credentials)
        before = relay_rows(database)
        disconnect_relay(monkeypatch)

        url = f"/api/v1/runs/{run_id}/crew/emergencies"
        request = {"operation_id": f"op-{kind}", "drill_id": drill["drill_id"],
                   "reported_by": drill["reported_by"], "synthetic": True}

        as_role(client, credentials, "ground")
        assert client.post(url, json=request).status_code == 403

        as_role(client, credentials, "crew")
        opened = client.post(url, json=request)
        assert opened.status_code == 201, opened.text
        case = opened.json()
        assert case["case_id"] == f"case-{drill['drill_id']}"
        assert case["kind"] == kind and case["status"] == "open"
        assert case["owner"] == drill["responder"]
        assert case["opened_at_s"] == 60
        assert case["subject_crew_id"] == drill["subject"]
        assert case["report_kind"] == drill["report_kind"]
        assert case["escalation"] == {"level": "local_alert", "raised_at_s": 60,
                                      "depends_on_vitals": False, "depends_on_relay": False}
        # Missing vitals are reported, and the alert is raised anyway.
        assert case["vitals"] == {"heart_rate": "unavailable", "last_valid_observed_at_s": None}
        assert case["ground_link"] == "not_required"
        assert case["procedure"]["kind"] == "training_placeholder"
        assert "TRAINING PLACEHOLDER" in case["procedure"]["label"]
        if kind == "collapse":
            assert case["responsiveness"] == "unknown"
        else:
            assert case["responsiveness"] is None
            assert "chest pain" in case["report"]

        # Duplicate request and a second trigger for the same drill return the one case.
        repeat = client.post(url, json=request)
        assert repeat.status_code == 200 and repeat.json() == case
        second = client.post(url, json=request | {"operation_id": f"op-{kind}-again"})
        assert second.status_code == 200 and second.json() == case
        reused = client.post(url, json=request | {"drill_id": DRILLS[
            "collapse" if kind == "chest_pain" else "chest_pain"]["drill_id"]})
        assert reused.status_code in (409, 422)

        with closing(sqlite3.connect(database)) as db:
            assert db.execute("SELECT count(*) FROM emergency_cases WHERE run_id = ?",
                              (run_id,)).fetchone()[0] == 1
            assert db.execute(
                "SELECT count(*) FROM events WHERE run_id = ? AND event_type = 'crew.emergency_opened'",
                (run_id,)).fetchone()[0] == 1
        # Nothing was queued for Ground while the relay was down.
        assert relay_rows(database) == before

        monkeypatch.undo()
        as_role(client, credentials, "ground")
        ground = client.get(f"/api/v1/runs/{run_id}/ground")
        assert ground.status_code == 200
        assert case["case_id"] not in ground.text and drill["drill_id"] not in ground.text


def test_collapse_keeps_reported_responsiveness_and_records_acknowledgment(tmp_path):
    database = tmp_path / "emergency-ack.sqlite3"
    with make_client(database) as client:
        credentials = client.post("/api/v1/demo/session").json()
        run_id = start_and_advance(client, credentials)
        as_role(client, credentials, "crew")
        url = f"/api/v1/runs/{run_id}/crew/emergencies"
        opened = client.post(url, json={"operation_id": "op-collapse", "drill_id": "drill-collapse-v1",
                                        "reported_by": "SIM-04", "synthetic": True,
                                        "responsiveness": "unresponsive"})
        assert opened.status_code == 201
        case = opened.json()
        assert case["responsiveness"] == "unresponsive"

        ack_url = f"{url}/{case['case_id']}/acknowledgment"
        assert client.post(ack_url, json={"acknowledged_by": "SIM-01"}).status_code == 422
        acked = client.post(ack_url, json={"acknowledged_by": "SIM-04"})
        assert acked.status_code == 200, acked.text
        assert acked.json()["status"] == "acknowledged"
        assert acked.json()["acknowledgment"] == {"acknowledged_by": "SIM-04", "acknowledged_at_s": 60}
        assert client.post(ack_url, json={"acknowledged_by": "SIM-04"}).json() == acked.json()
        assert client.get(f"{url}/{case['case_id']}").json() == acked.json()


@pytest.mark.parametrize("change, status, detail", [
    ({"synthetic": False}, 422, "SYNTHETIC_DRILL_REQUIRED"),
    ({"drill_id": "drill-unknown"}, 404, "DRILL_NOT_FOUND"),
    ({"reported_by": "SIM-99"}, 422, "REPORTER_NOT_ON_ROSTER"),
    ({"reported_by": "SIM-02"}, 422, "REPORTER_NOT_IN_DRILL_SCRIPT"),
    ({"responsiveness": "unknown"}, 422, "RESPONSIVENESS_NOT_USED_FOR_CHEST_PAIN"),
])
def test_invalid_emergency_requests_are_rejected(tmp_path, change, status, detail):
    database = tmp_path / "emergency-invalid.sqlite3"
    with make_client(database) as client:
        credentials = client.post("/api/v1/demo/session").json()
        run_id = start_and_advance(client, credentials)
        as_role(client, credentials, "crew")
        request = {"operation_id": "op-1", "drill_id": "drill-chest-pain-v1",
                   "reported_by": "SIM-01", "synthetic": True} | change
        response = client.post(f"/api/v1/runs/{run_id}/crew/emergencies", json=request)
        assert (response.status_code, response.json()["detail"]) == (status, detail)
        with closing(sqlite3.connect(database)) as db:
            assert db.execute("SELECT count(*) FROM emergency_cases").fetchone()[0] == 0
