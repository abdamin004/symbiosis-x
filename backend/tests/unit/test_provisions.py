from symbiosis_x.simulation.spacecraft.provisions import Evidence, Inventory, Ledger, Operation


def test_water_is_quarantined_and_rejected_volume_is_accounted_for():
    ledger = Ledger(Inventory.loaded_on_earth("asteria"))
    loaded = ledger.stock.accounted_water_ml
    ledger, drink = ledger.commit(Operation("drink", 15, "drink", activity="working"))
    assert drink.applied and ledger.stock.wastewater_ml == 160

    ledger, blocked = ledger.commit(Operation("power-block", 30, "treat", volume_ml=160),
                                    Evidence(served_kw=0.05, processor_available=True))
    assert blocked.reason == "POWER_LIMIT"
    ledger, treated = ledger.commit(Operation("treat", 45, "treat", volume_ml=160),
                                    Evidence(served_kw=0.2, processor_available=True))
    assert treated.applied and ledger.stock.held_ml == 128 and ledger.stock.rejected_ml == 32
    assert ledger.stock.potable_ml == 24_000 - 320

    ledger, unverified = ledger.commit(Operation("quality-missing", 60, "verify", volume_ml=128))
    assert unverified.reason == "QUALITY_EVIDENCE_REQUIRED"
    ledger, rejected = ledger.commit(Operation("reject", 75, "reject", volume_ml=28))
    assert rejected.applied and ledger.stock.held_ml == 100 and ledger.stock.rejected_ml == 60
    ledger, released = ledger.commit(Operation("verify", 90, "verify", volume_ml=100),
                                     Evidence(passed_quality_check=True))
    assert released.applied and ledger.stock.held_ml == 0
    assert ledger.stock.accounted_water_ml == loaded


def test_ration_shortages_and_exactly_once_debits():
    ledger = Ledger(Inventory("kestrel", potable_ml=125, reserve_ml=200, meals=1))
    meal = Operation("meal", 15, "prepare_meal", ration="conserve")
    ledger, result = ledger.commit(meal, Evidence(served_kw=0.2))
    assert result.applied and ledger.stock.potable_ml == ledger.stock.meals == 0
    assert ledger.commit(meal) == (ledger, result)
    ledger, missed = ledger.commit(Operation("drink", 30, "drink"))
    assert missed.reason == "POTABLE_SHORT"
    ledger, deferred = ledger.commit(Operation("wc", 45, "hygiene", ration="conserve"),
                                     Evidence(served_kw=0.2))
    assert deferred.reason == "HYGIENE_DEFERRED_BY_RATION"
    assert ledger.stock.reserve_ml == 200
    ledger, release = ledger.commit(Operation("release", 60, "release_reserve", volume_ml=200))
    assert release.applied and ledger.stock.potable_ml == 200


def test_separate_tanks_and_receipt_based_station_replenishment():
    outbound = Ledger(Inventory.loaded_on_earth("asteria"))
    capsule = Ledger(Inventory.loaded_on_earth("return-capsule"))
    capsule, rejected = capsule.commit(Operation("docked", 15, "replenish", volume_ml=750))
    assert rejected.reason == "TRANSFER_RECEIPT_REQUIRED"

    receipt = "ISS-water-001"
    evidence = Evidence(station_transfer_authorized=True)
    capsule, accepted = capsule.commit(Operation("accept", 30, "replenish", volume_ml=750,
                                                transfer_receipt=receipt), evidence)
    assert accepted.applied and capsule.stock.potable_ml == 6750
    capsule, duplicate = capsule.commit(Operation("repeat", 45, "replenish", volume_ml=750,
                                                   transfer_receipt=receipt), evidence)
    assert duplicate.reason == "TRANSFER_ALREADY_ACCEPTED"
    assert capsule.stock.potable_ml == 6750 and outbound.stock.potable_ml == 24_000
