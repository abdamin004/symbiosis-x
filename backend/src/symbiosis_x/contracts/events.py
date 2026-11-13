"""Version-one event envelopes shared by the simulator and journal."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=256)]
NonnegativeInt = Annotated[int, Field(ge=0)]
NonnegativeNumber = Annotated[float, Field(ge=0)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Observation(Contract):
    metric: Literal["co2"]
    value: NonnegativeNumber | None
    unit: Literal["ppm"]
    quality: Literal["valid", "suspect", "unavailable"]
    reason_code: Literal["MODEL_VALUE_UNAVAILABLE"] | None = None

    @model_validator(mode="after")
    def validate_availability(self):
        missing = self.quality == "unavailable"
        if missing != (self.value is None) or missing != (self.reason_code is not None):
            raise ValueError("only an unavailable observation has a null value and a reason")
        return self


class EventEnvelope(Contract):
    schema_version: Literal[1]
    run_id: Identifier
    event_id: Identifier
    event_type: Identifier
    source_id: Identifier
    entity_id: Identifier
    observed_at_s: int
    received_at_s: NonnegativeInt
    model_version: Identifier
    event_seq: Annotated[int, Field(gt=0)] | None = None
    incident_id: Identifier | None = None
    causation_id: Identifier | None = None
    payload: dict

    @model_validator(mode="after")
    def validate_times(self):
        if self.received_at_s < self.observed_at_s:
            raise ValueError("receipt cannot precede observation")
        return self


class ObservationEvent(EventEnvelope):
    event_type: Literal["observation.recorded"]
    payload: Observation
