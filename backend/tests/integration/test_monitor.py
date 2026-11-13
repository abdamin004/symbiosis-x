"""SX-07B: Monitor opens one incident per fault and routes it to the planner."""

import json
import sqlite3
from contextlib import closing

import pytest

from test_runs import START, authenticate, local_client

from symbiosis_x.workflows.monitor import MonitorDenied, handle_fault


def record_fault(client, run_id, event_id, mission_s=60, event_type="fault.scrubber_degraded", **payload):
    """Stand in for the golden step (SX-22E): journal an accepted fault event."""
    payload = payload or {"component_id": "primary-scrubber-01", "removal_m3_h": 4}
    with client.app.state.repository.write() as db:
        db.execute(
            """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, ?, ?, 'operational', ?
               FROM events WHERE run_id = ?""",
            (run_id, event_id, event_type, mission_s, json.dumps(payload), run_id),
        )


def monitor(client, run_id, event_id):
    with client.app.state.repository.write() as db:
        return handle_fault(db, run_id, event_id)


def started_at_one_minute(client):
    authenticate(client)
    run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
    client.post(f"/api/v1/runs/{run_id}/advance", json={"advance_id": "a-1", "expected_step": 0})
    return run_id


def test_repeated_fault_opens_one_case(tmp_path):
    database = tmp_path / "monitor.sqlite3"
    with local_client(database) as client:
        run_id = started_at_one_minute(client)
        record_fault(client, run_id, "evt-scrubber-degraded")

        case = monitor(client, run_id, "evt-scrubber-degraded")
        assert case.trigger_key == "fault.scrubber_degraded"
        assert (case.component_id, case.opened_by_event_id, case.opened_at_s) == (
            "primary-scrubber-01", "evt-scrubber-degraded", 60)
        assert case.next_owner == "crew"
        assert case.plan_status == "INSUFFICIENT_EVIDENCE"
        assert {c.candidate_id: (c.result, c.reason_code) for c in case.candidates} == {
            "hold_course": ("rejected", "CO2_PEAK_LIMIT"),
            "start_standby": ("unknown", "HEADROOM_UNKNOWN"),
            "reduce_activity": ("unknown", "ACTIVITY_PERMISSION_UNKNOWN"),
        }
        assert "HEADROOM_UNKNOWN" in case.explanation and "CO2_PEAK_LIMIT" in case.explanation

        # The same event again, and a new event for the same fault, stay in the one incident.
        assert monitor(client, run_id, "evt-scrubber-degraded") == case
        record_fault(client, run_id, "evt-scrubber-degraded-repeat")
        repeat = monitor(client, run_id, "evt-scrubber-degraded-repeat")
        assert repeat.incident_id == case.incident_id
        assert repeat.linked_event_ids == ("evt-scrubber-degraded", "evt-scrubber-degraded-repeat")
        assert (repeat.next_owner, repeat.plan_status) == (case.next_owner, case.plan_status)

    with local_client(database) as restarted:
        assert monitor(restarted, run_id, "evt-scrubber-degraded-repeat") == repeat

    with closing(sqlite3.connect(database)) as db:
        assert db.execute(
            "SELECT count(*) FROM operations WHERE run_id = ? AND operation_scope = 'incident'", (run_id,)
        ).fetchone() == (1,)
        events = db.execute(
            """SELECT event_type, visibility FROM events
               WHERE run_id = ? AND event_type LIKE 'incident.%' ORDER BY event_seq""", (run_id,)).fetchall()
        assert events == [("incident.opened", "operational"), ("incident.fault_linked", "operational")]
        # Routing a plan is advisory: no decision revision change and no command.
        assert db.execute("SELECT decision_rev FROM runs WHERE run_id = ?", (run_id,)).fetchone() == (0,)
        assert db.execute(
            "SELECT count(*) FROM events WHERE run_id = ? AND event_type LIKE 'command.%'", (run_id,)
        ).fetchone() == (0,)


def test_known_power_evidence_routes_to_commander(tmp_path):
    with local_client(tmp_path / "monitor.sqlite3") as client:
        run_id = started_at_one_minute(client)
        record_fault(client, run_id, "evt-power-drops", event_type="fault.power_drop",
                     component_id="power-bus-01", power_headroom_kw=0.20, feeder_connected=True)
        record_fault(client, run_id, "evt-scrubber-degraded")
        with client.app.state.repository.write() as db:
            db.execute("UPDATE runs SET decision_rev = 103 WHERE run_id = ?", (run_id,))
        power = monitor(client, run_id, "evt-power-drops")
        scrubber = monitor(client, run_id, "evt-scrubber-degraded")
        # Different faults are different incidents.
        assert power.incident_id != scrubber.incident_id
        standby = next(c for c in scrubber.candidates if c.candidate_id == "start_standby")
        assert (standby.result, standby.reason_code) == ("rejected", "POWER_LIMIT")
        assert scrubber.basis_decision_rev == 103


def test_monitor_only_handles_allowlisted_faults(tmp_path):
    with local_client(tmp_path / "monitor.sqlite3") as client:
        run_id = started_at_one_minute(client)
        with pytest.raises(MonitorDenied, match="TRIGGER_NOT_ALLOWED"):
            monitor(client, run_id, "sim.cabin.co2:60")   # an observation, not a fault
        with pytest.raises(MonitorDenied, match="EVENT_NOT_FOUND"):
            monitor(client, run_id, "evt-never-recorded")
        with client.app.state.repository.read() as db:
            assert db.execute("SELECT count(*) FROM operations WHERE operation_scope = 'incident'").fetchone()[0] == 0


def test_only_monitor_may_request_plan_evaluation():
    from symbiosis_x.workflows.runner import ToolCall, dispatch
    from symbiosis_x.workflows.tools import default_registry

    call = dict(tool="request_plan_evaluation", trigger_key="fault.scrubber_degraded",
                trigger_event_id="evt-1", mission_s=60, args={"component_id": "primary-scrubber-01"})
    accepted = dispatch(default_registry(), ToolCall(agent="monitor", **call))
    assert (accepted.status, accepted.intents[0].kind, accepted.intents[0].owner) == (
        "accepted", "request_evaluation", "planner")
    for agent in ("planner", "relay"):
        assert dispatch(default_registry(), ToolCall(agent=agent, **call)).reason_code == "AGENT_NOT_ALLOWED"
