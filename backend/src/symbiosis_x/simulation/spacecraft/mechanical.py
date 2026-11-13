"""Pure hatch readiness check for the synthetic docking port.

Mechanical capture and hatch authorization are separate. Capture only holds
the vehicles together; the hatch may open only after seal and pressure
evidence, observed after capture and still fresh, are both verified, and the
commander authorizes it. Missing, stale or pre-capture evidence is unknown,
and unknown never opens the hatch or permits transfer. Simulated training
scope only: the pressure tolerance is a demo rule, not a flight limit.
"""

from dataclasses import dataclass
from math import isfinite
from typing import Literal

# Matches docking.evidence_valid_s in scenarios/variants/launch-checkout-v1.json.
EVIDENCE_VALID_S = 30
# Demo rule: the two sides count as equalized within this pressure difference.
MAX_PRESSURE_DELTA_KPA = 0.5
UNIT = "kPa"

SealStatus = Literal["verified", "leak", "unknown"]
ReasonCode = Literal[
    "CAPTURE_REQUIRED",
    "SEAL_UNKNOWN", "SEAL_LEAK", "SEAL_EVIDENCE_EXPIRED",
    "PRESSURE_UNKNOWN", "PRESSURE_MISMATCH", "PRESSURE_EVIDENCE_EXPIRED",
    "COMMANDER_AUTHORIZATION_REQUIRED",
]


@dataclass(frozen=True)
class SealEvidence:
    status: SealStatus
    observed_at_s: int


@dataclass(frozen=True)
class PressureEvidence:
    """Pressure difference across the hatch in kPa; None means the reading is unavailable."""

    delta_kpa: float | None
    observed_at_s: int


@dataclass(frozen=True)
class HatchReadiness:
    capture: Literal["free", "captured"]
    seal: Literal["verified", "unverified", "unknown"]
    pressure: Literal["equalized", "mismatched", "unknown"]
    hatch: Literal["closed", "open"]
    transfer: Literal["held", "permitted"]
    reason_code: ReasonCode | None
    ready_to_authorize: bool


def _mission_time(name: str, value: int | None) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value < 0:
        raise ValueError(f"{name} must be nonnegative integer mission seconds")
    return value


def _fresh(observed_at_s: int, *, captured_at_s: int, mission_s: int, valid_s: int) -> bool | None:
    """True if usable, None if it predates capture (unknown), False if it has expired."""
    if _mission_time("observed_at_s", observed_at_s) > mission_s:
        raise ValueError("evidence cannot be observed after the current mission time")
    if observed_at_s < captured_at_s:
        return None
    return mission_s - observed_at_s < valid_s


def _seal(evidence: SealEvidence | None, **timing) -> tuple[str, ReasonCode | None]:
    if evidence is None or evidence.status == "unknown":
        return "unknown", "SEAL_UNKNOWN"
    fresh = _fresh(evidence.observed_at_s, **timing)
    if fresh is None:
        return "unknown", "SEAL_UNKNOWN"
    if not fresh:
        return "unknown", "SEAL_EVIDENCE_EXPIRED"
    if evidence.status == "leak":
        return "unverified", "SEAL_LEAK"
    return "verified", None


def _pressure(evidence: PressureEvidence | None, **timing) -> tuple[str, ReasonCode | None]:
    if evidence is None or evidence.delta_kpa is None:
        return "unknown", "PRESSURE_UNKNOWN"
    if not isfinite(evidence.delta_kpa):
        raise ValueError(f"pressure difference must be finite {UNIT}")
    fresh = _fresh(evidence.observed_at_s, **timing)
    if fresh is None:
        return "unknown", "PRESSURE_UNKNOWN"
    if not fresh:
        return "unknown", "PRESSURE_EVIDENCE_EXPIRED"
    if abs(evidence.delta_kpa) > MAX_PRESSURE_DELTA_KPA:
        return "mismatched", "PRESSURE_MISMATCH"
    return "equalized", None


def check_hatch(
    *,
    mission_s: int,
    captured_at_s: int | None,
    seal: SealEvidence | None = None,
    pressure: PressureEvidence | None = None,
    commander_authorized: bool = False,
    evidence_valid_s: int = EVIDENCE_VALID_S,
) -> HatchReadiness:
    """Decide whether the hatch may open and the transfer may proceed.

    The first blocking reason is reported in a fixed order: capture, seal,
    pressure, then commander authorization. Authorization without verified
    evidence is ignored, so it can never open the hatch on its own.
    """
    mission_s = _mission_time("mission_s", mission_s)
    captured_at_s = _mission_time("captured_at_s", captured_at_s)
    if captured_at_s is not None and captured_at_s > mission_s:
        raise ValueError("capture cannot be after the current mission time")
    if type(evidence_valid_s) is not int or evidence_valid_s <= 0:
        raise ValueError("evidence validity must be a positive number of seconds")

    if captured_at_s is None:
        return HatchReadiness("free", "unknown", "unknown", "closed", "held", "CAPTURE_REQUIRED", False)

    timing = {"captured_at_s": captured_at_s, "mission_s": mission_s, "valid_s": evidence_valid_s}
    seal_state, seal_reason = _seal(seal, **timing)
    pressure_state, pressure_reason = _pressure(pressure, **timing)
    verified = seal_reason is None and pressure_reason is None
    if verified and commander_authorized is True:
        return HatchReadiness("captured", seal_state, pressure_state, "open", "permitted", None, True)
    reason = seal_reason or pressure_reason or "COMMANDER_AUTHORIZATION_REQUIRED"
    return HatchReadiness("captured", seal_state, pressure_state, "closed", "held", reason, verified)
