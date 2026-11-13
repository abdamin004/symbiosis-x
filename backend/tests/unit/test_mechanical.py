"""SX-14: mechanical capture is separate from verified hatch authorization."""

import json
from pathlib import Path

import pytest

from symbiosis_x.simulation.spacecraft.mechanical import (
    EVIDENCE_VALID_S, HatchReadiness, PressureEvidence, SealEvidence, check_hatch,
)

ROOT = Path(__file__).resolve().parents[3]
EQUALIZED = PressureEvidence(delta_kpa=0.1, observed_at_s=105)
SEALED = SealEvidence("verified", observed_at_s=104)


def test_unknown_seal_blocks_hatch():
    # Captured, pressure equalized and the commander even authorizes: an unknown seal still holds everything.
    result = check_hatch(mission_s=110, captured_at_s=100, seal=SealEvidence("unknown", 104),
                         pressure=EQUALIZED, commander_authorized=True)
    assert result == HatchReadiness("captured", "unknown", "equalized", "closed", "held", "SEAL_UNKNOWN", False)
    assert check_hatch(mission_s=110, captured_at_s=100, pressure=EQUALIZED,
                       commander_authorized=True).reason_code == "SEAL_UNKNOWN"


def test_capture_alone_never_opens_the_hatch():
    free = check_hatch(mission_s=90, captured_at_s=None, seal=SealEvidence("verified", 80),
                       pressure=PressureEvidence(0.0, 80), commander_authorized=True)
    assert (free.capture, free.hatch, free.transfer, free.reason_code) == ("free", "closed", "held", "CAPTURE_REQUIRED")
    captured = check_hatch(mission_s=100, captured_at_s=100)
    assert (captured.capture, captured.hatch, captured.reason_code) == ("captured", "closed", "SEAL_UNKNOWN")


def test_verified_evidence_still_needs_the_commander():
    waiting = check_hatch(mission_s=110, captured_at_s=100, seal=SEALED, pressure=EQUALIZED)
    assert (waiting.hatch, waiting.transfer, waiting.reason_code, waiting.ready_to_authorize) == (
        "closed", "held", "COMMANDER_AUTHORIZATION_REQUIRED", True)
    opened = check_hatch(mission_s=110, captured_at_s=100, seal=SEALED, pressure=EQUALIZED, commander_authorized=True)
    assert opened == HatchReadiness("captured", "verified", "equalized", "open", "permitted", None, True)


@pytest.mark.parametrize(("seal", "pressure", "mission_s", "reason"), [
    (SealEvidence("leak", 104), EQUALIZED, 110, "SEAL_LEAK"),
    (SealEvidence("verified", 95), EQUALIZED, 110, "SEAL_UNKNOWN"),           # observed before capture
    (SEALED, PressureEvidence(None, 105), 110, "PRESSURE_UNKNOWN"),
    (SEALED, PressureEvidence(2.0, 105), 110, "PRESSURE_MISMATCH"),
    (SEALED, PressureEvidence(-0.6, 105), 110, "PRESSURE_MISMATCH"),
    (SEALED, EQUALIZED, 104 + EVIDENCE_VALID_S, "SEAL_EVIDENCE_EXPIRED"),
    (SealEvidence("verified", 120), EQUALIZED, 105 + EVIDENCE_VALID_S, "PRESSURE_EVIDENCE_EXPIRED"),
])
def test_unverified_or_stale_evidence_holds_the_transfer(seal, pressure, mission_s, reason):
    result = check_hatch(mission_s=mission_s, captured_at_s=100, seal=seal, pressure=pressure,
                         commander_authorized=True)
    assert (result.hatch, result.transfer, result.reason_code, result.ready_to_authorize) == (
        "closed", "held", reason, False)


def test_rules_match_the_flight_canvas_and_reject_bad_times():
    docking = json.loads((ROOT / "scenarios/variants/launch-checkout-v1.json").read_text())["docking"]
    assert EVIDENCE_VALID_S == docking["evidence_valid_s"]
    with pytest.raises(ValueError, match="after the current mission time"):
        check_hatch(mission_s=100, captured_at_s=100, seal=SealEvidence("verified", 101))
    with pytest.raises(ValueError, match="capture cannot be after"):
        check_hatch(mission_s=100, captured_at_s=101)
    with pytest.raises(ValueError, match="integer"):
        check_hatch(mission_s=100.5, captured_at_s=None)
