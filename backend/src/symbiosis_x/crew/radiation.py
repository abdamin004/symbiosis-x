"""Parse a single sourced instrument series from a NASA OSDR RadLab CSV."""

from __future__ import annotations

import csv
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RADLAB_PORTAL = "https://visualization.osdr.nasa.gov/radlab/gui/overview"
RADLAB_API_GUIDE = "https://visualization.osdr.nasa.gov/radlab/gui/data-api/"
QUANTITY_UNITS = {
    "absorbed_dose_rate": "µGy/hour",
    "dose_equivalent_rate": "µSv/hour",
}
REQUIRED_COLUMNS = {"timestamp", "instrument_id", "instrument", "spacecraft"}


class RadLabExportError(ValueError):
    """Raised when the CSV cannot represent one traceable RadLab series."""


def _utc_timestamp(raw: str, line_number: int) -> tuple[str, bool]:
    try:
        parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise RadLabExportError(
            f"row {line_number}: invalid ISO timestamp {raw!r}"
        ) from exc

    assumed_utc = parsed.tzinfo is None
    if assumed_utc:
        # RadLab CSV timestamps can be timezone-naive. Keep the assumption explicit
        # in the output instead of pretending the source included a UTC offset.
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat().replace("+00:00", "Z"), assumed_utc


def parse_radlab_csv(
    csv_text: str,
    *,
    quantity: str,
    source_url: str,
    expected_instrument_id: str | None = None,
) -> dict[str, Any]:
    """Parse a CSV into one validated series while preserving missing readings."""
    if quantity not in QUANTITY_UNITS:
        raise RadLabExportError(
            f"unsupported quantity {quantity!r}; choose one of "
            f"{', '.join(QUANTITY_UNITS)}"
        )
    if not source_url.strip():
        raise RadLabExportError("source_url is required for provenance")

    reader = csv.DictReader(io.StringIO(csv_text))
    headers = set(reader.fieldnames or [])
    required = REQUIRED_COLUMNS | {quantity}
    missing = sorted(required - headers)
    if missing:
        raise RadLabExportError("missing required CSV columns: " + ", ".join(missing))

    rows: list[tuple[int, dict[str, str | None]]] = []
    for line_number, row in enumerate(reader, start=2):
        if None in row:
            raise RadLabExportError(f"row {line_number}: more cells than headers")
        if expected_instrument_id and row.get("instrument_id") != expected_instrument_id:
            continue
        rows.append((line_number, row))

    if not rows:
        raise RadLabExportError("CSV contains no rows for the selected instrument")

    instrument_ids = {(row.get("instrument_id") or "").strip() for _, row in rows}
    instruments = {(row.get("instrument") or "").strip() for _, row in rows}
    spacecrafts = {(row.get("spacecraft") or "").strip() for _, row in rows}
    if "" in instrument_ids or len(instrument_ids) != 1:
        raise RadLabExportError("CSV must identify exactly one non-empty instrument_id")
    if "" in instruments or len(instruments) != 1:
        raise RadLabExportError("CSV must identify exactly one non-empty instrument")
    if "" in spacecrafts or len(spacecrafts) != 1:
        raise RadLabExportError("CSV must identify exactly one non-empty spacecraft")

    instrument_id = next(iter(instrument_ids))
    if expected_instrument_id and instrument_id != expected_instrument_id:
        raise RadLabExportError(
            f"expected instrument {expected_instrument_id!r}, got {instrument_id!r}"
        )

    points: list[dict[str, Any]] = []
    assumed_utc_seen = False
    for line_number, row in rows:
        raw_timestamp = (row.get("timestamp") or "").strip()
        if not raw_timestamp:
            raise RadLabExportError(f"row {line_number}: timestamp is blank")
        timestamp_utc, assumed_utc = _utc_timestamp(raw_timestamp, line_number)
        assumed_utc_seen = assumed_utc_seen or assumed_utc

        raw_value = (row.get(quantity) or "").strip()
        value: float | None
        if raw_value == "":
            value = None
        else:
            try:
                value = float(raw_value)
            except ValueError as exc:
                raise RadLabExportError(
                    f"row {line_number}: {quantity} is not numeric: {raw_value!r}"
                ) from exc
            if not math.isfinite(value) or value < 0:
                raise RadLabExportError(
                    f"row {line_number}: {quantity} must be finite and nonnegative"
                )

        points.append({"timestamp_utc": timestamp_utc, "value": value})

    points.sort(key=lambda point: point["timestamp_utc"])
    return {
        "schema_version": 1,
        "source": {
            "name": "NASA OSDR RadLab",
            "portal_url": RADLAB_PORTAL,
            "api_guide_url": RADLAB_API_GUIDE,
            "export_url": source_url,
        },
        "series_type": "space-radiation-instrument-context",
        "spacecraft": next(iter(spacecrafts)),
        "instrument": next(iter(instruments)),
        "instrument_id": instrument_id,
        "quantity": quantity,
        "unit": QUANTITY_UNITS[quantity],
        "time_basis": (
            "UTC; source timestamps without an offset were interpreted as UTC"
            if assumed_utc_seen
            else "UTC; offset-aware source timestamps normalized to UTC"
        ),
        "coverage_utc": {
            "start": points[0]["timestamp_utc"],
            "end": points[-1]["timestamp_utc"],
        },
        "row_count": len(points),
        "missing_value_count": sum(point["value"] is None for point in points),
        "points": points,
        "interpretation": (
            "Instrument telemetry for mission context only; not an individual "
            "astronaut's personal dose and not a health alert threshold."
        ),
    }


def load_radlab_series(
    path: str | Path,
    *,
    quantity: str,
    source_url: str,
    expected_instrument_id: str | None = None,
) -> dict[str, Any]:
    """Read a UTF-8 CSV file and parse it as a single RadLab series."""
    csv_text = Path(path).read_text(encoding="utf-8-sig")
    return parse_radlab_csv(
        csv_text,
        quantity=quantity,
        source_url=source_url,
        expected_instrument_id=expected_instrument_id,
    )


def write_series_json(series: dict[str, Any], path: str | Path) -> None:
    """Write a validated series as formatted, deterministic JSON."""
    Path(path).write_text(
        json.dumps(series, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
