"""Comparable synthetic Crew health trends for onboard review."""

import json
from dataclasses import dataclass, field
from math import isfinite
from pathlib import Path
from typing import Literal, Mapping, Sequence

DEFAULT_TREND_RULES_PATH = (
    Path(__file__).resolve().parents[4]
    / "catalogs"
    / "crew"
    / "health-trend-rules.json"
)

Quality = Literal["valid", "suspect", "unavailable"]
TrendStatus = Literal["review", "steady", "insufficient_history"]
TrendDirection = Literal["rising", "falling", "steady", "unknown"]


@dataclass(frozen=True)
class TrendRules:
    rules_version: str
    window_s: int
    minimum_samples: int
    comparability_context: Mapping[str, tuple[str, ...]]
    disclaimer: str


@dataclass(frozen=True)
class TrendSample:
    sample_id: str
    crew_id: str
    metric: str
    value: float | None
    unit: str
    observed_at_s: int
    quality: Quality
    source_id: str
    context: Mapping[str, str] = field(default_factory=dict)
    synthetic: bool = True


@dataclass(frozen=True)
class HealthTrend:
    status: TrendStatus
    direction: TrendDirection
    reason_code: str
    reason: str
    crew_id: str | None
    metric: str | None
    unit: str | None
    sample_count: int
    minimum_samples: int
    window_s: int
    start_observed_at_s: int | None = None
    end_observed_at_s: int | None = None
    start_value: float | None = None
    end_value: float | None = None
    change: float | None = None
    evidence_ids: tuple[str, ...] = ()
    rules_version: str = "health-trends-v1"
    synthetic: Literal[True] = True
    visibility: Literal["onboard_private"] = "onboard_private"


def load_trend_rules(path: str | Path | None = None) -> TrendRules:
    """Load and validate the shared synthetic trend window and comparability rules."""
    payload = json.loads(Path(path or DEFAULT_TREND_RULES_PATH).read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or payload.get("synthetic_data_only") is not True:
        raise ValueError("unsupported health trend rules catalog")
    window_s = payload.get("window_s")
    minimum_samples = payload.get("minimum_samples")
    if type(window_s) is not int or window_s <= 0:
        raise ValueError("health trend window_s must be a positive integer")
    if type(minimum_samples) is not int or minimum_samples < 2:
        raise ValueError("health trend minimum_samples must be at least two")
    groups = payload.get("comparability_context")
    if not isinstance(groups, dict) or not groups:
        raise ValueError("health trend comparability_context must be a non-empty object")
    if any(not isinstance(keys, list) or any(not isinstance(key, str) for key in keys)
           for keys in groups.values()):
        raise ValueError("health trend context keys must be lists of strings")
    disclaimer = payload.get("disclaimer")
    if not isinstance(disclaimer, str) or not disclaimer.strip():
        raise ValueError("health trend disclaimer is required")
    return TrendRules(
        rules_version=payload.get("rules_version", "health-trends-v1"),
        window_s=window_s,
        minimum_samples=minimum_samples,
        comparability_context={metric: tuple(keys) for metric, keys in groups.items()},
        disclaimer=disclaimer,
    )


def _validate_sample(sample: TrendSample) -> None:
    if not sample.sample_id or not sample.crew_id or not sample.metric or not sample.unit or not sample.source_id:
        raise ValueError("trend samples require IDs, metric, unit and source")
    if type(sample.observed_at_s) is not int or sample.observed_at_s < 0:
        raise ValueError("trend sample time must be a nonnegative integer")
    if sample.quality not in {"valid", "suspect", "unavailable"}:
        raise ValueError("trend sample quality is unsupported")
    if sample.quality == "valid" and (
        sample.value is None or not isfinite(sample.value)
    ):
        raise ValueError("valid trend samples require a finite value")
    if not sample.synthetic:
        raise ValueError("health trends accept synthetic samples only")


def _insufficient(
    *,
    reason_code: str,
    reason: str,
    anchor: TrendSample | None,
    rules: TrendRules,
    count: int = 0,
    evidence_ids: tuple[str, ...] = (),
    start_s: int | None = None,
    end_s: int | None = None,
) -> HealthTrend:
    return HealthTrend(
        status="insufficient_history",
        direction="unknown",
        reason_code=reason_code,
        reason=reason,
        crew_id=anchor.crew_id if anchor else None,
        metric=anchor.metric if anchor else None,
        unit=anchor.unit if anchor else None,
        sample_count=count,
        minimum_samples=rules.minimum_samples,
        window_s=rules.window_s,
        start_observed_at_s=start_s,
        end_observed_at_s=end_s,
        evidence_ids=evidence_ids,
        rules_version=rules.rules_version,
    )


def evaluate_trend(
    samples: Sequence[TrendSample],
    *,
    rules: TrendRules | None = None,
) -> HealthTrend:
    """Summarize one comparable series, ordered by observation time.

    The newest record anchors both the metric/context group and the fixture-defined
    window. Suspect and unavailable samples remain visible as records but never
    count as trend evidence. Incompatible units, methods or activities are excluded.
    """
    rules = rules or load_trend_rules()
    for sample in samples:
        _validate_sample(sample)
    ids = [sample.sample_id for sample in samples]
    if len(ids) != len(set(ids)):
        raise ValueError("trend sample IDs must be unique")
    if not samples:
        return _insufficient(
            reason_code="NO_SAMPLES",
            reason=f"No samples are available; {rules.minimum_samples} comparable samples are required.",
            anchor=None,
            rules=rules,
        )

    ordered = sorted(samples, key=lambda item: (item.observed_at_s, item.sample_id))
    anchor = ordered[-1]
    keys = rules.comparability_context.get(anchor.metric)
    if keys is None:
        return _insufficient(
            reason_code="TREND_UNSUPPORTED_METRIC",
            reason=f"No comparable trend rule is defined for {anchor.metric}.",
            anchor=anchor,
            rules=rules,
        )
    if any(anchor.context.get(key) in (None, "") for key in keys):
        missing = [key for key in keys if anchor.context.get(key) in (None, "")]
        return _insufficient(
            reason_code="MISSING_COMPARISON_CONTEXT",
            reason=f"Missing comparison context: {', '.join(missing)}. No trend is calculated.",
            anchor=anchor,
            rules=rules,
        )

    window_start_s = max(0, anchor.observed_at_s - rules.window_s)
    comparable = [
        sample
        for sample in ordered
        if sample.crew_id == anchor.crew_id
        and sample.metric == anchor.metric
        and sample.unit == anchor.unit
        and window_start_s <= sample.observed_at_s <= anchor.observed_at_s
        and sample.quality == "valid"
        and sample.value is not None
        and all(sample.context.get(key) == anchor.context.get(key) for key in keys)
    ]
    evidence_ids = tuple(sample.sample_id for sample in comparable)
    if len(comparable) < rules.minimum_samples:
        return _insufficient(
            reason_code="INSUFFICIENT_COMPARABLE_SAMPLES",
            reason=(f"Need {rules.minimum_samples} comparable valid samples within "
                    f"{rules.window_s} seconds; found {len(comparable)}."),
            anchor=anchor,
            rules=rules,
            count=len(comparable),
            evidence_ids=evidence_ids,
            start_s=comparable[0].observed_at_s if comparable else None,
            end_s=comparable[-1].observed_at_s if comparable else None,
        )

    first, latest = comparable[0], comparable[-1]
    change = latest.value - first.value
    direction: TrendDirection = "rising" if change > 0 else "falling" if change < 0 else "steady"
    status: TrendStatus = "steady" if direction == "steady" else "review"
    reason = (
        f"{anchor.metric.replace('_', ' ').capitalize()} {direction} from "
        f"{first.value:g} to {latest.value:g} {anchor.unit} across {len(comparable)} "
        f"comparable synthetic samples. {rules.disclaimer}"
    )
    return HealthTrend(
        status=status,
        direction=direction,
        reason_code="NO_DIRECTIONAL_CHANGE" if direction == "steady" else "COMPARABLE_TREND",
        reason=reason,
        crew_id=anchor.crew_id,
        metric=anchor.metric,
        unit=anchor.unit,
        sample_count=len(comparable),
        minimum_samples=rules.minimum_samples,
        window_s=rules.window_s,
        start_observed_at_s=first.observed_at_s,
        end_observed_at_s=latest.observed_at_s,
        start_value=first.value,
        end_value=latest.value,
        change=change,
        evidence_ids=evidence_ids,
        rules_version=rules.rules_version,
    )
