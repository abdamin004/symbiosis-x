"""Create canonical observations from the scheduled virtual cabin CO₂ sensor."""

from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class CabinCO2Sensor:
    source_id: str
    component_id: str
    entity_id: str
    metric: str
    unit: str
    sample_period_s: int
    input_kind: str
    visibility: str

    def __post_init__(self) -> None:
        if (self.metric, self.unit) != ("co2", "ppm"):
            raise ValueError("cabin CO₂ requires the co2 metric in ppm")
        if type(self.sample_period_s) is not int or self.sample_period_s <= 0:
            raise ValueError("sample period must be a positive integer in seconds")

    def sample(
        self,
        co2_ppm: float | None,
        *,
        run_id: str,
        mission_s: int,
        model_version: str,
    ) -> dict | None:
        """Sample on mission-time boundaries. Missing input yields an unavailable reading."""
        if type(mission_s) is not int or mission_s < 0:
            raise ValueError("mission time must be nonnegative integer seconds")
        if mission_s % self.sample_period_s:
            return None
        if co2_ppm is not None and (not isfinite(co2_ppm) or co2_ppm < 0):
            raise ValueError("CO₂ concentration must be finite and nonnegative")

        payload = {
            "metric": self.metric,
            "value": co2_ppm,
            "unit": self.unit,
            "quality": "valid" if co2_ppm is not None else "unavailable",
        }
        if co2_ppm is None:
            payload["reason_code"] = "MODEL_VALUE_UNAVAILABLE"

        return {
            "schema_version": 1,
            "run_id": run_id,
            "event_id": f"{self.source_id}:{mission_s}",
            "event_type": "observation.recorded",
            "source_id": self.source_id,
            "entity_id": self.entity_id,
            "observed_at_s": mission_s,
            "received_at_s": mission_s,
            "model_version": model_version,
            "payload": payload,
        }
