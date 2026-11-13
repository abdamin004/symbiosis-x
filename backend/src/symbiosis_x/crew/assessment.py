"""Explain one synthetic health reading against two independent references.

The personal baseline and the applicable sourced reference are evaluated
separately and never merged into one verdict. Each comparison checks the
reading's quality, method, unit and context first. Anything unsupported comes
back as unknown or reference unavailable, so missing context never produces a
normal result. Earth-based references are labelled as such, and every result
carries its rule ID, rules version and evidence.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Mapping

from symbiosis_x.contracts.health import validate_health_measurement
from symbiosis_x.crew.profile import AstronautHealthProfile, load_profile

DEFAULT_RULES_PATH = (
    Path(__file__).resolve().parents[4] / "catalogs" / "crew" / "health-reference-rules.json"
)

Status = Literal[
    "within_personal_range", "outside_personal_range",
    "within_reference", "outside_reference",
    "unknown", "baseline_unavailable", "reference_unavailable", "contextual",
]


@dataclass(frozen=True)
class Comparison:
    status: Status
    reason_code: str
    reason: str
    rule_id: str | None = None
    rules_version: str | None = None
    range_low: float | None = None
    range_high: float | None = None
    unit: str | None = None
    earth_based: bool = False
    label: str | None = None
    category: str | None = None
    source: Mapping[str, str] | None = None


@dataclass(frozen=True)
class Assessment:
    metric: str
    crew_id: str
    observed_at_s: int
    rules_version: str
    personal: Comparison
    reference: Comparison
    evidence: Mapping[str, Any] = field(default_factory=dict)
    synthetic: bool = True
    visibility: str = "onboard_private"


def load_rules(path: str | Path | None = None) -> dict:
    rules = json.loads(Path(path or DEFAULT_RULES_PATH).read_text(encoding="utf-8"))
    if rules.get("schema_version") != 1 or rules.get("synthetic_data_only") is not True:
        raise ValueError("unsupported health reference rules catalog")
    return rules


def _missing_or_mismatched(requires: Mapping[str, list], context: Mapping[str, Any]):
    """Return (missing keys, mismatched keys) for a rule's required context."""
    missing = [key for key in requires if context.get(key) in (None, "")]
    mismatched = [key for key in requires if key not in missing and context[key] not in requires[key]]
    return missing, mismatched


def _gate(requires, context, *, unavailable_status: Status):
    """Return a Comparison that stops evaluation, or None when context fits."""
    missing, mismatched = _missing_or_mismatched(requires, context)
    if missing:
        return Comparison("unknown", "MISSING_CONTEXT",
                          f"Missing context: {', '.join(missing)}. No comparison is made.")
    if mismatched:
        detail = ", ".join(f"{key}={context[key]}" for key in mismatched)
        return Comparison(unavailable_status, "CONTEXT_NOT_SUPPORTED",
                          f"This comparison does not apply to {detail}.")
    return None


def _with_rule(result: Comparison, rule: Mapping, rules_version: str, **extra) -> Comparison:
    values = {**result.__dict__, "rule_id": rule["rule_id"], "rules_version": rules_version,
              "unit": rule.get("unit"), **extra}
    return Comparison(**values)


def _personal(measurement, context, profile: AstronautHealthProfile, rules) -> Comparison:
    version = rules["rules_version"]
    rule = next((r for r in rules["personal_baseline_rules"] if r["metric"] == measurement.metric), None)
    baseline = next((b for b in profile.baselines if b.metric == measurement.metric), None)
    if rule is None or baseline is None:
        return Comparison("baseline_unavailable", "NO_PERSONAL_BASELINE",
                          f"No personal baseline is recorded for {measurement.metric}.",
                          rules_version=version)
    if baseline.unit != rule["unit"] or measurement.unit != rule["unit"]:
        return _with_rule(Comparison("unknown", "UNIT_MISMATCH",
                                     "The reading and baseline units do not match."), rule, version)
    stop = _gate(rule["requires_context"], context, unavailable_status="unknown")
    if stop:
        return _with_rule(stop, rule, version)

    low = baseline.value - rule["band_below"]
    high = baseline.value + rule["band_above"]
    value = measurement.value
    inside = low <= value <= high
    direction = "above" if value > high else "below"
    reason = (
        f"{value:g} {rule['unit']} is within the personal range {low:g}–{high:g} {rule['unit']} "
        f"around the {baseline.value:g} {rule['unit']} resting baseline."
        if inside else
        f"{value:g} {rule['unit']} is {direction} the personal range {low:g}–{high:g} {rule['unit']} "
        f"around the {baseline.value:g} {rule['unit']} resting baseline ({value - baseline.value:+g} "
        f"{rule['unit']}). Synthetic demo band, not a diagnosis."
    )
    return _with_rule(
        Comparison("within_personal_range" if inside else "outside_personal_range",
                   "WITHIN_PERSONAL_RANGE" if inside else f"{direction.upper()}_PERSONAL_RANGE", reason),
        rule, version, range_low=low, range_high=high,
        source={"baseline_source": rule["baseline_source"], "baseline_id": baseline.source_id},
    )


def _bp_category(rule, systolic: float, diastolic: float) -> str:
    def test(spec, key, value):
        if f"{key}_above" in spec:
            return value > spec[f"{key}_above"]
        if f"{key}_at_least" in spec:
            return value >= spec[f"{key}_at_least"]
        return value < spec[f"{key}_below"]

    for spec in rule["categories"]:
        hits = (test(spec, "systolic", systolic), test(spec, "diastolic", diastolic))
        if any(hits) if spec["combine"] == "or" else all(hits):
            return spec["category"]
    raise ValueError("blood pressure did not match any category")


def _reference(measurement, context, rules) -> Comparison:
    version = rules["rules_version"]
    rule = next((r for r in rules["reference_rules"] if r["metric"] == measurement.metric), None)
    if rule is None:
        return Comparison("reference_unavailable", "NO_SOURCED_REFERENCE",
                          f"No sourced reference applies to {measurement.metric}.", rules_version=version)
    labelled = {"earth_based": rule["earth_based"], "source": rule["source"],
                "label": rules["earth_based_label"] if rule["earth_based"] else None}
    if measurement.unit != rule["unit"]:
        return _with_rule(Comparison("unknown", "UNIT_MISMATCH",
                                     "The reading unit does not match the reference."), rule, version, **labelled)
    if rule["kind"] == "fasting_plasma_glucose" and context.get("method") in rule["handheld_methods"]:
        return _with_rule(Comparison(
            "reference_unavailable", "LAB_CUTOFF_NOT_FOR_HANDHELD",
            "Laboratory fasting plasma glucose cutoffs are not applied to a handheld meter reading."),
            rule, version, **labelled)
    stop = _gate(rule["requires_context"], context, unavailable_status="reference_unavailable")
    if stop:
        return _with_rule(stop, rule, version, **labelled)

    unit = rule["unit"]
    if rule["kind"] == "range":
        value, low, high = measurement.value, rule["low"], rule["high"]
        inside = low <= value <= high
        fever = rule.get("fever_above")
        category = "above_fever_threshold" if fever is not None and value > fever else None
        reason = (f"{value:g} {unit} is {'within' if inside else 'outside'} the Earth-based reference "
                  f"{low:g}–{high:g} {unit}.")
        if category:
            reason += f" It is above the {fever:g} {unit} fever threshold."
        return _with_rule(Comparison("within_reference" if inside else "outside_reference",
                                     "WITHIN_REFERENCE" if inside else "OUTSIDE_REFERENCE", reason),
                          rule, version, range_low=low, range_high=high, category=category, **labelled)

    if rule["kind"] == "blood_pressure_categories":
        category = _bp_category(rule, measurement.systolic, measurement.diastolic)
        inside = category in rule["within_categories"]
        reason = (f"{measurement.systolic:g}/{measurement.diastolic:g} {unit} falls in the "
                  f"{category.replace('_', ' ')} category of the Earth-based reference.")
        return _with_rule(Comparison("within_reference" if inside else "outside_reference",
                                     "WITHIN_REFERENCE" if inside else "OUTSIDE_REFERENCE", reason),
                          rule, version, category=category, range_high=None, **labelled)

    if rule["kind"] == "fasting_plasma_glucose":
        value = measurement.value
        if value >= rule["diabetes_at_least"]:
            category = "diabetes_range"
        elif value >= rule["below_prediabetes"]:
            category = "prediabetes_range"
        else:
            category = "below_prediabetes"
        inside = category == "below_prediabetes"
        reason = (f"Fasting lab plasma glucose {value:g} {unit} is in the {category.replace('_', ' ')} "
                  f"of the Earth-based reference (prediabetes from {rule['below_prediabetes']:g}, "
                  f"diabetes from {rule['diabetes_at_least']:g} {unit}).")
        return _with_rule(Comparison("within_reference" if inside else "outside_reference",
                                     "WITHIN_REFERENCE" if inside else "OUTSIDE_REFERENCE", reason),
                          rule, version, range_high=rule["below_prediabetes"], category=category,
                          **labelled)

    raise ValueError(f"unknown reference rule kind {rule['kind']}")


def assess(
    payload: Mapping[str, Any],
    *,
    context: Mapping[str, Any] | None = None,
    profile: AstronautHealthProfile | None = None,
    rules: dict | None = None,
) -> Assessment:
    """Assess one reading against the personal baseline and the sourced reference.

    ``context`` holds facts the reading itself does not carry, such as
    ``activity`` for heart rate or ``method`` and ``posture`` for blood
    pressure. Glucose method, meal context and temperature site are taken from
    the reading.
    """
    measurement = validate_health_measurement(dict(payload))
    profile = profile or load_profile()
    rules = rules or load_rules()
    version = rules["rules_version"]
    context = {**(context or {})}
    for key in ("method", "meal_context", "site"):
        if getattr(measurement, key, None) is not None:
            context[key] = getattr(measurement, key)

    evidence = {
        "source_id": measurement.source_id,
        "observed_at_s": measurement.observed_at_s,
        "quality": measurement.quality,
        "context": dict(context),
    }
    for key in ("value", "systolic", "diastolic", "unit", "score", "symptoms", "duration_min"):
        if getattr(measurement, key, None) is not None:
            evidence[key] = getattr(measurement, key)
    if measurement.metric == "sleep" and "duration_min" not in evidence and measurement.start_mission_s is not None:
        evidence["duration_min"] = (measurement.end_mission_s - measurement.start_mission_s) / 60

    def build(personal: Comparison, reference: Comparison) -> Assessment:
        return Assessment(measurement.metric, profile.crew_id, measurement.observed_at_s,
                          version, personal, reference, evidence)

    contextual = next((c for c in rules["contextual_metrics"] if c["metric"] == measurement.metric), None)
    if contextual:
        note = Comparison("contextual", "CONTEXT_ONLY", contextual["note"], rules_version=version)
        return build(note, note)

    if measurement.quality != "valid":
        rejected = Comparison("unknown", "QUALITY_REJECTED",
                              f"The reading quality is {measurement.quality}, so it is not compared.",
                              rules_version=version)
        return build(rejected, rejected)

    return build(_personal(measurement, context, profile, rules), _reference(measurement, context, rules))
