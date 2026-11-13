"""SX-07E: Ground may only queue advice on a snapshot it has already received."""

import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient

from symbiosis_x.contracts.projections import GroundCO2, GroundPacket
from symbiosis_x.main import create_app
from symbiosis_x.storage.repository import Repository
from symbiosis_x.workflows.relay import RELAY_DELAY_S, queue_ground_snapshot

START = {"start_id": "start-01", "scenario_id": "nominal", "scenario_version": "1", "seed": 4242}
DELIVERED = "nominal-ground-launch"


def local_client(database):
    return TestClient(create_app(database_path=database, enable_local_demo=True),
                      base_url="http://127.0.0.1", client=("127.0.0.1", 60000))


def advice(**changes):
    return {"operation_id": "op-demo-013", "basis_snapshot_id": DELIVERED,
            "candidate_id": "start_standby", **changes}


def test_advice_is_queued_on_delivered_basis(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        as_role = lambda role: {"Authorization": "Bearer " + tokens[role]}  # noqa: E731
        run_id = client.post("/api/v1/runs", json=START, headers=as_role("facilitator")).json()["run_id"]
        url = f"/api/v1/runs/{run_id}/ground/advisories"

        # Before the first step Ground has received nothing it could cite.
        early = client.post(url, json=advice(), headers=as_role("ground"))
        assert (early.status_code, early.json()) == (409, {"detail": "BASIS_NOT_DELIVERED"})

        client.post(f"/api/v1/runs/{run_id}/advance", json={"advance_id": "a-1", "expected_step": 0},
                    headers=as_role("facilitator"))
        with Repository(database).write() as db:
            queue_ground_snapshot(
                db, run_id, snapshot_id="ground-v999", decision_rev=999, observed_at_s=60,
                issued_at_s=60, deliver_at_s=6000,
                packet=GroundPacket(co2=GroundCO2(value=1.0, unit="ppm", observed_at_s=60,
                                                  kind="delivered_observation")),
            )

        response = client.post(url, json=advice(), headers=as_role("ground"))
        assert response.status_code == 200
        receipt = response.json()
        assert receipt == {
            "operation_id": "op-demo-013", "run_id": run_id, "status": "queued",
            "candidate_id": "start_standby", "basis_snapshot_id": DELIVERED, "basis_decision_rev": 0,
            "issued_at_s": 60, "deliver_at_s": 60 + RELAY_DELAY_S,
        }
        assert client.post(url, json=advice(), headers=as_role("ground")).json() == receipt
        assert client.post(url, json=advice(candidate_id="hold_course"), headers=as_role("ground")).json() == {
            "detail": "OPERATION_ID_REUSED"}

        rejected = {
            "ground-v999": "BASIS_NOT_DELIVERED",  # queued for Ground but not yet received
            "never-existed": "BASIS_NOT_DELIVERED",
        }
        for basis, reason in rejected.items():
            response = client.post(url, json=advice(operation_id=f"op-{basis}", basis_snapshot_id=basis),
                                   headers=as_role("ground"))
            assert (response.status_code, response.json()) == (409, {"detail": reason})

        assert client.post(url, json=advice(candidate_id="vent_cabin"), headers=as_role("ground")).status_code == 422
        assert client.post(url, json=advice(), headers=as_role("crew")).status_code == 403
        assert client.post(url, json=advice(), headers=as_role("facilitator")).status_code == 403
        assert client.post("/api/v1/runs/missing/ground/advisories", json=advice(),
                           headers=as_role("ground")).json() == {"detail": "RUN_NOT_FOUND"}

    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT mission_s FROM runs").fetchall() == [(60,)]
        assert db.execute(
            """SELECT direction, issued_at_s, deliver_at_s, delivered_at_s, ground_snapshot_id
               FROM messages WHERE message_id = 'advisory:op-demo-013'""").fetchall() == [
            ("to_crew", 60, 60 + RELAY_DELAY_S, None, DELIVERED)]
        assert db.execute(
            "SELECT count(*) FROM events WHERE event_type = 'ground.advisory_issued'").fetchone() == (1,)
        assert db.execute(
            "SELECT count(*) FROM operations WHERE operation_scope = 'ground_advisory'").fetchone() == (1,)


def test_advice_on_closed_run_is_rejected(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        facilitator = {"Authorization": "Bearer " + tokens["facilitator"]}
        run_id = client.post("/api/v1/runs", json=START, headers=facilitator).json()["run_id"]
        client.post(f"/api/v1/runs/{run_id}/advance", json={"advance_id": "a-1", "expected_step": 0},
                    headers=facilitator)
        client.post(f"/api/v1/runs/{run_id}/reset", json={"reset_id": "r-1"}, headers=facilitator)
        response = client.post(f"/api/v1/runs/{run_id}/ground/advisories", json=advice(),
                               headers={"Authorization": "Bearer " + tokens["ground"]})
        assert (response.status_code, response.json()) == (409, {"detail": "RUN_CLOSED"})
