"""SX-06B: one Crew authorization, one committed action, one receipt."""

import sqlite3
from contextlib import closing

from test_runs import START, local_client


def _headers(tokens, role):
    return {"Authorization": "Bearer " + tokens[role]}


def _event_count(database, run_id):
    with closing(sqlite3.connect(database)) as db:
        return db.execute(
            "SELECT COUNT(*) FROM events WHERE run_id = ? AND event_type = 'crew.action_committed'",
            (run_id,),
        ).fetchone()[0]


def test_fresh_retry_applies_once_after_restart(tmp_path):
    database = tmp_path / "actions.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        run_id = client.post("/api/v1/runs", json=START,
                             headers=_headers(tokens, "facilitator")).json()["run_id"]
        url = f"/api/v1/runs/{run_id}/actions"
        plan = client.post(f"/api/v1/runs/{run_id}/plans/evaluate",
                           headers=_headers(tokens, "crew")).json()
        candidate = next(x for x in plan["candidates"] if x["result"] == "feasible")
        command = {
            "operation_id": "fresh-op-1", "candidate_id": candidate["candidate_id"],
            "basis_decision_rev": plan["decision_rev"],
            "policy_version": plan["policy_version"],
            "basis_snapshot_id": plan["basis_snapshot_id"],
            "expires_at_s": 30,
        }
        first = client.post(url, json=command, headers=_headers(tokens, "crew"))
        assert first.status_code == 200, first.text
        receipt = first.json()
        assert receipt["status"] == "accepted"
        assert receipt["applied"] is True
        assert receipt["current_decision_rev"] == 1
        assert client.post(url, json=command, headers=_headers(tokens, "crew")).json() == receipt
        assert _event_count(database, run_id) == 1

    with local_client(database) as restarted:
        tokens = restarted.post("/api/v1/demo/session").json()
        assert restarted.post(url, json=command, headers=_headers(tokens, "crew")).json() == receipt
        assert restarted.get(f"{url}/fresh-op-1", headers=_headers(tokens, "crew")).json() == receipt
        assert restarted.post(url, json={**command, "candidate_id": "reduce_activity"},
                              headers=_headers(tokens, "crew")).status_code == 409
        assert restarted.post(url, json=command, headers=_headers(tokens, "ground")).status_code == 403
        assert _event_count(database, run_id) == 1

        expired = {
            "operation_id": "expired-op", "candidate_id": "hold_course",
            "basis_decision_rev": 1, "expires_at_s": 0,
        }
        response = restarted.post(url, json=expired, headers=_headers(tokens, "crew"))
        assert response.status_code == 200, response.text
        assert response.json()["reason_code"] == "ACTION_EXPIRED"
        assert response.json()["applied"] is False
        assert _event_count(database, run_id) == 1

        stale = {**expired, "operation_id": "stale-op", "basis_decision_rev": 0}
        response = restarted.post(url, json=stale, headers=_headers(tokens, "crew"))
        assert response.status_code == 200
        assert response.json()["reason_code"] == "STALE_DECISION_REV"
        assert response.json()["applied"] is False
        assert _event_count(database, run_id) == 1


def test_invalid_policy_and_basis_do_not_apply(tmp_path):
    database = tmp_path / "actions.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        run_id = client.post("/api/v1/runs", json=START,
                             headers=_headers(tokens, "facilitator")).json()["run_id"]
        url = f"/api/v1/runs/{run_id}/actions"
        request = {"candidate_id": "hold_course", "basis_decision_rev": 0}
        for operation_id, extra, reason in (
            ("policy-mismatch", {"policy_version": "unknown"}, "POLICY_VERSION_MISMATCH"),
            ("basis-mismatch", {"basis_snapshot_id": "crew-v999"}, "BASIS_SNAPSHOT_MISMATCH"),
        ):
            response = client.post(
                url, json={**request, **extra, "operation_id": operation_id},
                headers=_headers(tokens, "crew"),
            )
            assert response.status_code == 200
            assert response.json()["reason_code"] == reason
            assert response.json()["applied"] is False
        assert _event_count(database, run_id) == 0
