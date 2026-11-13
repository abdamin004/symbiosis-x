"""SX-16: compare agent trace timing across two saved runs.

Each case in a run's operational trace becomes one interval. It starts at the
case's first milestone and is completed only by a recorded terminal step; the
journal has no other completion event. A case without one is open: it has no
end time and no duration, only a lower bound up to the time the run was read.
Open time is never reported as zero and never subtracted as if it had ended.

Cases are matched across runs by kind and the order they were opened (the
second incident in one run against the second incident in the other), since
case IDs are run-specific. The comparison reads the role-filtered Crew trace,
so it carries no tool input, evidence or private data.
"""

from dataclasses import dataclass
from sqlite3 import Connection
from typing import Literal

from symbiosis_x.application.projections import read_run, read_trace
from symbiosis_x.contracts.projections import TraceRecord

# The only recorded step that ends a case: relayed advice was classified onboard.
TERMINAL_STEPS = frozenset({"advice_received"})

CaseKind = Literal["incident", "advice"]
Comparison = Literal["both_completed", "baseline_open", "variant_open", "both_open", "only_baseline", "only_variant"]


@dataclass(frozen=True)
class CaseInterval:
    case_id: str
    kind: CaseKind
    ordinal: int                  # 1 = first case of this kind opened in the run
    start_s: int
    end_s: int | None             # None while the case is open
    duration_s: int | None        # None while the case is open; never zero-filled
    open_for_at_least_s: int | None  # lower bound for an open case at as_of_s
    as_of_s: int
    steps: tuple[str, ...]
    latest_result: str
    latest_reason_code: str | None

    @property
    def is_open(self) -> bool:
        return self.end_s is None


@dataclass(frozen=True)
class IntervalComparison:
    kind: CaseKind
    ordinal: int
    comparison: Comparison
    baseline: CaseInterval | None
    variant: CaseInterval | None
    start_delta_s: int | None     # variant minus baseline, when both cases exist
    duration_delta_s: int | None  # only when both intervals completed


@dataclass(frozen=True)
class TraceComparison:
    baseline_run_id: str
    variant_run_id: str
    baseline_as_of_s: int
    variant_as_of_s: int
    intervals: tuple[IntervalComparison, ...]


def _kind(case_id: str) -> CaseKind:
    return "advice" if case_id.startswith("advice-") else "incident"


def case_intervals(trace: list[TraceRecord], *, as_of_s: int) -> list[CaseInterval]:
    """Group a trace into one interval per case, in the order cases opened."""
    if any(record.mission_s > as_of_s for record in trace):
        raise ValueError("trace has milestones after as_of_s")
    cases: dict[str, list[TraceRecord]] = {}
    for record in trace:
        cases.setdefault(record.case_id, []).append(record)
    ordinals: dict[CaseKind, int] = {}
    intervals = []
    for case_id, records in cases.items():
        kind = _kind(case_id)
        ordinals[kind] = ordinals.get(kind, 0) + 1
        start = records[0].mission_s
        end = next((r.mission_s for r in records if r.step in TERMINAL_STEPS), None)
        intervals.append(CaseInterval(
            case_id=case_id, kind=kind, ordinal=ordinals[kind], start_s=start, end_s=end,
            duration_s=None if end is None else end - start,
            open_for_at_least_s=as_of_s - start if end is None else None,
            as_of_s=as_of_s, steps=tuple(r.step for r in records),
            latest_result=records[-1].result, latest_reason_code=records[-1].reason_code,
        ))
    return intervals


def compare_intervals(baseline: list[CaseInterval], variant: list[CaseInterval]) -> tuple[IntervalComparison, ...]:
    """Match cases by kind and opening order, and compare only what was recorded."""
    left = {(i.kind, i.ordinal): i for i in baseline}
    right = {(i.kind, i.ordinal): i for i in variant}
    keys = sorted(left.keys() | right.keys(), key=lambda key: (key[0] != "incident", key[1]))
    rows = []
    for kind, ordinal in keys:
        a, b = left.get((kind, ordinal)), right.get((kind, ordinal))
        if a is None or b is None:
            comparison = "only_variant" if a is None else "only_baseline"
        elif a.is_open and b.is_open:
            comparison = "both_open"
        elif a.is_open or b.is_open:
            comparison = "baseline_open" if a.is_open else "variant_open"
        else:
            comparison = "both_completed"
        rows.append(IntervalComparison(
            kind=kind, ordinal=ordinal, comparison=comparison, baseline=a, variant=b,
            start_delta_s=b.start_s - a.start_s if a and b else None,
            duration_delta_s=b.duration_s - a.duration_s if comparison == "both_completed" else None,
        ))
    return tuple(rows)


def compare_runs(db: Connection, baseline_run_id: str, variant_run_id: str) -> TraceComparison:
    """Compare two saved runs, each read at its own current mission time."""
    reads = []
    for run_id in (baseline_run_id, variant_run_id):
        as_of = read_run(db, run_id)["mission_s"]
        reads.append((as_of, case_intervals(read_trace(db, run_id, as_of), as_of_s=as_of)))
    (baseline_as_of, baseline), (variant_as_of, variant) = reads
    return TraceComparison(baseline_run_id, variant_run_id, baseline_as_of, variant_as_of,
                           compare_intervals(baseline, variant))
