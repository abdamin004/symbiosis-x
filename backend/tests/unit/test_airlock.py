"""KAN-142 airlock, inventory and private exposure regression tests."""

from dataclasses import asdict, replace
from math import exp
import json

import pytest

from symbiosis_x.crew.cabin_exposure import crew_cabin_exposure
from symbiosis_x.simulation.spacecraft.airlock import Airlock, AirlockState, advance_airlock
from symbiosis_x.simulation.spacecraft.cabin_gas import (
    SPECIES,
    CabinState,
    Compartment,
    CrewLoad,
    Fan,
    Plant,
    Scrubber,
    initial_state,
    kpa_per_mole,
    mass_balance_residual,
    readings,
    step,
)

PLANT = Plant((Compartment("habitat", 60), Compartment("chamber", 4)))
LOCK = Airlock("habitat", "chamber", pump_mol_s_kpa=4, open_hatch_mol_s_kpa=2)
PRIVATE_ID = "SIM-142-PRIVATE"


def with_chamber(state, chamber):
    return replace(state, moles={**state.moles, "chamber": chamber})


def test_partial_pressures_and_vacuum_readings_are_finite():
    habitat, chamber = readings(
        with_chamber(initial_state(PLANT), dict.fromkeys(SPECIES, 0.0)), PLANT
    )
    assert habitat.o2_partial_kpa == pytest.approx(21.273)
    assert habitat.co2_partial_kpa == pytest.approx(0.2026)
    assert habitat.n2_partial_kpa == pytest.approx(79.8244)
    assert sum((habitat.o2_partial_kpa, habitat.co2_partial_kpa, habitat.n2_partial_kpa)) == pytest.approx(
        habitat.total_pressure_kpa
    )
    assert list(asdict(chamber).values())[1:] == [0.0] * 6
    assert readings(initial_state(PLANT, pressure_kpa=0), PLANT) == [
        replace(chamber, compartment_id="habitat"), chamber
    ]
    with pytest.raises(ValueError, match="gas fractions"):
        initial_state(PLANT, o2_fraction=1, co2_ppm=1)


@pytest.mark.parametrize("habitat_kpa,chamber_kpa", [(100, 10), (10, 100), (100, 100)])
def test_open_inner_hatch_flow_matches_pressure_gradient(habitat_kpa, chamber_kpa):
    habitat_mix = initial_state(PLANT, pressure_kpa=habitat_kpa).moles["habitat"]
    chamber_mix = initial_state(PLANT, pressure_kpa=chamber_kpa, o2_fraction=0.15).moles["chamber"]
    start = CabinState(0, {"habitat": habitat_mix, "chamber": chamber_mix})
    state = AirlockState(start, "inner_open")

    result = advance_airlock(state, PLANT, LOCK, 3, pump_powered=False)
    habitat, chamber = readings(result.cabin, PLANT)
    scale = sum(kpa_per_mole(room.volume_m3) for room in PLANT.compartments)
    assert habitat.total_pressure_kpa - chamber.total_pressure_kpa == pytest.approx(
        (habitat_kpa - chamber_kpa) * exp(-3 * LOCK.open_hatch_mol_s_kpa * scale)
    )
    assert mass_balance_residual(start, result.cabin) == pytest.approx(dict.fromkeys(SPECIES, 0), abs=1e-11)
    if habitat_kpa == chamber_kpa:
        assert result.cabin.moles == start.moles
    else:
        donor = "habitat" if habitat_kpa > chamber_kpa else "chamber"
        fractions = [result.cabin.moles[donor][gas] / start.moles[donor][gas] for gas in SPECIES]
        assert fractions == pytest.approx([fractions[0]] * 3)
    assert result == advance_airlock(state, PLANT, LOCK, 3, pump_powered=False)


def test_out_and_back_cycle_seals_and_conserves_species():
    def cycle():
        start = initial_state(PLANT)
        state = AirlockState(start, "inner_open")
        states = [state]
        for target in ("vacuum", "cabin"):
            state = advance_airlock(state, PLANT, LOCK, 1, requested_side=target, pump_powered=False)
            states.append(state)
            assert not state.inner_open and not state.outer_open
            assert state.cabin.moles == states[-2].cabin.moles
            for _ in range(120):
                state = advance_airlock(state, PLANT, LOCK, 1)
                states.append(state)
                assert not (state.inner_open and state.outer_open)
            habitat, chamber = readings(state.cabin, PLANT)
            if target == "vacuum":
                assert state.outer_open
                assert habitat.total_pressure_kpa == pytest.approx(101.3)
                assert chamber.total_pressure_kpa < 0.001
            else:
                assert state.inner_open
                assert chamber.total_pressure_kpa == pytest.approx(habitat.total_pressure_kpa, abs=0.001)
                assert habitat.total_pressure_kpa < 101.3
        assert state.cabin.mission_s == 242
        assert state.cabin.vented_mol == pytest.approx(start.moles["chamber"], abs=0.001)
        for snapshot in states:
            assert mass_balance_residual(start, snapshot.cabin) == pytest.approx(
                dict.fromkeys(SPECIES, 0), abs=1e-10
            )
        return states

    assert cycle() == cycle()


def test_sealed_interlock_respects_power_and_can_reverse_before_opening():
    state = AirlockState(initial_state(PLANT), "inner_open")
    venting = advance_airlock(state, PLANT, LOCK, 1, requested_side="vacuum")
    assert venting.phase == "depressurizing"
    assert readings(venting.cabin, PLANT)[1].total_pressure_kpa < 101.3
    paused = advance_airlock(venting, PLANT, LOCK, 10, pump_powered=False)
    assert paused.phase == "depressurizing" and paused.cabin.moles == venting.cabin.moles
    reversed_cycle = advance_airlock(paused, PLANT, LOCK, 1, requested_side="cabin")
    assert reversed_cycle.phase == "pressurizing"
    assert reversed_cycle.cabin.vented_mol == paused.cabin.vented_mol
    assert advance_airlock(reversed_cycle, PLANT, LOCK, 120).phase == "inner_open"

    bypass = replace(PLANT, fans=(Fan("bypass", ("habitat", "chamber"), 1),))
    with pytest.raises(ValueError, match="bypass"):
        advance_airlock(state, bypass, LOCK, 1)


def test_crew_exposure_follows_current_room_and_recovers_after_refill():
    member = CrewLoad(PRIVATE_ID, "habitat", "exercise")
    plant = replace(PLANT, crew=(member,))
    start = initial_state(plant)
    airlock = advance_airlock(AirlockState(start), plant, LOCK, 120, requested_side="vacuum")
    onboard = crew_cabin_exposure(airlock.cabin, plant, PRIVATE_ID)
    assert onboard.environment.compartment_id == "habitat"
    assert onboard.workload_cue == "nominal"

    moved = replace(plant, crew=(replace(member, compartment_id="chamber"),))
    exposed = crew_cabin_exposure(airlock.cabin, moved, PRIVATE_ID)
    assert exposed.crew_id == PRIVATE_ID
    assert exposed.environment.compartment_id == "chamber"
    assert exposed.workload_cue == "ease_workload"
    assert exposed.reasons == ("low_cabin_pressure", "low_oxygen_partial_pressure")
    assert exposed.observed_at_s == 120 and exposed.synthetic
    assert moved.crew[0].workload == "exercise"
    assert PRIVATE_ID not in json.dumps([asdict(room) for room in readings(airlock.cabin, moved)])

    filled = advance_airlock(airlock, moved, LOCK, 120, requested_side="cabin")
    recovered = crew_cabin_exposure(filled.cabin, moved, PRIVATE_ID)
    assert recovered.workload_cue == "nominal" and recovered.reasons == ()
    assert recovered.observed_at_s == 240

    high_co2 = initial_state(plant, co2_ppm=3500)
    assert crew_cabin_exposure(high_co2, plant, PRIVATE_ID).reasons == ("elevated_co2",)
    with pytest.raises(ValueError, match="one current compartment"):
        crew_cabin_exposure(high_co2, plant, "unknown")


def test_plant_with_competing_draws_accounts_for_actual_withdrawals():
    plant = replace(
        PLANT,
        fans=(Fan("one", ("habitat", "chamber"), 9_000), Fan("two", ("habitat", "chamber"), 9_000)),
        scrubbers=(Scrubber("one", "habitat", 1_000_000), Scrubber("two", "habitat", 1_000_000)),
        crew=(CrewLoad("one", "habitat"), CrewLoad("two", "habitat")),
    )
    start = with_chamber(initial_state(plant, pressure_kpa=0.00001), dict.fromkeys(SPECIES, 0.0))
    end = step(start, plant, 1)
    assert min(amount for room in end.moles.values() for amount in room.values()) >= 0
    assert 0 < end.ledger["co2_removed"] <= start.moles["habitat"]["co2"]
    assert 0 < end.ledger["o2_consumed"] <= start.moles["habitat"]["o2"]
    assert mass_balance_residual(start, end) == pytest.approx(dict.fromkeys(SPECIES, 0), abs=1e-12)
