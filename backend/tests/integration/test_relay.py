"""Relay delivers immutable Ground snapshots on mission time."""

import pytest

from test_runs import START, authenticate, local_client

from symbiosis_x.contracts.commands import GroundAdvisoryRequest
from symbiosis_x.contracts.projections import GroundCO2, GroundPacket, PowerHeadroom
from symbiosis_x.workflows.relay import (
    SnapshotConflict, deliver_due, queue_ground_advisory, queue_ground_snapshot, receive_due_advisories,
)


def golden_packet(co2_ppm, co2_at, kw, kw_at):
    return GroundPacket(
        co2=GroundCO2(value=co2_ppm, unit="ppm", kind="delivered_observation", observed_at_s=co2_at),
        power_headroom=PowerHeadroom(value=kw, unit="kW", observed_at_s=kw_at),
    )


V102 = dict(snapshot_id="ground-v102", decision_rev=102, observed_at_s=60,
            issued_at_s=60, deliver_at_s=360, packet=golden_packet(2000.0, 60, 0.60, 60))
V103 = dict(snapshot_id="ground-v103", decision_rev=103, observed_at_s=600,
            issued_at_s=600, deliver_at_s=900, packet=golden_packet(2000.0, 60, 0.20, 600))


def set_clock(client, run_id, mission_s):
    """Stand in for the golden step until SX-22E composes it; Relay runs on the same writer."""
    with client.app.state.repository.write() as db:
        db.execute("UPDATE runs SET mission_s = ? WHERE run_id = ?", (mission_s, run_id))
        return deliver_due(db, run_id, mission_s)


def started_run(client):
    authenticate(client)
    run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
    with client.app.state.repository.write() as db:
        queue_ground_snapshot(db, run_id, **V102)
        queue_ground_snapshot(db, run_id, **V103)
    authenticate(client, "ground")
    return run_id


def test_ground_keeps_delivered_values_until_new_packet(tmp_path):
    with local_client(tmp_path / "relay.sqlite3") as client:
        run_id = started_run(client)
        url = f"/api/v1/runs/{run_id}/ground"

        assert set_clock(client, run_id, 300) == []
        assert client.get(url).json()["packet"] is None

        # Stepping straight to 13:00 still delivers v102 at its own 06:00 due time.
        assert set_clock(client, run_id, 780) == ["relay:ground-v102"]
        packet = client.get(url).json()["packet"]
        assert (packet["snapshot_id"], packet["decision_rev"]) == ("ground-v102", 102)
        assert packet["power_headroom"]["value"] == pytest.approx(0.60)
        assert packet["delivery"] == {
            "observed_at_s": 60, "received_at_s": 360, "age_s": 720, "link_status": "delayed",
        }

        assert set_clock(client, run_id, 900) == ["relay:ground-v103"]
        packet = client.get(url).json()["packet"]
        assert (packet["snapshot_id"], packet["decision_rev"]) == ("ground-v103", 103)
        assert packet["power_headroom"]["value"] == pytest.approx(0.20)
        assert packet["delivery"]["received_at_s"] == 900
        assert set_clock(client, run_id, 900) == []


def test_queued_snapshot_is_immutable(tmp_path):
    with local_client(tmp_path / "relay.sqlite3") as client:
        run_id = started_run(client)
        with client.app.state.repository.write() as db:
            # Replaying the same packet is a no-op; changing it is refused.
            assert queue_ground_snapshot(db, run_id, **V102) == "relay:ground-v102"
            with pytest.raises(SnapshotConflict, match="SNAPSHOT_IMMUTABLE"):
                queue_ground_snapshot(db, run_id, **{**V102, "packet": golden_packet(2000.0, 60, 0.20, 60)})
            with pytest.raises(SnapshotConflict, match="SNAPSHOT_IMMUTABLE"):
                queue_ground_snapshot(db, run_id, **{**V102, "deliver_at_s": 420})
            count = db.execute("SELECT COUNT(*) FROM messages WHERE run_id = ?", (run_id,)).fetchone()[0]
        assert count == 2


def test_snapshot_cannot_be_due_before_it_was_observed(tmp_path):
    with local_client(tmp_path / "relay.sqlite3") as client:
        authenticate(client)
        run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
        with client.app.state.repository.write() as db:
            with pytest.raises(ValueError, match="INVALID_DELIVERY_CHRONOLOGY"):
                queue_ground_snapshot(db, run_id, **{**V103, "deliver_at_s": 500})


def test_advance_delivers_due_packets_on_the_run_writer(tmp_path):
    with local_client(tmp_path / "relay.sqlite3") as client:
        authenticate(client)
        run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
        with client.app.state.repository.write() as db:
            queue_ground_snapshot(
                db, run_id, snapshot_id="ground-v1", decision_rev=1, observed_at_s=0,
                issued_at_s=0, deliver_at_s=60, packet=golden_packet(2000.0, 0, 0.60, 0),
            )
        step = {"advance_id": "advance-01", "expected_step": 0}
        assert client.post(f"/api/v1/runs/{run_id}/advance", json=step).status_code == 200

        authenticate(client, "ground")
        packet = client.get(f"/api/v1/runs/{run_id}/ground").json()["packet"]
        assert (packet["snapshot_id"], packet["delivery"]["received_at_s"]) == ("ground-v1", 60)
        assert packet["power_headroom"]["value"] == pytest.approx(0.60)


def advise(client, run_id, operation_id, basis="ground-v102"):
    response = client.post(f"/api/v1/runs/{run_id}/ground/advisories", json={
        "operation_id": operation_id, "basis_snapshot_id": basis, "candidate_id": "start_standby"})
    assert response.status_code == 200, response.text
    return response.json()


def set_decision_rev(client, run_id, decision_rev):
    with client.app.state.repository.write() as db:
        db.execute("UPDATE runs SET decision_rev = ? WHERE run_id = ?", (decision_rev, run_id))


def receive(client, run_id, mission_s):
    with client.app.state.repository.write() as db:
        db.execute("UPDATE runs SET mission_s = ? WHERE run_id = ?", (mission_s, run_id))
        deliver_due(db, run_id, mission_s)
        return receive_due_advisories(db, run_id, mission_s)


def plant_state(client, run_id):
    with client.app.state.repository.read() as db:
        run = db.execute("SELECT mission_s, decision_rev, status FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        scopes = db.execute("SELECT operation_scope FROM operations WHERE run_id = ?", (run_id,)).fetchall()
        observations = db.execute(
            "SELECT count(*) FROM telemetry_observations WHERE run_id = ?", (run_id,)).fetchone()[0]
        return tuple(run), sorted(row[0] for row in scopes), observations


def test_stale_advisory_held_without_plant_effect(tmp_path):
    with local_client(tmp_path / "relay.sqlite3") as client:
        run_id = started_run(client)
        set_decision_rev(client, run_id, 102)        # 01:00 scrubber degrades → v102
        assert set_clock(client, run_id, 480) == ["relay:ground-v102"]   # v102 reached Ground at 06:00
        receipt = advise(client, run_id, "op-demo-013")                   # 08:00 Ground advises on v102
        assert (receipt["basis_decision_rev"], receipt["deliver_at_s"]) == (102, 780)
        set_decision_rev(client, run_id, 103)        # 10:00 power drops → v103 onboard

        assert receive(client, run_id, 779) == []    # still in transit
        before = plant_state(client, run_id)
        dispositions = receive(client, run_id, 780)  # 13:00 the v102 advice arrives
        assert [d.model_dump() for d in dispositions] == [{
            "operation_id": "op-demo-013", "disposition": "held", "reason_code": "STALE_BASIS",
            "candidate_id": "start_standby", "basis_snapshot_id": "ground-v102",
            "basis_decision_rev": 102, "current_decision_rev": 103, "received_at_s": 780,
            "applied": False,
        }]
        assert receive(client, run_id, 780) == []    # receipt is recorded once

        # Zero applied effects: the only change is the clock this test moved itself.
        after = plant_state(client, run_id)
        assert after[0][1:] == before[0][1:] == (103, "active")
        assert after[1:] == before[1:] == (["ground_advisory"], 1)
        with client.app.state.repository.read() as db:
            assert db.execute(
                """SELECT delivered_at_s FROM messages WHERE run_id = ? AND message_id = 'advisory:op-demo-013'""",
                (run_id,)).fetchone()[0] == 780
            events = db.execute(
                """SELECT event_type, mission_s, json_extract(payload_json, '$.disposition')
                   FROM events WHERE run_id = ? AND event_type = 'crew.advisory_received'""",
                (run_id,)).fetchall()
            assert [tuple(row) for row in events] == [("crew.advisory_received", 780, "held")]


def test_current_advice_enters_crew_review_and_expired_advice_is_held(tmp_path):
    with local_client(tmp_path / "relay.sqlite3") as client:
        run_id = started_run(client)
        set_decision_rev(client, run_id, 102)
        set_clock(client, run_id, 480)
        advise(client, run_id, "op-current")
        with client.app.state.repository.write() as db:
            run = db.execute("SELECT run_id, mission_s, status FROM runs WHERE run_id = ?", (run_id,)).fetchone()
            queue_ground_advisory(db, run, GroundAdvisoryRequest(
                operation_id="op-expiring", basis_snapshot_id="ground-v102", candidate_id="hold_course"),
                expires_after_s=120)
        dispositions = {d.operation_id: d for d in receive(client, run_id, 780)}
        assert (dispositions["op-current"].disposition, dispositions["op-current"].reason_code) == (
            "crew_review", None)
        assert (dispositions["op-expiring"].disposition, dispositions["op-expiring"].reason_code) == (
            "held", "ADVICE_EXPIRED")
        assert all(d.applied is False for d in dispositions.values())


def test_relay_cannot_reach_the_plant_command_path():
    """Advice intake classifies and journals; it imports nothing that can command the plant."""
    import ast

    import symbiosis_x.workflows.relay as relay
    tree = ast.parse(open(relay.__file__, encoding="utf-8").read())
    imported = {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    imported |= {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    assert {name for name in imported if name and name.startswith("symbiosis_x")} <= {
        "symbiosis_x.contracts.commands", "symbiosis_x.contracts.projections"}
