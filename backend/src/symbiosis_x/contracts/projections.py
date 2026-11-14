"""Separate Crew and delivered Ground response contracts."""

from typing import Literal

from pydantic import model_validator

from .events import Contract, Identifier, NonnegativeInt, NonnegativeNumber

from symbiosis_x.crew.profile import AstronautHealthProfile


class Quantity(Contract):
    value: NonnegativeNumber
    observed_at_s: int


class CrewCO2(Quantity):
    unit: Literal["ppm"]
    kind: Literal["modeled_estimate"]


class GroundCO2(Quantity):
    unit: Literal["ppm"]
    kind: Literal["delivered_observation"]


class ScrubberFlow(Quantity):
    unit: Literal["m3/h"]


class PowerHeadroom(Quantity):
    unit: Literal["kW"]


class CrewEquipment(Contract):
    co2: CrewCO2
    scrubber_removal: ScrubberFlow
    power_headroom: PowerHeadroom


class GroundEquipment(Contract):
    co2: GroundCO2
    scrubber_removal: ScrubberFlow
    power_headroom: PowerHeadroom


class Snapshot(Contract):
    schema_version: Literal[1]
    run_id: Identifier
    scenario_id: Identifier
    seed: int
    mission_s: NonnegativeInt
    snapshot_id: Identifier
    decision_rev: NonnegativeInt


class Profile(Contract):
    crew_id: Identifier
    display_name: Identifier
    simulated: Literal[True]


class HeartRate(Quantity):
    metric: Literal["heart_rate"]
    unit: Literal["bpm"]
    quality: Literal["valid"]
    source_id: Identifier


class CheckIn(Contract):
    visibility: Literal["onboard_private"]
    text: str


class CrewContext(Contract):
    profile: Profile
    observations: list[HeartRate]
    check_in: CheckIn


class CrewProjection(Snapshot):
    role: Literal["crew"]
    equipment: CrewEquipment
    crew: CrewContext | None = None


class Delivery(Contract):
    observed_at_s: int
    received_at_s: NonnegativeInt
    age_s: NonnegativeInt
    link_status: Literal["delayed"]


class GroundProjection(Snapshot):
    role: Literal["ground"]
    equipment: GroundEquipment
    delivery: Delivery

    @model_validator(mode="after")
    def validate_delivery(self):
        delivery = self.delivery
        if not delivery.observed_at_s <= delivery.received_at_s <= self.mission_s:
            raise ValueError("invalid delivery chronology")
        if delivery.age_s != self.mission_s - delivery.observed_at_s:
            raise ValueError("age must be measured from observation time")
        return self


class RunView(Contract):
    run_id: Identifier
    scenario_id: Identifier
    scenario_version: Identifier
    mission_s: NonnegativeInt
    status: Literal["active", "closed"] = "active"


class AcceptedCO2(Quantity):
    unit: Literal["ppm"]
    source_id: Identifier
    event_id: Identifier


class TraceRecord(Contract):
    """One allowlisted operational milestone. It carries no tool input, evidence or private data."""

    case_id: Identifier
    mission_s: NonnegativeInt
    actor: Literal["monitor", "ground", "relay"]
    step: Literal["incident_opened", "fault_linked", "advice_queued", "advice_received"]
    result: Identifier
    reason_code: Identifier | None = None
    next_owner: Literal["crew", "commander"] | None = None


class GroundCaseStatus(Contract):
    """The approved health case packet as Ground received it, plus Ground's own acknowledgment."""

    case_alias: Identifier
    review_priority: Literal["urgent", "routine"]
    status: Literal["open", "acknowledged"]
    delivered_at_s: NonnegativeInt
    ground_ack: Literal["pending", "acknowledged"]
    ground_acknowledged_at_s: NonnegativeInt | None = None


class CurrentCrewView(RunView):
    role: Literal["crew"] = "crew"
    decision_rev: NonnegativeInt
    co2: AcceptedCO2 | None
    health_profile: AstronautHealthProfile
    health_assessment: dict | None = None
    # Crew-private reminders (SX-24C); never part of a Ground packet.
    health_followup: dict | None = None
    # Crew-private comparable trend of the latest scalar metric (SX-23E evaluator).
    health_trend: dict | None = None
    cabin_exposure: dict | None = None
    trace: list[TraceRecord] = []


class GroundPacket(Contract):
    """Operational data stored at delivery, without private or live Crew fields."""

    co2: GroundCO2
    power_headroom: PowerHeadroom | None = None


class DeliveredTelemetry(Contract):
    snapshot_id: Identifier
    decision_rev: NonnegativeInt
    delivery: Delivery
    co2: GroundCO2
    power_headroom: PowerHeadroom | None = None


class CurrentGroundView(RunView):
    role: Literal["ground"] = "ground"
    packet: DeliveredTelemetry | None
    trace: list[TraceRecord] = []
    health_cases: list[GroundCaseStatus] = []
