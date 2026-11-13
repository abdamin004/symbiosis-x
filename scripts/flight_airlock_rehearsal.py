"""Build a deterministic pressure-cycle rehearsal for the Flight canvas."""

from dataclasses import asdict, replace

from symbiosis_x.crew.cabin_exposure import crew_cabin_exposure
from symbiosis_x.simulation.spacecraft.airlock import Airlock, AirlockState, advance_airlock
from symbiosis_x.simulation.spacecraft.cabin_gas import Compartment, CrewLoad, Plant, initial_state, readings


def build_airlock_rehearsal():
    plant = Plant(compartments=(Compartment("Cabin", 60), Compartment("Airlock", 5)))
    # Evaluate a hypothetical unsuited presence without consuming gas in an empty chamber.
    exposure_plant = replace(plant, crew=(CrewLoad("SIM-02", "Airlock"),))
    airlock = Airlock("Cabin", "Airlock", pump_mol_s_kpa=4, open_hatch_mol_s_kpa=2)
    state = AirlockState(initial_state(plant), "inner_open")

    def frame():
        exposure = crew_cabin_exposure(state.cabin, exposure_plant, "SIM-02")
        return {
            "time": state.cabin.mission_s,
            "rooms": [asdict(room) for room in readings(state.cabin, plant)],
            "phase": state.phase,
            "vented_mol": sum(state.cabin.vented_mol.values()),
            "workload_cue": exposure.workload_cue,
        }

    frames = [frame()]
    for target, unlocked in (("vacuum", "outer_open"), ("cabin", "inner_open")):
        for _ in range(60):
            state = advance_airlock(state, plant, airlock, 1, requested_side=target)
            frames.append(frame())
            if state.phase == unlocked:
                break
        else:
            raise RuntimeError("Airlock did not reach the authored checkpoint")
    return frames
