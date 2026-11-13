"""SQLite connection settings and atomic startup migrations."""

import re
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from importlib.resources import files
from pathlib import Path

MIGRATIONS = (
    "001_initial.sql",
    "002_integer_integrity.sql",
    "003_observation_series.sql",
    "004_health.sql",
    "005_driver_pause.sql",
)
SCHEMA_REVISION = len(MIGRATIONS)


def connect(database_path: Path) -> sqlite3.Connection:
    """Open a local database in autocommit mode with explicit write transactions."""
    if str(database_path) == ":memory:":
        raise ValueError("Use a file-backed SQLite database, such as a temporary file")
    connection = sqlite3.connect(database_path, timeout=5, isolation_level=None)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.row_factory = sqlite3.Row
    except BaseException:
        connection.close()
        raise
    return connection


def migrate(database_path: Path) -> None:
    """Apply pending revisions under the same lock used to read the schema version."""
    migration_dir = files("symbiosis_x.storage").joinpath("migrations")
    with closing(connect(database_path)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            revision = connection.execute("PRAGMA user_version").fetchone()[0]
            if revision > SCHEMA_REVISION:
                raise RuntimeError(f"Unsupported SQLite schema revision {revision}")
            for expected, name in enumerate(MIGRATIONS[revision:], start=revision + 1):
                sql = migration_dir.joinpath(name).read_text(encoding="utf-8")
                for statement in _statements(sql):
                    connection.execute(statement)
                if connection.execute("PRAGMA user_version").fetchone()[0] != expected:
                    raise RuntimeError(f"{name} did not set schema revision {expected}")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise


def _statements(sql: str) -> Iterator[str]:
    """Split packaged SQL by complete statements without implicit commits."""
    start = 0
    for match in re.finditer(";", sql):
        end = match.end()
        statement = sql[start:end]
        if sqlite3.complete_statement(statement):
            yield statement
            start = end

    tail = sql[start:]
    if not re.fullmatch(r"(?:\s+|--[^\n]*|/\*[\s\S]*?\*/)*", tail):
        raise ValueError("Incomplete SQLite migration statement")
