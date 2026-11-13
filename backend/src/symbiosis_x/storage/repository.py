"""Transaction boundary for a run writer and its idempotency receipt."""

import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path

from .sqlite import connect


@dataclass(frozen=True)
class Repository:
    database_path: Path

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        """Read one consistent snapshot without allowing writes."""
        with closing(connect(self.database_path)) as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            yield connection

    @contextmanager
    def write(self) -> Iterator[sqlite3.Connection]:
        """Commit all records in a write together or roll them back together."""
        with closing(connect(self.database_path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
