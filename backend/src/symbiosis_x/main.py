"""FastAPI entry point for the local SYMBIOSIS X backend."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from os import environ
from pathlib import Path

from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool

from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import migrate

API_TITLE = "SYMBIOSIS X"
API_VERSION = "0.1.0"


def create_app(*, database_path: str | Path | None = None) -> FastAPI:
    """Build the application with an optional isolated SQLite file path."""
    if database_path is None:
        database_path = environ.get("SYMBIOSIS_X_DB_PATH", "symbiosis-x.sqlite3")

    path = Path(database_path)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        await run_in_threadpool(migrate, path)
        application.state.repository = Repository(path)
        yield

    application = FastAPI(title=API_TITLE, version=API_VERSION, lifespan=lifespan)
    application.state.database_path = path
    return application


app = create_app()
