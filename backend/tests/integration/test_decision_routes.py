"""SX-22D: plan evaluation is read-only and action receipts are stable."""

from contextlib import closing
import sqlite3

from test_runs import START, authenticate, local_client


def test_evaluate_commit_and_lookup(tmp_path):
    database = tmp_path / "decisions.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        run_id = client.post("/api/v1/runs", json=START,
                             headers={"Authorization": "Bearer " + tokens["facilitator"]}).json()["run_id"]
        base = f"/api/v1/runs/{run_id}"
        crew = {"Authorization": "Bearer " + tokens["crew"]}
        ground = {"Authorization": "Bearer " + tokens["ground"]}

        with closing(sqlite3.connect(database)) as db:
            before = (
                db.execute("SELECT mission_s, decision_rev, status FROM runs WHERE run_id = ?", (run_id,)).fetchone(),
                db.execute("SELECT count(*) FROM events WHERE run_id = ?", (run_id,)).fetchone(),
                db.execute("SELECT count(*) FROM operations WHERE run_id = ?", (run_id,)).fetchone(),
            )

        evaluated = client.post(base + "/plans/evaluate", headers=crew)
        assert evaluated.status_code == 200
        plan = evaluated.json()
        assert plan["basis_snapshot_id"] == "crew-v0"
        assert plan["decision_rev"] == 0
        assert {item["candidate_id"] for item in plan["candidates"]} == {
            "hold_course", "start_standby", "reduce_activity"
        }
        assert client.post(base + "/plans/evaluate", headers=ground).status_code == 403

        with closing(sqlite3.connect(database)) as db:
            after = (
                db.execute("SELECT mission_s, decision_rev, status FROM runs WHERE run_id = ?", (run_id,)).fetchone(),
                db.execute("SELECT count(*) FROM events WHERE run_id = ?", (run_id,)).fetchone(),
                db.execute("SELECT count(*) FROM operations WHERE run_id = ?", (run_id,)).fetchone(),
            )
        assert after == before, "evaluation must not mutate run state, journal, or receipts"

        stale = {"operation_id": "action-stale", "candidate_id": "hold_course", "basis_decision_rev": 99}
        committed = client.post(base + "/actions", json=stale, headers=crew)
        assert committed.status_code == 200
        receipt = committed.json()
        assert receipt == {
            "operation_id": "action-stale", "candidate_id": "hold_course", "status": "rejected",
            "reason_code": "STALE_DECISION_REV", "basis_decision_rev": 99,
            "current_decision_rev": 0, "applied": False,
        }
        assert client.post(base + "/actions", json=stale, headers=crew).json() == receipt
        assert client.get(base + "/actions/action-stale", headers=crew).json() == receipt
        assert client.get(base + "/actions/not-found", headers=crew).status_code == 404

        mismatch = {**stale, "candidate_id": "reduce_activity"}
        conflict = client.post(base + "/actions", json=mismatch, headers=crew)
        assert (conflict.status_code, conflict.json()) == (409, {"detail": "OPERATION_ID_REUSED"})
        assert client.post(base + "/actions", json=stale, headers=ground).status_code == 403
        assert client.post(base + "/actions", json=stale,
                           headers={"Authorization": "Bearer " + tokens["facilitator"]}).status_code == 403
        assert client.post("/api/v1/runs/missing/plans/evaluate", headers=crew).status_code == 404


def test_feasible_action_commits_once(tmp_path):
    database = tmp_path / "decisions.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        facilitator = {"Authorization": "Bearer " + tokens["facilitator"]}
        crew = {"Authorization": "Bearer " + tokens["crew"]}
        run_id = client.post("/api/v1/runs", json=START, headers=facilitator).json()["run_id"]
        base = f"/api/v1/runs/{run_id}"
        plan = client.post(base + "/plans/evaluate", headers=crew).json()
        feasible = next(item for item in plan["candidates"] if item["result"] == "feasible")
        command = {"operation_id": "action-commit-1", "candidate_id": feasible["candidate_id"],
                   "basis_decision_rev": plan["decision_rev"]}

        first = client.post(base + "/actions", json=command, headers=crew)
        assert first.status_code == 200
        receipt = first.json()
        assert receipt["status"] == "accepted" and receipt["applied"] is True
        assert receipt["current_decision_rev"] == receipt["basis_decision_rev"] + 1
        assert client.post(base + "/actions", json=command, headers=crew).json() == receipt
        assert client.get(base + "/actions/action-commit-1", headers=crew).json() == receipt

        with closing(sqlite3.connect(database)) as db:
            assert db.execute("SELECT decision_rev FROM runs WHERE run_id = ?", (run_id,)).fetchone() == (1,)
            assert db.execute(
                "SELECT count(*) FROM events WHERE run_id = ? AND event_type = 'crew.action_committed'",
                (run_id,),
            ).fetchone() == (1,)
            assert db.execute(
                "SELECT count(*) FROM operations WHERE run_id = ? AND operation_scope = 'crew_action'",
                (run_id,),
            ).fetchone() == (1,)
