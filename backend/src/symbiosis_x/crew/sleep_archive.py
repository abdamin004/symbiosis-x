"""Project one fictional astronaut's sleep phase summary to Crew."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field

from symbiosis_x.contracts.events import Contract, NonnegativeInt, NonnegativeNumber

ARCHIVE_PATH = Path(__file__).resolve().parents[4] / "scenarios" / "mission-30d-v1.json"


class SleepPhaseSummary(Contract):
    phase: Literal["preflight", "inflight", "postflight"]
    mean_duration_min: NonnegativeNumber | None
    mean_quality_score: float | None = Field(ge=1, le=5)
    duration_samples: NonnegativeInt
    quality_samples: NonnegativeInt


@lru_cache(maxsize=4)
def sleep_archive_for(crew_id: str) -> tuple[SleepPhaseSummary, ...]:
    archive = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8"))
    return tuple(
        SleepPhaseSummary.model_validate({key: value for key, value in row.items() if key != "crew_id"})
        for row in archive["sleep_phase_summary"]
        if row["crew_id"] == crew_id
    )
