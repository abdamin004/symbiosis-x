"""FastAPI entry point for the local SYMBIOSIS X backend."""

from os import environ
from pathlib import Path

from fastapi import FastAPI

API_TITLE = "SYMBIOSIS X"
API_VERSION = "0.1.0"


def create_app(*, database_path: str | Path | None = None) -> FastAPI:
    """Build the application with an optional isolated SQLite file path."""
    if database_path is None:
        database_path = environ.get("SYMBIOSIS_X_DB_PATH", "symbiosis-x.sqlite3")

    application = FastAPI(title=API_TITLE, version=API_VERSION)
    application.state.database_path = Path(database_path)
    return application


app = create_app()
