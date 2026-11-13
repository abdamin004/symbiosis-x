"""KAN-130: synthetic cabin gas balances by compartment.

Each compartment holds an ideal-gas inventory of O₂, CO₂ and N₂ (the balance
gas) in moles at a fixed synthetic temperature, so total pressure follows from
the inventory. Every process accounts for the moles it moves:

* fans exchange equal volumes of air between two compartments;
* a powered scrubber removes CO₂ in proportion to its effective flow and the
  local concentration (the same law as ``atmosphere.advance_co2_ppm``);
* a powered oxygen generator adds O₂ at a fixed rate;
* each crew member consumes O₂ and produces CO₂ at a rate set by workload.

The per-person CO₂ rate is the golden nominal pilot's 0.04 m³/h shared by four
crew, so one nominal compartment reproduces its 2,000 ppm steady state. All
values are labelled demo values, not flight data.

The degraded-scrubber scenario changes the plant only through an accepted and
applied commit-gate receipt. Its outputs carry compartment gas evidence and
plant events with mission timestamps; crew IDs and workloads stay in the
private inputs and never appear in them.
"""

from dataclasses import dataclass, field, replace
from math import exp, isfinite
from typing import Literal, Mapping, Sequence

GAS_CONSTANT_J_MOL_K = 8.314462618
CABIN_TEMPERATURE_K = 295.15            # synthetic, fixed
NOMINAL_PRESSURE_KPA = 101.3            # matches atmosphere.NOMINAL_CABIN_PRESSURE_KPA
NOMINAL_O2_FRACTION = 0.21
PPM = 1_000_000
SPECIES = ("o2", "co2", "n2")

# Demo metabolic rates. Nominal CO₂ is the golden pilot's 0.04 m³/h over four crew.
GOLDEN_GENERATION_M3_H = 0.04
GOLDEN_CREW = 4
RESPIRATORY_QUOTIENT = 0.85             # CO₂ produced per O₂ consumed, synthetic
WORKLOAD_FACTOR = {"rest": 0.8, "nominal": 1.0, "exercise": 2.0}
METABOLIC_SOURCE_ID = "synthetic.metabolic-demo-v1"

Workload = Literal["rest", "nominal", "exercise"]


def moles_per_m3(pressure_kpa: float = NOMINAL_PRESSURE_KPA) -> float:
    return pressure_kpa * 1000 / (GAS_CONSTANT_J_MOL_K * CABIN_TEMPERATURE_K)


NOMINAL_CO2_MOL_S = GOLDEN_GENERATION_M3_H / GOLDEN_CREW / 3600 * moles_per_m3()
NOMINAL_O2_MOL_S = NOMINAL_CO2_MOL_S / RESPIRATORY_QUOTIENT


@dataclass(frozen=True)
class Compartment:
    compartment_id: str
    volume_m3: float


@dataclass(frozen=True)
class Fan:
    fan_id: str
    between: tuple[str, str]
    flow_m3_h: float
    powered: bool = True


@dataclass(frozen=True)
class Scrubber:
    scrubber_id: str
    compartment_id: str
    effective_flow_m3_h: float
    powered: bool = True
    effectiveness: float = 1.0          # 1 = nominal; a degraded unit keeps a fraction


@dataclass(frozen=True)
class OxygenGenerator:
    generator_id: str
    compartment_id: str
    rate_mol_s: float
    powered: bool = True


@dataclass(frozen=True)
class CrewLoad:
    """Private onboard input: who is where, at what workload."""
    crew_id: str
    compartment_id: str
    workload: Workload = "nominal"


@dataclass(frozen=True)
class Plant:
    compartments: tuple[Compartment, ...]
    fans: tuple[Fan, ...] = ()
    scrubbers: tuple[Scrubber, ...] = ()
    generators: tuple[OxygenGenerator, ...] = ()
    crew: tuple[CrewLoad, ...] = ()

    def __post_init__(self):
        ids = [c.compartment_id for c in self.compartments]
        if not ids or not all(ids) or len(set(ids)) != len(ids):
            raise ValueError("compartment IDs must be unique and non-empty")
        for c in self.compartments:
            _positive("volume_m3", c.volume_m3)
        known = set(ids)
        placed = [f.between for f in self.fans]
        refs = [x for pair in placed for x in pair] + [s.compartment_id for s in self.scrubbers] + [
            g.compartment_id for g in self.generators] + [m.compartment_id for m in self.crew]
        if not set(refs) <= known:
            raise ValueError("equipment or crew placed in an unknown compartment")
        for item in (*self.fans, *self.scrubbers, *self.generators):
            for name in ("flow_m3_h", "effective_flow_m3_h", "rate_mol_s"):
                if hasattr(item, name):
                    _nonnegative(name, getattr(item, name))
        for s in self.scrubbers:
            if not 0 <= s.effectiveness <= 1:
                raise ValueError("scrubber effectiveness must be between 0 and 1")
        for m in self.crew:
            if m.workload not in WORKLOAD_FACTOR:
                raise ValueError("unknown workload")


@dataclass(frozen=True)
class CabinState:
    mission_s: int
    moles: Mapping[str, Mapping[str, float]]
    # Cumulative transfers across the plant boundary, for the mass balance.
    ledger: Mapping[str, float] = field(default_factory=lambda: {
        "o2_generated": 0.0, "o2_consumed": 0.0, "co2_produced": 0.0, "co2_removed": 0.0})
    vented_mol: Mapping[str, float] = field(default_factory=lambda: dict.fromkeys(SPECIES, 0.0))


@dataclass(frozen=True)
class CompartmentReading:
    compartment_id: str
    total_pressure_kpa: float
    o2_partial_kpa: float
    o2_percent: float
    co2_ppm: float
    co2_partial_kpa: float = 0.0
    n2_partial_kpa: float = 0.0


def kpa_per_mole(volume_m3: float) -> float:
    return 1 / (moles_per_m3(1) * volume_m3)


def _nonnegative(name, value):
    if isinstance(value, bool) or not isfinite(value) or value < 0:
        raise ValueError(f"{name} must be finite and nonnegative")


def _positive(name, value):
    _nonnegative(name, value)
    if value == 0:
        raise ValueError(f"{name} must be positive")


def initial_state(plant: Plant, *, co2_ppm: float = 2000, pressure_kpa: float = NOMINAL_PRESSURE_KPA,
                  o2_fraction: float = NOMINAL_O2_FRACTION, mission_s: int = 0) -> CabinState:
    _nonnegative("co2_ppm", co2_ppm)
    _nonnegative("pressure_kpa", pressure_kpa)
    _nonnegative("o2_fraction", o2_fraction)
    n2_fraction = 1 - (o2_fraction + co2_ppm / PPM)
    if n2_fraction < 0:
        raise ValueError("gas fractions must sum to at most one before adding nitrogen")
    moles = {}
    for c in plant.compartments:
        total = moles_per_m3(pressure_kpa) * c.volume_m3
        moles[c.compartment_id] = {
            "o2": total * o2_fraction,
            "co2": total * (co2_ppm / PPM),
            "n2": total * n2_fraction,
        }
    return CabinState(mission_s, moles)


def readings(state: CabinState, plant: Plant) -> list[CompartmentReading]:
    out = []
    for c in plant.compartments:
        gas = state.moles[c.compartment_id]
        total = sum(gas[species] for species in SPECIES)
        scale = kpa_per_mole(c.volume_m3)
        out.append(CompartmentReading(
            compartment_id=c.compartment_id,
            total_pressure_kpa=total * scale,
            o2_partial_kpa=gas["o2"] * scale,
            o2_percent=100 * gas["o2"] / total if total else 0.0,
            co2_ppm=PPM * gas["co2"] / total if total else 0.0,
            co2_partial_kpa=gas["co2"] * scale,
            n2_partial_kpa=gas["n2"] * scale,
        ))
    return out


def step(state: CabinState, plant: Plant, dt_s: int) -> CabinState:
    """Advance the plant with demands based on the start-of-step inventory.

    Withdrawals reserve the available moles in fan, scrubber and crew order.
    Incoming gas and gas produced during this step are available next step.
    """
    if type(dt_s) is not int or dt_s <= 0:
        raise ValueError("dt_s must be a positive integer")
    volume = {c.compartment_id: c.volume_m3 for c in plant.compartments}
    remaining = {cid: {gas: state.moles[cid][gas] for gas in SPECIES} for cid in volume}
    added = {cid: dict.fromkeys(SPECIES, 0.0) for cid in volume}
    ledger = dict(state.ledger)
    n = state.moles

    def withdraw(cid: str, gas: str, requested_mol: float) -> float:
        actual = min(remaining[cid][gas], requested_mol)
        remaining[cid][gas] -= actual
        return actual

    for fan in plant.fans:
        if not fan.powered or fan.flow_m3_h == 0:
            continue
        a, b = fan.between
        moved = fan.flow_m3_h / 3600 * dt_s
        if moved >= min(volume[a], volume[b]):
            raise ValueError("time step too long for this fan flow")
        for gas in SPECIES:
            added[b][gas] += withdraw(a, gas, n[a][gas] * moved / volume[a])
            added[a][gas] += withdraw(b, gas, n[b][gas] * moved / volume[b])

    for s in plant.scrubbers:
        if not s.powered:
            continue
        exposure = s.effective_flow_m3_h * s.effectiveness / 3600 * dt_s / volume[s.compartment_id]
        removed = withdraw(s.compartment_id, "co2", n[s.compartment_id]["co2"] * (1 - exp(-exposure)))
        ledger["co2_removed"] += removed

    for g in plant.generators:
        if g.powered:
            added[g.compartment_id]["o2"] += g.rate_mol_s * dt_s
            ledger["o2_generated"] += g.rate_mol_s * dt_s

    for member in plant.crew:
        factor = WORKLOAD_FACTOR[member.workload]
        demand = NOMINAL_O2_MOL_S * factor * dt_s
        consumed = withdraw(member.compartment_id, "o2", demand)
        produced = NOMINAL_CO2_MOL_S * factor * dt_s * (consumed / demand)
        added[member.compartment_id]["co2"] += produced
        ledger["o2_consumed"] += consumed
        ledger["co2_produced"] += produced

    moles = {cid: {gas: remaining[cid][gas] + added[cid][gas] for gas in SPECIES} for cid in volume}
    return replace(state, mission_s=state.mission_s + dt_s, moles=moles, ledger=ledger)


def mass_balance_residual(initial: CabinState, final: CabinState) -> dict[str, float]:
    """Moles unaccounted for by each species; zero up to floating-point rounding."""
    def total(state, gas):
        return sum(c[gas] for c in state.moles.values())
    led = {k: final.ledger[k] - initial.ledger[k] for k in final.ledger}
    residual = {
        "o2": total(final, "o2") - total(initial, "o2") - led["o2_generated"] + led["o2_consumed"],
        "co2": total(final, "co2") - total(initial, "co2") - led["co2_produced"] + led["co2_removed"],
        "n2": total(final, "n2") - total(initial, "n2"),
    }
    return {gas: residual[gas] + (final.vented_mol[gas] - initial.vented_mol[gas]) for gas in SPECIES}


# --- Synthetic degraded-scrubber scenario -------------------------------------------------

SCENARIO_ID = "cabin-gas-degraded-scrubber-v1"
CO2_LIMIT_PPM = 3200          # the demo rule the planner and gate use
RECOVERED_PPM = 2500          # demo recovery line, below the limit
DEGRADE_AT_S = 600
DEGRADED_EFFECTIVENESS = 0.2  # 20 → 4 m³/h, as in the golden replay
SAMPLE_PERIOD_S = 300
MITIGATIONS = frozenset({"start_standby", "reduce_activity"})


@dataclass(frozen=True)
class GasObservation:
    source_id: str
    entity_id: str
    metric: Literal["co2", "o2_partial", "total_pressure"]
    value: float
    unit: Literal["ppm", "kPa"]
    observed_at_s: int
    quality: Literal["valid"] = "valid"
    synthetic: bool = True


@dataclass(frozen=True)
class PlantEvent:
    mission_s: int
    kind: Literal["scrubber_degraded", "co2_limit_exceeded", "mitigation_applied",
                  "mitigation_refused", "co2_recovered"]
    detail: str
    operation_id: str | None = None


@dataclass(frozen=True)
class ScenarioResult:
    scenario_id: str
    observations: tuple[GasObservation, ...]
    events: tuple[PlantEvent, ...]
    peak_co2_ppm: float
    final: tuple[CompartmentReading, ...]
    mass_balance: Mapping[str, float]


def scenario_plant(crew: Sequence[CrewLoad]) -> Plant:
    """Habitat with the primary scrubber and O₂ generator, command deck with the standby unit."""
    return Plant(
        compartments=(Compartment("habitat", 60), Compartment("command", 40)),
        fans=(Fan("fan-hab-cmd", ("habitat", "command"), 180),),
        scrubbers=(Scrubber("scrubber-primary", "habitat", 20),
                   Scrubber("scrubber-standby", "command", 20, powered=False)),
        generators=(OxygenGenerator("ogs-01", "habitat", NOMINAL_O2_MOL_S * GOLDEN_CREW),),
        crew=tuple(crew),
    )


def _replace_scrubber(plant: Plant, scrubber_id: str, **changes) -> Plant:
    return replace(plant, scrubbers=tuple(replace(s, **changes) if s.scrubber_id == scrubber_id else s
                                          for s in plant.scrubbers))


def _apply(plant: Plant, candidate_id: str) -> Plant:
    if candidate_id == "start_standby":
        return _replace_scrubber(plant, "scrubber-standby", powered=True)
    return replace(plant, crew=tuple(replace(m, workload="rest") for m in plant.crew))


def run_degraded_scrubber(crew: Sequence[CrewLoad], *, receipt: Mapping | None = None,
                          committed_at_s: int | None = None, horizon_s: int = 43_200,
                          dt_s: int = 10) -> ScenarioResult:
    """Degrade the primary scrubber at 10:00 and record evidence until the horizon.

    A mitigation applies only from an accepted commit-gate receipt that reports
    the change as applied, for ``start_standby`` or ``reduce_activity``, at
    ``committed_at_s``. Anything else is recorded as refused and changes nothing.
    """
    if (receipt is None) != (committed_at_s is None):
        raise ValueError("a receipt and its commit time go together")
    if committed_at_s is not None and (committed_at_s % dt_s or not 0 <= committed_at_s <= horizon_s):
        raise ValueError("commit time must fall on a step inside the horizon")
    plant = scenario_plant(crew)
    state = start = initial_state(plant)
    events: list[PlantEvent] = []
    observations: list[GasObservation] = []
    peak = 0.0
    exceeded = mitigated = recovered = False

    while True:
        t = state.mission_s
        if t == DEGRADE_AT_S:
            plant = _replace_scrubber(plant, "scrubber-primary", effectiveness=DEGRADED_EFFECTIVENESS)
            events.append(PlantEvent(t, "scrubber_degraded", "scrubber-primary at 20% effectiveness"))
        if receipt is not None and t == committed_at_s:
            candidate = receipt.get("candidate_id")
            if receipt.get("status") == "accepted" and receipt.get("applied") is True and candidate in MITIGATIONS:
                plant = _apply(plant, candidate)
                mitigated = True
                events.append(PlantEvent(t, "mitigation_applied", candidate, receipt.get("operation_id")))
            else:
                events.append(PlantEvent(t, "mitigation_refused",
                                         f"receipt {receipt.get('status')} · applied={receipt.get('applied')}",
                                         receipt.get("operation_id")))
        now = readings(state, plant)
        worst = max(r.co2_ppm for r in now)
        peak = max(peak, worst)
        if worst > CO2_LIMIT_PPM and not exceeded:
            exceeded = True
            events.append(PlantEvent(t, "co2_limit_exceeded", f"{worst:.0f} ppm above the {CO2_LIMIT_PPM} ppm demo rule"))
        if exceeded and mitigated and not recovered and worst <= RECOVERED_PPM:
            recovered = True
            events.append(PlantEvent(t, "co2_recovered", f"all compartments at or below {RECOVERED_PPM} ppm"))
        if t % SAMPLE_PERIOD_S == 0:
            for r in now:
                base = f"sim.cabin_gas.{r.compartment_id}"
                observations += [
                    GasObservation(base + ".co2", r.compartment_id, "co2", r.co2_ppm, "ppm", t),
                    GasObservation(base + ".o2_partial", r.compartment_id, "o2_partial", r.o2_partial_kpa, "kPa", t),
                    GasObservation(base + ".pressure", r.compartment_id, "total_pressure", r.total_pressure_kpa, "kPa", t),
                ]
        if t >= horizon_s:
            break
        state = step(state, plant, dt_s)

    return ScenarioResult(SCENARIO_ID, tuple(observations), tuple(events), peak,
                          tuple(readings(state, plant)), mass_balance_residual(start, state))
