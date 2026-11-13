"""KAN-142: an isothermal, synthetic cabin-to-vacuum airlock.

Stationeers' contained gas volumes and interlocked doors inspired this model:
https://stationeers-wiki.com/Atmosphere
https://stationeers-wiki.com/Gas
https://stationeers-wiki.com/Guide_(Airlock)

The rates and tolerance are for the simulation. An offline scenario driver may
supply scripted cycle requests. A live driver must supply requests from its
authorized commit journal. Animation can read the model's phase and pressure
but does not advance the inventory or operate a hatch.
"""

from dataclasses import dataclass, replace
from math import expm1
from typing import Literal

from symbiosis_x.simulation.spacecraft.cabin_gas import (
    SPECIES,
    CabinState,
    Compartment,
    Plant,
    _positive,
    kpa_per_mole,
    step,
)
from symbiosis_x.simulation.spacecraft.mechanical import MAX_PRESSURE_DELTA_KPA

Side = Literal["cabin", "vacuum"]
Phase = Literal["inner_open", "depressurizing", "outer_open", "pressurizing"]


@dataclass(frozen=True)
class Airlock:
    cabin_id: str
    chamber_id: str
    pump_mol_s_kpa: float
    open_hatch_mol_s_kpa: float

    def __post_init__(self):
        if not self.cabin_id or not self.chamber_id or self.cabin_id == self.chamber_id:
            raise ValueError("airlock needs distinct cabin and chamber IDs")
        _positive("pump_mol_s_kpa", self.pump_mol_s_kpa)
        _positive("open_hatch_mol_s_kpa", self.open_hatch_mol_s_kpa)


@dataclass(frozen=True)
class AirlockState:
    cabin: CabinState
    phase: Phase = "pressurizing"

    @property
    def inner_open(self) -> bool:
        return self.phase == "inner_open"

    @property
    def outer_open(self) -> bool:
        return self.phase == "outer_open"


def _pressure(state: CabinState, room: Compartment) -> float:
    return sum(state.moles[room.compartment_id][gas] for gas in SPECIES) * kpa_per_mole(room.volume_m3)


def _exchange(
    state: CabinState,
    first: Compartment,
    second: Compartment | None,
    conductance: float,
    dt_s: int,
) -> CabinState:
    """Solve dn/dt = conductance * pressure gap over an isothermal step."""
    gap = _pressure(state, first) - (_pressure(state, second) if second else 0.0)
    if gap == 0:
        return state
    scale = kpa_per_mole(first.volume_m3) + (kpa_per_mole(second.volume_m3) if second else 0.0)
    moved = abs(gap) / scale * -expm1(-conductance * scale * dt_s)
    donor, receiver = first, second
    if second is not None and gap < 0:
        donor, receiver = second, first
    donor_gas = state.moles[donor.compartment_id]
    fraction = min(1.0, moved / sum(donor_gas[gas] for gas in SPECIES))
    transfer = {gas: donor_gas[gas] * fraction for gas in SPECIES}

    inventories = dict(state.moles)
    inventories[donor.compartment_id] = {gas: donor_gas[gas] - transfer[gas] for gas in SPECIES}
    if receiver is None:
        vented = {gas: state.vented_mol[gas] + transfer[gas] for gas in SPECIES}
        return replace(state, moles=inventories, vented_mol=vented)
    receiver_gas = inventories[receiver.compartment_id]
    inventories[receiver.compartment_id] = {gas: receiver_gas[gas] + transfer[gas] for gas in SPECIES}
    return replace(state, moles=inventories)


def advance_airlock(
    state: AirlockState,
    plant: Plant,
    airlock: Airlock,
    dt_s: int,
    *,
    requested_side: Side | None = None,
    pump_powered: bool = True,
) -> AirlockState:
    """Close the opposing hatch, equalize with both sealed, then admit passage.

    Opening happens at the end of a step that meets the pressure tolerance.
    A sealed cycle holds its phase on power loss. An already open hatch still
    exchanges gas passively. Cabin equipment and crew run once each step.
    """
    rooms = {room.compartment_id: room for room in plant.compartments}
    if airlock.cabin_id not in rooms or airlock.chamber_id not in rooms:
        raise ValueError("airlock endpoints must belong to the plant")
    if any(airlock.chamber_id in fan.between and fan.powered and fan.flow_m3_h for fan in plant.fans):
        raise ValueError("airlock chamber cannot bypass interlocks through a powered fan")

    phase = state.phase
    if phase not in ("inner_open", "depressurizing", "outer_open", "pressurizing"):
        raise ValueError("invalid airlock phase")
    if requested_side == "vacuum" and phase != "outer_open":
        phase = "depressurizing"
    elif requested_side == "cabin" and phase != "inner_open":
        phase = "pressurizing"
    elif requested_side not in (None, "vacuum", "cabin"):
        raise ValueError("invalid airlock side")

    gas = step(state.cabin, plant, dt_s)
    chamber = rooms[airlock.chamber_id]
    target = rooms[airlock.cabin_id] if phase in ("inner_open", "pressurizing") else None
    door_open = phase in ("inner_open", "outer_open")
    if door_open:
        gas = _exchange(gas, chamber, target, airlock.open_hatch_mol_s_kpa, dt_s)
    elif pump_powered:
        gas = _exchange(gas, chamber, target, airlock.pump_mol_s_kpa, dt_s)
        target_kpa = _pressure(gas, target) if target else 0.0
        if abs(_pressure(gas, chamber) - target_kpa) <= MAX_PRESSURE_DELTA_KPA:
            phase = "inner_open" if target else "outer_open"
    return AirlockState(gas, phase)
