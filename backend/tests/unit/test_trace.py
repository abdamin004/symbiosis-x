"""SX-16: trace comparison keeps open intervals open."""

import pytest
from fastapi.testclient import TestClient

from symbiosis_x.contracts.projections import TraceRecord
from symbiosis_x.main import create_app
from symbiosis_x.storage.sqlite import connect
from symbiosis_x.workflows.trace import case_intervals, compare_intervals, compare_runs


def record(case_id, mission_s, step, result="queued", reason_code=None):
    actor = {"advice_queued": "ground", "advice_received": "relay"}.get(step, "monitor")
    return TraceRecord(case_id=case_id, mission_s=mission_s, actor=actor, step=step,
                       result=result, reason_code=reason_code, next_owner="crew")


def test_open_interval_has_no_end_time():
    # The same advice case: still in transit in the baseline, delivered and held in the variant.
    baseline = case_intervals([record("advice-op-1", 480, "advice_queued")], as_of_s=600)
    variant = case_intervals([record("advice-op-9", 420, "advice_queued"),
                              record("advice-op-9", 720, "advice_received", "held", "STALE_BASIS")], as_of_s=780)

    open_case, done = baseline[0], variant[0]
    assert (open_case.is_open, open_case.end_s, open_case.duration_s) == (True, None, None)
    assert open_case.open_for_at_least_s == 120          # a lower bound, not a duration
    assert (done.is_open, done.end_s, done.duration_s, done.open_for_at_least_s) == (False, 720, 300, None)
    assert (done.latest_result, done.latest_reason_code) == ("held", "STALE_BASIS")

    [row] = compare_intervals(baseline, variant)
    assert (row.kind, row.ordinal, row.comparison) == ("advice", 1, "baseline_open")
    assert row.start_delta_s == -60
    assert row.duration_delta_s is None                  # open time is never treated as zero


def test_cases_match_by_kind_and_order_not_case_id():
    baseline = case_intervals([record("inc-a", 60, "incident_opened", "INSUFFICIENT_EVIDENCE"),
                               record("inc-b", 600, "incident_opened", "INSUFFICIENT_EVIDENCE")], as_of_s=780)
    variant = case_intervals([record("inc-x", 90, "incident_opened", "INSUFFICIENT_EVIDENCE"),
                              record("inc-x", 120, "fault_linked", "LINKED")], as_of_s=780)
    rows = compare_intervals(baseline, variant)
    assert [(r.kind, r.ordinal, r.comparison, r.start_delta_s) for r in rows] == [
        ("incident", 1, "both_open", 30), ("incident", 2, "only_baseline", None)]
    assert rows[0].variant.steps == ("incident_opened", "fault_linked")
    with pytest.raises(ValueError, match="after as_of_s"):
        case_intervals([record("inc-a", 900, "incident_opened")], as_of_s=780)


def test_compare_two_saved_golden_runs(tmp_path):
    database = tmp_path / "trace.sqlite3"
    with TestClient(create_app(database_path=database, enable_local_demo=True),
                    base_url="http://127.0.0.1", client=("127.0.0.1", 60000)) as client:
        tokens = client.post("/api/v1/demo/session").json()
        facilitator = {"Authorization": "Bearer " + tokens["facilitator"]}
        runs = []
        for start_id, target in (("trace-08", 480), ("trace-13", 780)):
            run_id = client.post("/api/v1/runs", headers=facilitator, json={
                "start_id": start_id, "scenario_id": "sx01-golden", "scenario_version": "1", "seed": 4242}).json()["run_id"]
            response = client.post(f"/api/v1/runs/{run_id}/advance", headers=facilitator, json={
                "advance_id": start_id, "expected_step": 0, "target_mission_s": target})
            assert response.status_code == 200, response.text
            runs.append(run_id)

    db = connect(database)
    try:
        report = compare_runs(db, *runs)
    finally:
        db.close()
    assert (report.baseline_as_of_s, report.variant_as_of_s) == (480, 780)
    rows = {(r.kind, r.ordinal): r for r in report.intervals}
    advice = rows[("advice", 1)]
    # At 08:00 the golden advice was just queued; by 13:00 it arrived and was held.
    assert advice.comparison == "baseline_open"
    assert (advice.baseline.end_s, advice.baseline.open_for_at_least_s) == (None, 0)
    assert (advice.variant.start_s, advice.variant.end_s, advice.variant.duration_s) == (480, 780, 300)
    assert advice.variant.latest_reason_code == "STALE_BASIS"
    assert advice.duration_delta_s is None
    assert rows[("incident", 1)].comparison == "both_open"
    assert rows[("incident", 2)].comparison == "only_variant"
