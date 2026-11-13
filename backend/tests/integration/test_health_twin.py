"""KAN-151: exercise the live health story against the actual role APIs."""

import json
from pathlib import Path
from contextlib import closing
from sqlite3 import connect

import pytest

from test_runs import local_client

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "scenarios/variants/health-story-v1.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((ROOT / "scenarios/expected/health-story-v1.json").read_text(encoding="utf-8"))
IDENTITY = {key: FIXTURE[key] for key in ("scenario_id", "scenario_version", "seed")}


@pytest.fixture
def mission(tmp_path):
    database = tmp_path / "health-story.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()

        def request(method, path="", *, role="crew", **kwargs):
            headers = {"Authorization": "Bearer " + tokens[role]} if role else {}
            return client.request(method, "/api/v1/runs" + path, headers=headers, **kwargs)

        start = request("POST", role="facilitator", json={**IDENTITY, "start_id": "health-story-test"})
        assert start.status_code == 200, start.text
        yield request, "/" + start.json()["run_id"], database


def twin(request, run, crew_id=FIXTURE["subject_crew_id"]):
    response = request("GET", run + "/crew/health-twin", params={"crew_id": crew_id})
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return response.json()


def advance(request, run, step, target):
    return request("POST", run + "/advance", role="facilitator", json={
        "advance_id": f"to-{target}", "expected_step": step, "target_mission_s": target,
    })


def test_health_story_clear_review_emergency_and_private_ground_delivery(mission):
    request, run, _ = mission
    crew_id = FIXTURE["subject_crew_id"]
    url = run + "/crew/health-twin"
    for role, status in ((None, 401), ("ground", 403), ("facilitator", 403)):
        assert request("GET", url, role=role, params={"crew_id": crew_id}).status_code == status
    assert request("GET", url, params={"crew_id": "unknown"}).status_code == 404
    assert twin(request, run, "SIM-02")["story_state"] == "unobserved"

    for step, checkpoint in enumerate(EXPECTED["crew_checkpoints_before_drill"]):
        mission_s = checkpoint["mission_s"]
        if step:
            response = advance(request, run, step - 1, mission_s)
            assert response.status_code == 200, response.text
            assert response.json()["step"] == step
        view = twin(request, run)
        assert (view["mission_s"], view["crew_id"], view["role"], view["synthetic"]) == (
            mission_s, crew_id, "crew", True,
        )
        assert view["story_state"] == checkpoint["story_state"]
        assert view["emergency"] is None and view["ground_delivery"] is None
        assessment, trend = view["health_assessment"], view["health_trend"]
        assert assessment["evidence"]["value"] == checkpoint["heart_rate_bpm"]
        assert assessment["personal"]["status"] == checkpoint["personal_status"]
        assert assessment["reference"]["status"] == checkpoint["reference_status"]
        assert (trend["status"], trend["sample_count"]) == (checkpoint["trend_status"], checkpoint["received_count"])
        if view["story_state"] == "review":
            assert assessment["personal"]["reason_code"] == checkpoint["personal_reason_code"]
            assert "above the personal range" in assessment["personal"]["reason"]
            for comparison in ("personal", "reference"):
                entry = assessment[comparison]
                assert [entry["range_low"], entry["range_high"]] == checkpoint[f"{comparison}_range_bpm"]
            assert (trend["direction"], trend["start_value"], trend["end_value"]) == (
                checkpoint["trend_direction"], checkpoint["trend_start_bpm"], checkpoint["trend_end_bpm"],
            )

    actions = FIXTURE["operator_rehearsal"]
    response = request("POST", run + "/crew/emergencies", json={
        **actions["open_drill"], "operation_id": "open-story-drill", "synthetic": True,
    })
    assert response.status_code == 201, response.text
    case = response.json()
    case_path = run + "/crew/emergencies/" + case["case_id"]
    view = twin(request, run)
    drill = EXPECTED["onboard_drill"]
    assert view["story_state"] == drill["story_state"]
    assert view["health_followup"]["precedence"] == drill["reminder_precedence"]
    assert view["emergency"] == case
    assert {key: case[key] for key in ("subject_crew_id", "opened_at_s", "owner")} == {
        key: drill[key] for key in ("subject_crew_id", "opened_at_s", "owner")
    }
    assert case["escalation"]["level"] == drill["escalation"]
    assert view["ground_delivery"]["status"] == "not_shared"
    assert twin(request, run, "SIM-02")["emergency"] is None
    assert request("GET", run + "/ground", role="ground").json()["health_cases"] == []

    acknowledged = request("POST", case_path + "/acknowledgment", json=actions["acknowledge_locally"])
    assert acknowledged.status_code == 200
    assert acknowledged.json()["status"] == drill["after_local_ack"]
    share = request("POST", case_path + "/relay", json={"operation_id": "share-story-status"})
    assert share.status_code == 200, share.text
    share = share.json()
    timing = EXPECTED["authorized_share"]
    for key in ("review_priority", "status", "issued_at_s", "deliver_at_s"):
        assert share[key] == timing[key]
    due = timing["deliver_at_s"]
    assert twin(request, run)["ground_delivery"] == {
        "status": "queued", "issued_at_s": 360, "deliver_at_s": due,
        "delivered_at_s": None, "remaining_s": 300,
    }

    step = 2
    for checkpoint in timing["ground_checkpoints"]:
        target_s = checkpoint["mission_s"]
        targets = (due - 1, due, target_s) if checkpoint["health_case_count"] else (target_s,)
        for target in targets:
            response = advance(request, run, step, target)
            assert response.status_code == 200, response.text
            step = response.json()["step"]
            ground = request("GET", run + "/ground", role="ground")
            assert ground.status_code == 200, ground.text
            cases = ground.json()["health_cases"]
            delivery = twin(request, run)["ground_delivery"]
            assert delivery["remaining_s"] == max(0, due - target)
            for marker in EXPECTED["ground_forbidden_markers"] + ["story_state", "ground_delivery", "emergency"]:
                assert marker not in ground.text, marker
            if target < due:
                assert delivery["status"] == "queued" and cases == []
                assert share["case_alias"] not in ground.text
            else:
                assert delivery["status"] == "delivered" and delivery["delivered_at_s"] == due
                assert len(cases) == checkpoint["health_case_count"]
                assert cases[0]["case_alias"] == share["case_alias"]
                assert set(cases[0]) == set(timing["ground_case_fields"])
                assert cases[0]["delivered_at_s"] == checkpoint["delivered_at_s"]
                assert cases[0]["ground_ack"] == checkpoint["ground_ack"]


def test_medical_cases_hide_future_evidence_and_stay_onboard(mission):
    request, run, _ = mission
    initial = twin(request, run)["medical_timeline"]
    assert [case["id"] for case in initial["cases"]] == ["inflammation", "sensitivity", "illness"]
    assert all(not case["events"] for case in initial["cases"])
    assert twin(request, run, "SIM-02")["medical_timeline"]["cases"] == []
    for step, now in enumerate((120, 180, 360)):
        assert advance(request, run, step, now).status_code == 200
        by_id = {case["id"]: case for case in twin(request, run)["medical_timeline"]["cases"]}
        assert by_id["inflammation"]["events"][1]["quality"] == "conflicting"
        assert by_id["sensitivity"]["events"][1]["quality"] == "unknown"
        assert by_id["sensitivity"]["history"][0]["kind"] == "allergy_note"
        assert all(len(case["events"]) == step + 2 for case in by_id.values())
    ground = request("GET", run + "/ground", role="ground")
    assert all(marker not in ground.text for marker in ("medical_timeline", "allergy_note", "swelling"))
    assert request("GET", run + "/crew/health-twin", role="ground", params={"crew_id": "SIM-01"}).status_code == 403


def test_gravity_context_follows_phase_boundaries_and_stays_onboard(mission):
    request, run, _ = mission
    assert twin(request, run, "SIM-02")["gravity_context"] is None
    checkpoints = [
        (0, "preflight", 0, 0, 60),
        (59, "preflight", 59, 0, 60),
        (60, "orbit", 0, 0, 900),
        (899, "orbit", 839, 839, 900),
        (900, "reentry", 0, 840, 960),
        (960, "recovery", 0, 840, None),
        (975, "recovery", 15, 840, None),
    ]
    for step, (target, phase, elapsed, exposure, next_at) in enumerate(checkpoints):
        if step:
            response = advance(request, run, step - 1, target)
            assert response.status_code == 200, response.text
        context = twin(request, run)["gravity_context"]
        assert context["synthetic"] is True
        assert context["baseline"]["mobility"] == "Walking"
        assert (context["current"]["phase"], context["elapsed_in_phase_s"], context["orbital_exposure_s"],
                context["next_phase_at_s"]) == (phase, elapsed, exposure, next_at)
    assert "gravity_context" not in request("GET", run + "/ground", role="ground").json()


def test_health_story_jump_is_atomic_retryable_and_resets(mission, monkeypatch):
    from symbiosis_x.crew import measurements

    request, run, database = mission
    assert request("POST", role="facilitator", json={**IDENTITY, "seed": 1, "start_id": "wrong"}).status_code == 409
    assert request("POST", run + "/advance", role="facilitator", json={
        "advance_id": "missing-target", "expected_step": 0,
    }).json() == {"detail": "HEALTH_STORY_TARGET_REQUIRED"}
    assert advance(request, run, 0, 0).status_code == 409
    assert advance(request, run, 1, 360).json() == {"detail": "STALE_STEP"}

    reserved = request("POST", run + "/crew/measurements", json={
        "measurement_id": FIXTURE["readings"][1]["measurement_id"],
        "crew_id": FIXTURE["subject_crew_id"], "synthetic": True,
        "measurement": {**FIXTURE["reading_template"], "observed_at_s": 0, "value": 120},
        "context": FIXTURE["reading_context"],
    })
    assert reserved.status_code == 409
    assert reserved.json() == {"detail": "SCRIPTED_MEASUREMENT_ID_RESERVED"}

    record = measurements.record_measurement

    def fail_on_third(db, run_id, command, **kwargs):
        if command.measurement_id == FIXTURE["readings"][-1]["measurement_id"]:
            raise RuntimeError("injected failure after the second reading")
        return record(db, run_id, command, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(measurements, "record_measurement", fail_on_third)
        with pytest.raises(RuntimeError, match="injected failure"):
            advance(request, run, 0, 360)
    assert twin(request, run)["mission_s"] == 0
    assert twin(request, run)["health_trend"]["sample_count"] == 1

    jumped = advance(request, run, 0, 360)
    assert jumped.status_code == 200, jumped.text
    assert advance(request, run, 0, 360).json() == jumped.json()
    assert twin(request, run)["story_state"] == "review"
    with closing(connect(database)) as db:
        rows = db.execute(
            """SELECT h.event_id, h.observed_at_s, h.received_at_s, e.mission_s, e.visibility
               FROM health_observations h JOIN events e ON (h.run_id, h.event_id) = (e.run_id, e.event_id)
               WHERE h.run_id = ? ORDER BY e.event_seq""",
            (jumped.json()["run_id"],),
        ).fetchall()
        assert rows == [
            (row["measurement_id"], row["observed_at_s"], row["received_at_s"], row["received_at_s"], "crew")
            for row in FIXTURE["readings"]
        ]

    reset = request("POST", run + "/reset", role="facilitator", json={"reset_id": "start-again"})
    assert reset.status_code == 200, reset.text
    new_run = "/" + reset.json()["run_id"]
    assert twin(request, new_run)["story_state"] == "clear"
    assert twin(request, new_run)["health_trend"]["sample_count"] == 1
    assert advance(request, run, 1, 660).json() == {"detail": "RUN_CLOSED"}
    assert advance(request, new_run, 0, 61).json()["step"] == 1
    ended = request("POST", new_run + "/end", role="facilitator", json={"end_id": "finish"})
    assert ended.json()["step"] == 1
