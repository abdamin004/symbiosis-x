"""KAN-128: stock, quarantine and idempotency in a synthetic vehicle ledger."""
import pytest

from symbiosis_x.simulation.spacecraft.water import WaterCommand, WaterInventory


def vehicle(name="horizon"):
    return WaterInventory(
        vehicle_id=name, potable_l=2.0, protected_reserve_l=1.0,
        wastewater_l=0.0, pending_treatment_l=0.0,
        rejected_l=0.0, exported_l=0.0, meal_packs=3, power_kwh=1.0,
    )


def apply(state, operation_id, action, **kwargs):
    return state.apply(WaterCommand(operation_id, action, **kwargs))


def test_potable_and_meal_debits_are_atomic_and_idempotent():
    state = vehicle()
    original_water = state.accounted_water_l
    after, receipt = apply(state, "meal-1", "meal")
    assert receipt.status == "accepted"
    assert (receipt.meal_delta, receipt.potable_delta_l, receipt.power_delta_kwh) == (-1, -0.15, -0.05)
    assert after.meal_packs == 2
    assert after.accounted_water_l == original_water
    retry, second = apply(after, "meal-1", "meal")
    assert retry == after and second == receipt
    with pytest.raises(ValueError, match="OPERATION_ID_REUSED"):
        apply(after, "meal-1", "drink")


def test_unverified_treatment_never_enters_potable_stock():
    state, _ = apply(vehicle(), "drink-1", "drink")
    treated, receipt = apply(state, "treat-1", "treat", amount_l=0.25)
    assert receipt.status == "accepted"
    assert treated.pending_treatment_l == 0.25 and treated.potable_l == 1.75
    held, result = apply(treated, "release-unverified", "release", amount_l=0.25)
    assert result.reason_code == "QUALITY_NOT_VERIFIED"
    assert held.potable_l == treated.potable_l
    verified, result = apply(held, "release-verified", "release", amount_l=0.25, quality_verified=True)
    assert result.status == "accepted" and verified.potable_l == 2.0
    assert verified.pending_treatment_l == 0.0
    assert verified.accounted_water_l == 2.0


def test_rejected_water_stays_quarantined_and_cannot_be_drunk():
    wet, _ = apply(vehicle(), "drink", "drink")
    pending, _ = apply(wet, "treat", "treat", amount_l=0.25)
    rejected, result = apply(pending, "reject", "reject", amount_l=0.25, quality_verified=True)
    assert result.status == "accepted"
    assert rejected.rejected_l == 0.25
    assert rejected.potable_l == 1.75
    assert rejected.accounted_water_l == 2.0


def test_ration_priority_preserves_reserve_and_commander_authority():
    state = WaterInventory(
        vehicle_id="kestrel", potable_l=1.1, protected_reserve_l=1.0,
        wastewater_l=0, pending_treatment_l=0, rejected_l=0,
        exported_l=0, meal_packs=1, power_kwh=0.2,
    )
    still, receipt = apply(state, "optional", "drink", priority="optional")
    assert receipt.reason_code == "PROTECTED_RESERVE" and still.potable_l == 1.1
    still, receipt = apply(still, "unauthorized", "ration", ration="conserve")
    assert receipt.reason_code == "COMMANDER_AUTHORIZATION_REQUIRED"
    rationed, receipt = apply(still, "cmd", "ration", ration="conserve", commander_approved=True)
    assert receipt.status == "accepted" and rationed.ration_mode == "conserve"
    held, receipt = apply(rationed, "hygiene", "hygiene", priority="optional")
    assert receipt.reason_code == "RATION_PRIORITY_HOLD"
    after, receipt = apply(held, "essential", "drink", priority="essential")
    assert receipt.status == "accepted" and after.potable_l == 0.85


def test_oxygen_generation_uses_water_and_power_without_creating_water():
    state, result = apply(vehicle(), "oxygen", "oxygen")
    assert result.status == "accepted"
    assert state.exported_l == 0.2
    assert state.potable_l == 1.8
    assert state.power_kwh == 0.88
    assert state.accounted_water_l == 2.0


def test_resupply_requires_approved_receipt_and_is_vehicle_isolated():
    horizon, held = apply(vehicle("horizon"), "supply", "resupply", amount_l=3.0)
    assert held.reason_code == "VERIFIED_RESUPPLY_RECEIPT_REQUIRED"
    horizon, ok = apply(horizon, "supply-verified", "resupply", amount_l=3.0,
                        station_receipt="station:transfer-17", commander_approved=True)
    assert ok.status == "accepted" and horizon.potable_l == 5.0
    kestrel = vehicle("kestrel")
    assert kestrel.potable_l == 2.0 and not kestrel.receipts
    assert apply(horizon, "supply-verified", "resupply", amount_l=3.0,
                 station_receipt="station:transfer-17", commander_approved=True)[0] == horizon


def test_missing_water_and_power_hold_without_negative_inventory():
    empty = WaterInventory(
        vehicle_id="horizon", potable_l=0.1, protected_reserve_l=0,
        wastewater_l=1, pending_treatment_l=0, rejected_l=0,
        exported_l=0, meal_packs=0, power_kwh=0,
    )
    for action, kwargs, reason in [
        ("drink", {}, "POTABLE_SHORTAGE"),
        ("meal", {}, "POTABLE_SHORTAGE"),
        ("treat", {"amount_l": 1.0}, "POWER_UNAVAILABLE"),
    ]:
        state, receipt = apply(empty, action, action, **kwargs)
        assert receipt.reason_code == reason
        assert state.potable_l == empty.potable_l
        assert state.accounted_water_l == empty.accounted_water_l


def test_invalid_inventories_and_volumes_are_rejected():
    with pytest.raises(ValueError, match="INVALID_WATER_INVENTORY"):
        WaterInventory("horizon", -1, 1, 0, 0, 0, 0, 1, 1)
    with pytest.raises(ValueError, match="INVALID_WATER_AMOUNT"):
        apply(vehicle(), "invalid", "treat", amount_l=-1)
