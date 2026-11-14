"""Typed validation for the seven synthetic crew health measurements."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


class MeasurementBase(BaseModel):
    """Fields shared by every measurement."""

    model_config = ConfigDict(extra="forbid")

    observed_at_s: int = Field(ge=0)
    source_id: str = Field(min_length=1)
    quality: str = Field(min_length=1)


class HeartRateMeasurement(MeasurementBase):
    metric: Literal["heart_rate"]
    value: float = Field(ge=0)
    unit: Literal["bpm"]


class BloodPressureMeasurement(MeasurementBase):
    metric: Literal["blood_pressure"]
    systolic: float = Field(gt=0)
    diastolic: float = Field(gt=0)
    unit: Literal["mmHg"]


class GlucoseMeasurement(MeasurementBase):
    metric: Literal["glucose"]
    value: float | None = Field(ge=0)
    unit: Literal["mg/dL"]
    method: str = Field(min_length=1)
    meal_context: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_value_for_available_reading(self):
        if self.value is None and self.quality != "unavailable":
            raise ValueError("an available glucose measurement requires a value")
        return self


class TemperatureMeasurement(MeasurementBase):
    metric: Literal["temperature"]
    value: float
    unit: Literal["°C"]
    method: str = Field(min_length=1)
    site: str = Field(min_length=1)


class SleepMeasurement(MeasurementBase):
    metric: Literal["sleep"]
    duration_min: int | None = Field(default=None, ge=0)
    start_mission_s: int | None = Field(default=None, ge=0)
    end_mission_s: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_duration_or_interval(self):
        has_duration = self.duration_min is not None
        has_interval_field = (
            self.start_mission_s is not None or self.end_mission_s is not None
        )

        if has_duration == has_interval_field:
            raise ValueError(
                "provide either duration_min or a start/end mission-time pair"
            )

        if has_interval_field:
            if self.start_mission_s is None or self.end_mission_s is None:
                raise ValueError("sleep interval requires both start and end")
            if self.end_mission_s <= self.start_mission_s:
                raise ValueError("sleep end must be after sleep start")

        return self


class MoodMeasurement(MeasurementBase):
    metric: Literal["mood"]
    score: int = Field(ge=1, le=5)
    scale_id: Literal["mood-1-to-5-v1"]
    unit: Literal["score"]


class SleepQualityMeasurement(MeasurementBase):
    metric: Literal["sleep_quality"]
    score: int = Field(ge=1, le=5)
    scale_id: Literal["sleep-quality-1-to-5-v1"]
    unit: Literal["score"]


class SymptomsMeasurement(MeasurementBase):
    metric: Literal["symptoms"]
    symptoms: list[str] = Field(min_length=1)
    private_text: str | None = None


HealthMeasurement = Annotated[
    HeartRateMeasurement
    | BloodPressureMeasurement
    | GlucoseMeasurement
    | TemperatureMeasurement
    | SleepMeasurement
    | SleepQualityMeasurement
    | MoodMeasurement
    | SymptomsMeasurement,
    Field(discriminator="metric"),
]

_health_measurement_adapter = TypeAdapter(HealthMeasurement)


def validate_health_measurement(payload: object) -> HealthMeasurement:
    """Return a typed measurement or raise a Pydantic validation error."""
    return _health_measurement_adapter.validate_python(payload)
