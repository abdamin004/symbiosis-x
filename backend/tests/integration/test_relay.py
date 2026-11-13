"""Relay delivers immutable Ground snapshots on mission time."""

import pytest

from test_runs import START, authenticate, local_client

from symbiosis_x.contracts.projections import GroundCO2, GroundPacket, PowerHeadroom
from symbiosis_x.workflows.relay import SnapshotConflict, deliver_due, queue_ground_snapshot


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
