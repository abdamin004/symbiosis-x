"""Exercise the packaged SQLite schema using a local temporary database."""

import sqlite3
from contextlib import closing
from importlib.resources import files

import pytest


def test_empty_database_migrates_and_reopens(tmp_path):
    path = tmp_path / "pilot.sqlite3"
    migration = files("symbiosis_x.storage").joinpath("migrations/001_initial.sql")
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript("BEGIN;\n" + migration.read_text(encoding="utf-8") + "\nCOMMIT;")

    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        assert connection.execute("PRAGMA user_version").fetchone() == (1,)
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_schema WHERE type = 'table'")
        }
        assert tables == {"runs", "events", "operations", "snapshots", "messages"}

        connection.execute(
            """
            INSERT INTO runs (run_id, scenario_id, scenario_version, seed,
                              schema_version, model_version, policy_version)
            VALUES ('run-01', 'sx01-golden', '1', 4242, 1, 'cabin-1', 'demo-1')
            """
        )
        connection.execute(
            """
            INSERT INTO snapshots (run_id, snapshot_id, audience, decision_rev,
                                   observed_at_s, payload_json)
            VALUES ('run-01', 'crew-v101', 'crew', 101, 0, '{}'),
                   ('run-01', 'ground-v100', 'ground', 100, -60, '{}')
            """
        )
        queue = """
            INSERT INTO messages (run_id, message_id, direction, issued_at_s,
                                  deliver_at_s, ground_snapshot_id, payload_json)
            VALUES ('run-01', ?, 'to_ground', 0, 360, ?, '{}')
        """
        connection.execute(queue, ("ground-message", "ground-v100"))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            connection.execute(queue, ("crew-message", "crew-v101"))
        connection.commit()
