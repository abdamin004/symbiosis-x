"""KAN-130: cabin gas balances by compartment and a degraded-scrubber scenario."""

import json
from dataclasses import asdict

import pytest

from symbiosis_x.application import nominal
from symbiosis_x.simulation.spacecraft.atmosphere import NOMINAL_CABIN_PRESSURE_KPA, advance_co2_ppm
from symbiosis_x.simulation.spacecraft.cabin_gas import (
    CO2_LIMIT_PPM, GOLDEN_CREW, GOLDEN_GENERATION_M3_H, NOMINAL_O2_MOL_S, NOMINAL_PRESSURE_KPA, RECOVERED_PPM,
    Compartment, CrewLoad, Fan, OxygenGenerator, Plant, Scrubber,
    initial_state, mass_balance_residual, readings, run_degraded_scrubber, step,
)

CREW = [CrewLoad("SIM-01", "habitat", "exercise"), CrewLoad("SIM-02", "habitat"),
        CrewLoad("SIM-03", "habitat"), CrewLoad("SIM-04", "command")]
ACCEPTED = {"operation_id": "op-standby-1", "candidate_id": "start_standby", "status": "accepted", "applied": True}


def run(plant, state, seconds, dt=10):
    for _ in range(seconds // dt):
        state = step(state, plant, dt)
    return state


def single_zone(removal_m3_h, generator=True):
    return Plant(
        compartments=(Compartment("cabin", 100),),
        scrubbers=(Scrubber("primary", "cabin", removal_m3_h),),
        generators=(OxygenGenerator("ogs", "cabin", NOMINAL_O2_MOL_S * GOLDEN_CREW),) if generator else (),
        crew=tuple(CrewLoad(f"SIM-0{i}", "cabin") for i in range(1, 5)),
    )


def test_one_zone_matches_the_golden_co2_model():
    assert (GOLDEN_GENERATION_M3_H, GOLDEN_CREW) == (nominal.GENERATION_M3_H, 4)
    assert NOMINAL_PRESSURE_KPA == NOMINAL_CABIN_PRESSURE_KPA
    # Nominal scrubbing holds the golden 2,000 ppm, with O₂ and pressure steady.
    plant = single_zone(nominal.NOMINAL_REMOVAL_M3_H)
    [steady] = readings(run(plant, initial_state(plant), 6 * 3600), plant)
    assert steady.co2_ppm == pytest.approx(2000, abs=5)
    assert (steady.o2_percent, steady.total_pressure_kpa) == (pytest.approx(21.0, abs=0.01), pytest.approx(101.3, abs=0.01))
    # Degraded scrubbing rises on the same curve as the single-zone closed form.
    plant = single_zone(4)
    [degraded] = readings(run(plant, initial_state(plant), 3600), plant)
    expected = advance_co2_ppm(2000, duration_s=3600, volume_m3=100, generation_m3_h=0.04, removal_m3_h=4)
    assert degraded.co2_ppm == pytest.approx(expected, rel=0.005)


def test_mass_balance_closes_across_compartments():
    plant = Plant(
        compartments=(Compartment("a", 30), Compartment("b", 50), Compartment("c", 20)),
        fans=(Fan("ab", ("a", "b"), 120), Fan("bc", ("b", "c"), 90), Fan("off", ("a", "c"), 300, powered=False)),
        scrubbers=(Scrubber("s1", "b", 12, effectiveness=0.5),),
        generators=(OxygenGenerator("g", "c", NOMINAL_O2_MOL_S * 2),),
        crew=(CrewLoad("SIM-01", "a", "exercise"), CrewLoad("SIM-02", "a", "rest"), CrewLoad("SIM-03", "c")),
    )
    start = initial_state(plant, co2_ppm=2500)
    end = run(plant, start, 4 * 3600)
    residual = mass_balance_residual(start, end)
    assert all(abs(value) < 1e-9 for value in residual.values()), residual
    assert end.ledger["co2_removed"] > 0 and end.ledger["o2_generated"] > 0
    # Mixing moves gas from the crewed compartment toward the scrubber, so CO₂ ends highest in "a".
    co2 = {r.compartment_id: r.co2_ppm for r in readings(end, plant)}
    assert co2["a"] > co2["b"]


def test_standby_from_an_accepted_receipt_recovers():
    baseline = run_degraded_scrubber(CREW)
    result = run_degraded_scrubber(CREW, receipt=ACCEPTED, committed_at_s=11_400)
    kinds = [(e.mission_s, e.kind) for e in result.events]
    assert kinds[:3] == [(600, "scrubber_degraded"), (11_320, "co2_limit_exceeded"), (11_400, "mitigation_applied")]
    assert kinds[3][1] == "co2_recovered" and 11_400 < kinds[3][0] < 43_200
    assert result.events[2].operation_id == "op-standby-1"
    assert CO2_LIMIT_PPM < result.peak_co2_ppm < baseline.peak_co2_ppm
    assert max(r.co2_ppm for r in result.final) <= RECOVERED_PPM
    assert all(abs(v) < 1e-9 for v in result.mass_balance.values())
    # Evidence: every 5 minutes, per compartment, with units and mission time; no crew data in any output.
    times = sorted({o.observed_at_s for o in result.observations})
    assert times[:3] == [0, 300, 600] and times[-1] == 43_200
    assert {(o.metric, o.unit) for o in result.observations} == {
        ("co2", "ppm"), ("o2_partial", "kPa"), ("total_pressure", "kPa")}
    assert all(o.synthetic for o in result.observations)
    shared = json.dumps([asdict(x) for x in (*result.observations, *result.events, *result.final)])
    assert "SIM-0" not in shared and "exercise" not in shared


def test_refused_or_weaker_mitigation_does_not_recover():
    baseline = run_degraded_scrubber(CREW)
    assert baseline.peak_co2_ppm > CO2_LIMIT_PPM
    assert "co2_recovered" not in {e.kind for e in baseline.events}
    rejected = run_degraded_scrubber(CREW, receipt={**ACCEPTED, "status": "rejected", "applied": False},
                                     committed_at_s=11_400)
    assert [e.kind for e in rejected.events][-1] == "mitigation_refused"
    assert rejected.final == baseline.final          # a refused receipt changes nothing
    unapplied = run_degraded_scrubber(CREW, receipt={**ACCEPTED, "applied": False}, committed_at_s=11_400)
    assert unapplied.final == baseline.final
    reduced = run_degraded_scrubber(CREW, receipt={**ACCEPTED, "candidate_id": "reduce_activity"},
                                    committed_at_s=11_400)
    assert "mitigation_applied" in {e.kind for e in reduced.events}
    assert "co2_recovered" not in {e.kind for e in reduced.events}
    assert max(r.co2_ppm for r in reduced.final) < max(r.co2_ppm for r in baseline.final)


def test_bad_inputs_are_rejected():
    with pytest.raises(ValueError, match="unknown compartment"):
        Plant(compartments=(Compartment("a", 10),), crew=(CrewLoad("SIM-01", "b"),))
    with pytest.raises(ValueError, match="unique"):
        Plant(compartments=(Compartment("a", 10), Compartment("a", 5)))
    with pytest.raises(ValueError, match="effectiveness"):
        Plant(compartments=(Compartment("a", 10),), scrubbers=(Scrubber("s", "a", 5, effectiveness=1.5),))
    plant = Plant(compartments=(Compartment("a", 1), Compartment("b", 1)), fans=(Fan("f", ("a", "b"), 3600),))
    with pytest.raises(ValueError, match="time step too long"):
        step(initial_state(plant), plant, 10)
    with pytest.raises(ValueError, match="positive integer"):
        step(initial_state(plant), plant, 0)
    with pytest.raises(ValueError, match="go together"):
        run_degraded_scrubber(CREW, receipt=ACCEPTED)
    with pytest.raises(ValueError, match="inside the horizon"):
        run_degraded_scrubber(CREW, receipt=ACCEPTED, committed_at_s=11_405)
