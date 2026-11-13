from contextlib import closing
from pathlib import Path
import json
import sqlite3

import pytest

from test_runs import START, local_client
from test_wearable_recheck import advance, setup

EXPECTED = json.loads((Path(__file__).resolve().parents[3] / "scenarios/expected/exercise-power-preview-v1.json").read_text())


def start(client, headers):
    response = client.post("/api/v1/runs", headers=headers["facilitator"],
                           json={**START, "scenario_id":"exercise-power-preview"})
    assert response.status_code == 200, response.text
    return f"/api/v1/runs/{response.json()['run_id']}"


def preview(client, headers, base):
    response = client.get(base + "/crew/exercise-preview", headers=headers["crew"])
    assert response.status_code == 200, response.text
    return response.json()


def command(client, headers, base, plan, operation_id):
    response = client.post(base + "/actions", headers=headers["crew"], json={
        "operation_id":operation_id, "candidate_id":"defer_exercise", "basis_decision_rev":plan["decision_rev"],
        "basis_snapshot_id":plan["basis_snapshot_id"], "expires_at_s":plan["outcome_at_s"],
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_exercise_preview_does_not_mutate_run_and_stale_commit_is_held(tmp_path):
    db_path = tmp_path / "exercise.sqlite"
    with local_client(db_path) as client, closing(sqlite3.connect(db_path)) as db:
        headers = setup(client)
        base = start(client, headers)
        advance(client, headers, base, 0, 9)

        def state():
            return tuple(db.iterdump())

        before = state()
        initial = preview(client, headers, base)
        assert preview(client, headers, base) == initial
        assert state() == before
        assert all(option["result"] == "feasible" for option in initial["options"])

        advance(client, headers, base, 9, 10)
        fresh = preview(client, headers, base)
        keep, defer = fresh["options"]
        assert keep["reason_code"] == "POWER_LIMIT"
        assert defer["standby"]["reason_code"] == "POWER_LIMIT"
        assert defer["standby"]["required_kw"] == EXPECTED["standby_demand_kw"]
        assert defer["standby"]["available_kw"] == EXPECTED["reduced_headroom_kw"]
        assert fresh["decision_rev"] == initial["decision_rev"] + 1
        before_schedule = db.execute("SELECT event_type FROM events").fetchall()
        rejected = command(client, headers, base, initial, "stale-exercise")
        assert rejected["reason_code"] == "STALE_DECISION_REV"
        assert rejected["applied"] is False
        assert db.execute("SELECT event_type FROM events").fetchall() == before_schedule
        assert preview(client, headers, base)["status"] == "scheduled"
        assert client.get(base + "/crew/exercise-preview", headers=headers["ground"]).status_code == 403


def test_accepted_deferral_updates_activity_load_once(tmp_path):
    db_path = tmp_path / "exercise.sqlite"
    with local_client(db_path) as client, closing(sqlite3.connect(db_path)) as db:
        headers = setup(client)
        base = start(client, headers)
        advance(client, headers, base, 0, 10)
        plan = preview(client, headers, base)
        accepted = command(client, headers, base, plan, "defer-exercise")
        assert accepted["applied"] is True
        assert command(client, headers, base, plan, "defer-exercise") == accepted
        deferred = preview(client, headers, base)
        assert deferred["decision"]["exercise_load_kw"] == 0
        assert db.execute("SELECT count(*) FROM events WHERE event_type = 'crew.exercise_deferred'").fetchone() == (1,)
        advance(client, headers, base, 10, 11)
        result = preview(client, headers, base)
        assert result["outcome"]["observed_at_s"] == EXPECTED["outcome_at_s"]
        assert result["outcome"]["co2_ppm"] == pytest.approx(result["decision"]["projected_co2_ppm"])
        assert result["outcome"]["headroom_kw"] == EXPECTED["reduced_headroom_kw"]
