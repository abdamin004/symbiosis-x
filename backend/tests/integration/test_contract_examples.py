"""Validate the static SX-01A wire examples before the API models land."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
EXAMPLES = {
    "crew-v103": "crew",
    "ground-v102": "ground",
    "candidate-results": "candidateResults",
    "action-receipts": "actionReceipt",
}


@pytest.fixture
def examples():
    return {
        name: json.loads((CONTRACTS / "examples" / f"{name}.json").read_text())
        for name in EXAMPLES
    }


def test_examples_match_role_schemas(examples):
    schema = json.loads((CONTRACTS / "schemas" / "sx-01a.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    for name, shape in EXAMPLES.items():
        role_validator = validator.evolve(schema={"$defs": schema["$defs"], "$ref": f"#/$defs/{shape}"})
        role_validator.validate(examples[name])

    crew = examples["crew-v103"]["crew"]
    for path in ((), ("delivery",), ("equipment", "power_headroom")):
        ground = deepcopy(examples["ground-v102"])
        target = ground
        for field in path:
            target = target[field]
        target["crew"] = crew
        with pytest.raises(ValidationError):
            validator.validate(ground)


    ground = deepcopy(examples["ground-v102"])
    ground["equipment"]["co2"]["kind"] = "modeled_estimate"
    with pytest.raises(ValidationError):
        validator.validate(ground)

    plan = deepcopy(examples["candidate-results"])
    candidate = plan["candidates"][0]
    plan["candidates"] = [{**candidate, "peak_co2_ppm": peak} for peak in (3757, 3758, 3759)]
    with pytest.raises(ValidationError):
        validator.validate(plan)


def test_examples_preserve_the_golden_handoff(examples):
    crew = examples["crew-v103"]
    ground = examples["ground-v102"]
    plan = examples["candidate-results"]
    receipt = examples["action-receipts"]

    assert crew["run_id"] == ground["run_id"]
    assert crew["scenario_id"] == ground["scenario_id"] == "sx01-golden"
    assert crew["seed"] == ground["seed"] == 4242
    assert crew["mission_s"] == ground["mission_s"] == 780
    assert crew["decision_rev"] == receipt["current_decision_rev"] == 103
    assert ground["decision_rev"] == receipt["basis_decision_rev"] == 102
    assert crew["equipment"]["power_headroom"]["value"] == 0.20
    assert ground["equipment"]["power_headroom"]["value"] == 0.60
    assert crew["equipment"]["co2"]["kind"] == "modeled_estimate"
    assert ground["equipment"]["co2"]["kind"] == "delivered_observation"

    delivery = ground["delivery"]
    assert delivery["observed_at_s"] == 60
    assert delivery["received_at_s"] == 360
    assert delivery["age_s"] == ground["mission_s"] - delivery["observed_at_s"]
    assert crew["crew"]["check_in"]["text"] not in json.dumps(ground)

    assert plan["basis_snapshot_id"] == crew["snapshot_id"]
    assert plan["expected_decision_rev"] == crew["decision_rev"]
    assert plan["horizon_s"] == 21600
    candidates = {item["candidate_id"]: item for item in plan["candidates"]}
    assert set(candidates) == {"hold_course", "start_standby", "reduce_activity"}
    assert candidates["hold_course"]["peak_co2_ppm"] == 3757.12
    assert candidates["start_standby"]["required_kw"] == 0.40
    assert candidates["start_standby"]["available_kw"] == crew["equipment"]["power_headroom"]["value"]
    assert receipt["applied"] is False


def test_published_examples_validate(examples):
    from pydantic import ValidationError as ModelValidationError

    from symbiosis_x.contracts.commands import ActionReceipt, CandidateResults
    from symbiosis_x.contracts.events import ObservationEvent
    from symbiosis_x.contracts.projections import CrewProjection, GroundProjection
    from symbiosis_x.telemetry.sampling import CabinCO2Sensor

    for name, model in (
        ("crew-v103", CrewProjection), ("ground-v102", GroundProjection),
        ("candidate-results", CandidateResults), ("action-receipts", ActionReceipt),
    ):
        assert model.model_validate(examples[name]).model_dump() == examples[name]

    ground = deepcopy(examples["ground-v102"])
    ground["equipment"]["co2"]["private_check_in"] = "private"
    with pytest.raises(ModelValidationError, match="extra_forbidden"):
        GroundProjection.model_validate(ground)

    sensors = CONTRACTS.parent / "catalogs/sx01/sensors.json"
    sensor = CabinCO2Sensor(**json.loads(sensors.read_text())["sensors"][0])
    sample = sensor.sample(2000, run_id="run-001", mission_s=60, model_version="cabin-1")
    assert ObservationEvent.model_validate(sample).payload.unit == "ppm"


def test_all_metrics_have_sourced_guides():
    from urllib.parse import urlparse

    catalogs = CONTRACTS.parent / "catalogs" / "crew"
    metrics = json.loads((catalogs / "health-metrics.json").read_text(encoding="utf-8"))
    guides = json.loads((catalogs / "health-guides.json").read_text(encoding="utf-8"))
    assert guides["synthetic_data_only"] is True

    metric_ids = [metric["id"] for metric in metrics["metrics"]]
    guide_ids = [guide["metric_id"] for guide in guides["guides"]]
    assert len(metric_ids) == 7
    assert sorted(guide_ids) == sorted(metric_ids)
    assert len(set(guide_ids)) == len(guide_ids)

    by_id = {guide["metric_id"]: guide for guide in guides["guides"]}
    for metric in metrics["metrics"]:
        guide = by_id[metric["id"]]
        for field in ("title", "what", "why", "context_note", "procedure_label"):
            assert isinstance(guide[field], str) and guide[field].strip(), (metric["id"], field)
        assert guide["how"] and all(step.strip() for step in guide["how"]), metric["id"]
        assert guide["capture"] in ("assigned_device", "manual_self_report"), metric["id"]
        if guide["capture"] == "assigned_device":
            assert guide["assigned_device"].strip(), metric["id"]
        else:
            assert guide["assigned_device"] is None, metric["id"]
        assert isinstance(guide["ground_based_procedure"], bool), metric["id"]
        if guide["ground_based_procedure"]:
            assert "ground-based" in guide["procedure_label"].lower(), metric["id"]

        assert guide["sources"], metric["id"]
        for source in guide["sources"]:
            for field in ("title", "publisher", "version", "url"):
                assert source[field].strip(), (metric["id"], field)
            link = urlparse(source["url"])
            assert link.scheme == "https" and link.netloc, (metric["id"], source["url"])

    assert by_id["mood"]["scale_id"] == next(
        m["scale"]["id"] for m in metrics["metrics"] if m["id"] == "mood")
    notes = {metric_id: guide["context_note"].lower() for metric_id, guide in by_id.items()}
    assert "exercise" in notes["heart_rate"] and "rest" in notes["heart_rate"]
    assert "cuff" in notes["blood_pressure"]
    assert "meter" in notes["glucose"] and "lab" in notes["glucose"]
    assert "site" in notes["temperature"]
    assert "sleep period" in notes["sleep"]
    assert "self-report" in notes["mood"] and "self-report" in notes["symptoms"]
