"""Service probes that report process health without touching a run."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, ValidationError

from symbiosis_x.storage.sqlite import SCHEMA_REVISION

router = APIRouter(prefix="/health", tags=["health"])

NO_STORE = {"Cache-Control": "no-store"}


class LiveStatus(BaseModel):
    status: Literal["live"]


@router.get("/live", response_model=LiveStatus)
def live(response: Response) -> LiveStatus:
    """Answer while FastAPI responds; never open SQLite or read the mission clock."""
    response.headers.update(NO_STORE)
    return LiveStatus(status="live")


StoreCheck = Literal["ok", "unavailable"]
SchemaCheck = Literal["ok", "mismatch", "unknown"]
ManifestCheck = Literal["ok", "missing", "invalid"]
ReadyReason = Literal["STORE_UNAVAILABLE", "SCHEMA_MISMATCH", "MANIFEST_MISSING", "MANIFEST_INVALID"]


class ReadyChecks(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    store: StoreCheck
    schema_check: SchemaCheck = Field(alias="schema")  # "schema" would shadow a BaseModel attribute
    manifest: ManifestCheck


class ReadyStatus(BaseModel):
    status: Literal["ready", "not_ready"]
    reason: ReadyReason | None
    checks: ReadyChecks


class GoldenManifest(BaseModel):
    """The fields readiness relies on; SX-18A's unit test validates the full document."""

    model_config = ConfigDict(extra="allow")

    schema_version: Literal[1]
    scenario_id: Literal["sx01-golden"]
    scenario_version: Literal["1"]
    synthetic: StrictBool
    seed: StrictInt
    start_s: StrictInt
    end_s: StrictInt
    reference_timestamps_s: dict[str, StrictInt]


def check_store(database_path: Path) -> tuple[StoreCheck, SchemaCheck]:
    """Read the schema revision from an existing store; never create or repair it."""
    if not database_path.is_file():
        return "unavailable", "unknown"
    try:
        uri = database_path.resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as db:
            db.execute("PRAGMA query_only = ON")
            revision = db.execute("PRAGMA user_version").fetchone()[0]
    except sqlite3.Error:
        return "unavailable", "unknown"
    return "ok", "ok" if revision == SCHEMA_REVISION else "mismatch"


def check_manifest(manifest_path: Path) -> ManifestCheck:
    if not manifest_path.is_file():
        return "missing"
    try:
        GoldenManifest.model_validate(json.loads(manifest_path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ValidationError):
        return "invalid"
    return "ok"


@router.get("/ready", response_model=ReadyStatus, responses={503: {"model": ReadyStatus}})
def ready(request: Request) -> JSONResponse:
    """Report whether the store, schema and golden manifest are usable, without changing any of them."""
    store, schema = check_store(request.app.state.database_path)
    manifest = check_manifest(request.app.state.golden_manifest_path)
    reason: ReadyReason | None = None
    if store != "ok":
        reason = "STORE_UNAVAILABLE"
    elif schema != "ok":
        reason = "SCHEMA_MISMATCH"
    elif manifest == "missing":
        reason = "MANIFEST_MISSING"
    elif manifest == "invalid":
        reason = "MANIFEST_INVALID"
    body = ReadyStatus(
        status="not_ready" if reason else "ready", reason=reason,
        checks=ReadyChecks(store=store, schema=schema, manifest=manifest),
    )
    return JSONResponse(body.model_dump(by_alias=True), status_code=503 if reason else 200, headers=NO_STORE)
