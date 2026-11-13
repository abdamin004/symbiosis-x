"""Pure standby-power check for the synthetic electrical bus.

Compare the standby scrubber's demand with the bus headroom, both in kW, and
return a ready, blocked or unknown outcome with the values it was judged on.
Missing evidence stays unknown; it never makes standby look ready.
"""

from dataclasses import dataclass
from math import isfinite
from typing import Literal

UNIT = "kW"
STANDBY_DEMAND_KW = 0.40
# Absorbs float noise such as 0.1 + 0.3 so an exact match is not blocked.
TOLERANCE_KW = 1e-9

Outcome = Literal["ready", "blocked", "unknown"]
ReasonCode = Literal[
    "POWER_LIMIT", "FEEDER_DISCONNECTED", "HEADROOM_UNKNOWN", "FEEDER_UNKNOWN",
]


@dataclass(frozen=True)
class StandbyPowerCheck:
    outcome: Outcome
    required_kw: float
    available_kw: float | None
    reason_code: ReasonCode | None = None
    unit: str = UNIT

    def as_rejected_candidate(self) -> dict:
        """Return the planner's rejected ``start_standby`` candidate for a power block."""
        if self.outcome != "blocked" or self.reason_code != "POWER_LIMIT":
            raise ValueError("only a power-limited standby maps to a rejected candidate")
        return {
            "candidate_id": "start_standby",
            "status": "rejected",
            "reason_code": "POWER_LIMIT",
            "required_kw": self.required_kw,
            "available_kw": self.available_kw,
        }


def _check_kw(name: str, value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number in {UNIT}")
    if not isfinite(value) or value < 0:
        raise ValueError(f"{name} must be finite and nonnegative")
    return float(value)


def check_standby_power(
    headroom_kw: float | None,
    demand_kw: float = STANDBY_DEMAND_KW,
    *,
    feeder_connected: bool | None = True,
) -> StandbyPowerCheck:
    """Decide whether the bus can carry the standby load.

    ``headroom_kw=None`` or ``feeder_connected=None`` means the evidence is
    missing, so the result is unknown rather than ready.
    """
    required = _check_kw("demand_kw", demand_kw)
    available = None if headroom_kw is None else _check_kw("headroom_kw", headroom_kw)

    if feeder_connected is False:
        return StandbyPowerCheck("blocked", required, available, "FEEDER_DISCONNECTED")
    if available is not None and required > available + TOLERANCE_KW:
        # A known shortfall blocks even when the feeder evidence is missing.
        return StandbyPowerCheck("blocked", required, available, "POWER_LIMIT")
    if available is None:
        return StandbyPowerCheck("unknown", required, None, "HEADROOM_UNKNOWN")
    if feeder_connected is None:
        return StandbyPowerCheck("unknown", required, available, "FEEDER_UNKNOWN")
    return StandbyPowerCheck("ready", required, available)
