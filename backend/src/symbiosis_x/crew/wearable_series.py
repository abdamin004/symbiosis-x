"""Read and replay one private, synthetic wristband and back-pod fixture."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal

DEFAULT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[4] / "scenarios" / "variants" / "crew-wearables-v1.json"
)
EVENT_TYPE = "health.measurement.recorded"
WRISTBAND_SOURCE = "sim.crew.wristband"
BACK_POD_SOURCE = "sim.crew.back_pod"


@dataclass(frozen=True)
class WearableObservation:
    """Private journal metadata and the scalar health observation fields."""

    run_id: str
    crew_id: str
    event_id: str
    source_id: str
    metric: str
    unit: str
    observed_at_s: int
    received_at_s: int
    value: float | None
    quality: Literal["valid", "suspect", "unavailable"]
    context: dict[str, str]
    visibility: Literal["crew"] = "crew"
    synthetic: Literal[True] = True
    event_type: Literal["health.measurement.recorded"] = EVENT_TYPE


@dataclass(frozen=True)
class WearableReading:
    status: Literal["accepted", "held", "stale", "missing"]
    accepted: WearableObservation | None
    age_s: int | None
    evidence: WearableObservation | None


def load_wearable_fixture(path: str | Path = DEFAULT_FIXTURE_PATH) -> dict:
    """Read the pinned, hand-authored scenario. No random values are generated."""
    fixture = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        (fixture.get("schema_version"), fixture.get("scenario_id"),
         fixture.get("scenario_version"), fixture.get("seed")) != (1, "crew-wearables", "1", 4242)
        or fixture.get("synthetic") is not True
        or fixture.get("visibility") != "crew"
    ):
        raise ValueError("expected the private synthetic crew wearables v1 fixture")

    rows = [*fixture["deliveries"], fixture["recheck_repeat"]]
    ids = {row["sample_id"] for row in rows}
    if len(ids) != len(rows):
        raise ValueError("wearable sample IDs must be unique")
    for row in rows:
        observed, received = row["observed_at_s"], row["received_at_s"]
        if type(observed) is not int or type(received) is not int or not 0 <= observed <= received:
            raise ValueError("wearable times must be ordered integer mission seconds")
        quality = row["quality"]
        if quality == "unavailable":
            valid_value = row["value"] is None
        else:
            valid_value = quality in {"valid", "suspect"} and type(row["value"]) in {int, float}
        if not valid_value:
            raise ValueError("wearable value does not match its quality")
        for key in ("motion_sample_id", "repeat_of_sample_id"):
            if key in row and row[key] not in ids - {row["sample_id"]}:
                raise ValueError("wearable evidence link must name another fixture sample")
    repeat = fixture["recheck_repeat"]
    trigger = next((row for row in fixture["deliveries"]
                    if row["sample_id"] == repeat.get("repeat_of_sample_id")), None)
    if (
        trigger is None or trigger["quality"] != "suspect" or repeat["quality"] != "valid"
        or (repeat["channel"], repeat["activity"]) != (trigger["channel"], trigger["activity"])
        or not trigger["received_at_s"] < repeat["observed_at_s"]
        or not repeat["received_at_s"] < fixture["recheck"]["expires_at_s"]
    ):
        raise ValueError("wearable recheck requires a later, comparable repeat before expiry")
    return fixture


def _event_id(crew_id: str, sample_id: str) -> str:
    # The journal already scopes event IDs by run.
    return f"crew-wearables-v1:{crew_id}:{sample_id}"


def _observation(fixture: dict, row: dict, *, run_id: str, crew_id: str) -> WearableObservation:
    if not run_id or not crew_id:
        raise ValueError("wearable observations require a run ID and an approved crew ID")
    context = {"activity": row["activity"], "provenance": "synthetic_fixture"}
    if "reason_code" in row:
        context["reason_code"] = row["reason_code"]
    if "motion_sample_id" in row:
        context["motion_event_id"] = _event_id(crew_id, row["motion_sample_id"])
    if "repeat_of_sample_id" in row:
        context["sample_role"] = "recheck_repeat"
        context["repeat_of_event_id"] = _event_id(crew_id, row["repeat_of_sample_id"])
    return WearableObservation(
        run_id=run_id, crew_id=crew_id, event_id=_event_id(crew_id, row["sample_id"]),
        **fixture["channels"][row["channel"]],
        observed_at_s=row["observed_at_s"], received_at_s=row["received_at_s"],
        value=row["value"], quality=row["quality"], context=context,
    )


def wearable_deliveries(
    fixture: dict, *, run_id: str, crew_id: str, through_s: int, after_s: int = -1,
) -> tuple[WearableObservation, ...]:
    """Return automatic delivery attempts in receipt order for (after_s, through_s].

    Include an exact retry with the same event ID so the journal can deduplicate it.
    The caller owns roster validation and persistence.
    """
    deliveries = []
    for row in sorted(fixture["deliveries"], key=lambda row: row["received_at_s"]):
        if after_s < row["received_at_s"] <= through_s:
            sample = _observation(fixture, row, run_id=run_id, crew_id=crew_id)
            deliveries.append(sample)
            if row.get("duplicate"):
                deliveries.append(sample)
    return tuple(deliveries)


def recheck_observation(fixture: dict, *, run_id: str, crew_id: str) -> WearableObservation:
    """Return the scripted repeat for the authorized recheck, outside automatic replay."""
    return _observation(fixture, fixture["recheck_repeat"], run_id=run_id, crew_id=crew_id)


def wearable_reading_at(
    observations: Iterable[WearableObservation], *,
    run_id: str, crew_id: str, source_id: str, metric: str, mission_s: int, max_age_s: int,
) -> WearableReading:
    """Find one signal's last good reading and any newer evidence received by mission_s."""
    def order(sample: WearableObservation) -> tuple[int, int, str]:
        return sample.observed_at_s, sample.received_at_s, sample.event_id

    accepted = evidence = None
    for sample in observations:
        if (
            (sample.run_id, sample.crew_id, sample.source_id, sample.metric)
            != (run_id, crew_id, source_id, metric)
            or sample.received_at_s > mission_s
        ):
            continue
        if sample.quality == "valid":
            if accepted is None or order(sample) > order(accepted):
                accepted = sample
        elif evidence is None or order(sample) > order(evidence):
            evidence = sample

    if accepted is None:
        return WearableReading("missing", None, None, evidence)
    age = mission_s - accepted.observed_at_s
    if evidence is not None and order(evidence) > order(accepted):
        return WearableReading("held", accepted, age, evidence)
    return WearableReading("stale" if age > max_age_s else "accepted", accepted, age, None)
