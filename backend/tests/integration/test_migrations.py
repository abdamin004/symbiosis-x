"""Exercise the packaged SQLite schema using a local temporary database."""

import sqlite3
from contextlib import closing
from importlib.resources import files

import pytest
from fastapi.testclient import TestClient

from symbiosis_x.main import create_app
from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import migrate


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

        _insert_run(connection)
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


def _insert_run(connection):
    connection.execute(
        """
        INSERT INTO runs (run_id, scenario_id, scenario_version, seed,
                          schema_version, model_version, policy_version)
        VALUES ('run-01', 'sx01-golden', '1', 4242, 1, 'cabin-1', 'demo-1')
        """
    )


def test_transaction_rolls_back(tmp_path):
    path = tmp_path / "pilot.sqlite3"
    app = create_app(database_path=path)

    with TestClient(app):
        repository = app.state.repository
        with repository.write() as connection:
            _insert_run(connection)

        with pytest.raises(RuntimeError, match="interrupted"):
            with repository.write() as connection:
                connection.execute(
                    """
                    INSERT INTO events (run_id, event_seq, event_id, event_type,
                                        mission_s, visibility, payload_json)
                    VALUES ('run-01', 1, 'ev-01', 'action.applied', 0, 'operational', '{}')
                    """
                )
                connection.execute(
                    """
                    INSERT INTO operations (run_id, operation_scope, operation_id,
                                            request_digest, receipt_json)
                    VALUES ('run-01', 'action', 'cmd-01', 'digest', '{}')
                    """
                )
                raise RuntimeError("interrupted")

    with TestClient(create_app(database_path=path)) as restarted:
        assert restarted.get("/openapi.json").status_code == 200

    with closing(sqlite3.connect(path)) as reopened:
        assert reopened.execute("PRAGMA user_version").fetchone() == (2,)
        assert reopened.execute("SELECT run_id FROM runs").fetchall() == [("run-01",)]
        assert reopened.execute("SELECT event_id FROM events").fetchall() == []
        assert reopened.execute("SELECT operation_id FROM operations").fetchall() == []


def test_migration_upgrades_revision_one_and_enforces_integer_clock(tmp_path):
    path = tmp_path / "pilot.sqlite3"
    migration = files("symbiosis_x.storage").joinpath("migrations/001_initial.sql")
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(migration.read_text(encoding="utf-8"))
        _insert_run(connection)
        connection.commit()

    migrate(path)
    repository = Repository(path)
    with repository.write() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
        assert connection.execute("SELECT run_id FROM runs").fetchone()[0] == "run-01"

    with pytest.raises(sqlite3.IntegrityError, match="integer"):
        with repository.write() as connection:
            connection.execute("UPDATE runs SET mission_s = 'oops'")

    with pytest.raises(sqlite3.IntegrityError, match="integer"):
        with repository.write() as connection:
            connection.execute(
                """
                INSERT INTO events (run_id, event_seq, event_id, event_type,
                                    mission_s, visibility, payload_json)
                VALUES ('run-01', 1.5, 'ev-01', 'action.applied', 0, 'operational', '{}')
                """
            )

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        with repository.write() as connection:
            connection.execute(
                """
                INSERT INTO operations (run_id, operation_scope, operation_id,
                                        request_digest, receipt_json)
                VALUES ('unknown-run', 'action', 'cmd-01', 'digest', '{}')
                """
            )


def test_invalid_legacy_data_does_not_partially_upgrade(tmp_path):
    path = tmp_path / "invalid-v1.sqlite3"
    migration = files("symbiosis_x.storage").joinpath("migrations/001_initial.sql")
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(migration.read_text(encoding="utf-8"))
        _insert_run(connection)
        connection.execute("UPDATE runs SET mission_s = 'invalid'")
        connection.commit()

    with pytest.raises(sqlite3.IntegrityError):
        migrate(path)

    with closing(sqlite3.connect(path)) as reopened:
        assert reopened.execute("PRAGMA user_version").fetchone() == (1,)
        assert reopened.execute("SELECT mission_s FROM runs").fetchone() == ("invalid",)
        assert reopened.execute("SELECT count(*) FROM sqlite_schema WHERE type = 'trigger'").fetchone() == (0,)



def test_migration_parser_supports_multiple_statements_and_comments():
    from symbiosis_x.storage.sqlite import _statements

    script = (
        "CREATE TABLE log (message TEXT); CREATE TABLE source (message TEXT);\n"
        "CREATE TRIGGER copy_log AFTER INSERT ON source BEGIN "
        "INSERT INTO log VALUES ('one;two'); INSERT INTO log VALUES (NEW.message); END;\n"
        "INSERT INTO source VALUES ('three'); /* End of migration; */"
    )
    with closing(sqlite3.connect(":memory:")) as connection:
        for statement in _statements(script):
            connection.execute(statement)
        assert connection.execute("SELECT message FROM log ORDER BY rowid").fetchall() == [
            ("one;two",), ("three",),
        ]
    with pytest.raises(ValueError, match="Incomplete"):
        list(_statements("CREATE TABLE missing (value TEXT)"))
