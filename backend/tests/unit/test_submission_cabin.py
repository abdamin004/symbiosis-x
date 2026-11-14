from symbiosis_x.crew.submission_cabin import REPAIR_S, RECOVERY_S, cabin_exposure, cabin_sample


def test_submission_cabin_has_a_visible_modeled_excursion():
    start, peak, recovery = [cabin_sample(t) for t in (0, REPAIR_S, RECOVERY_S)]
    assert start["ppm"] == 2000
    assert 3200 < peak["ppm"] < 3400
    assert recovery["ppm"] < 2800
    assert "elevated_co2" in cabin_exposure("SIM-02", REPAIR_S)["reasons"]
    assert "elevated_co2" not in cabin_exposure("SIM-02", RECOVERY_S)["reasons"]
