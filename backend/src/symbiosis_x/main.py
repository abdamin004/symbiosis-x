
"""FastAPI entry point for the local SYMBIOSIS X backend."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from os import environ
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from symbiosis_x.api.health import router as health_router
from symbiosis_x.api.crew import router as crew_router
from symbiosis_x.api.ground import router as ground_router
from symbiosis_x.api.roles import new_demo_tokens, router as roles_router
from symbiosis_x.api.runs import router as runs_router
from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import migrate

API_TITLE = "SYMBIOSIS X"
API_VERSION = "0.1.0"


def create_app(
    *,
    database_path: str | Path | None = None,
    enable_local_demo: bool | None = None,
) -> FastAPI:
    """Build the application with an optional isolated SQLite file path."""
    if database_path is None:
        database_path = environ.get(
            "SYMBIOSIS_X_DB_PATH", "symbiosis-x.sqlite3"
        )

    path = Path(database_path)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        await run_in_threadpool(migrate, path)
        application.state.repository = Repository(path)
        yield

    application = FastAPI(
        title=API_TITLE,
        version=API_VERSION,
        lifespan=lifespan,
    )

    application.state.database_path = path

    canvas_path = environ.get("SYMBIOSIS_X_MISSION_CANVAS")

    if enable_local_demo is None:
        enable_local_demo = (
            bool(canvas_path)
            or environ.get("SYMBIOSIS_X_LOCAL_DEMO") == "1"
        )

    application.state.demo_tokens = (
        new_demo_tokens() if enable_local_demo else {}
    )

    # Register API routers
    application.include_router(health_router)
    application.include_router(roles_router)
    application.include_router(runs_router)
    application.include_router(crew_router)
    application.include_router(ground_router)

    if canvas_path:
        path_to_canvas = Path(canvas_path)

        @application.get("/mission", include_in_schema=False)
        def mission_canvas() -> FileResponse:
            if not path_to_canvas.is_file():
                raise HTTPException(
                    404, "MISSION_CANVAS_UNAVAILABLE"
                )

            return FileResponse(
                path_to_canvas,
                media_type="text/html",
                headers={"Cache-Control": "no-store"},
            )

    return application


app = create_app()
