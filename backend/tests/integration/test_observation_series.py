"""Exercise seeded observation history and the storage visibility boundary."""

import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.seed_time_series_demo import RUN_ID, seed
from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import connect


def test_seeded_series_are_queryable_and_idempotent(tmp_path):
    database = tmp_path / "pilot.sqlite3"
    assert seed(database)
    assert not seed(database)
    with closing(connect(database)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 5
        assert db.execute("SELECT count(*) FROM events").fetchone()[0] == 26
        query = """
            SELECT observed_at_s, value FROM telemetry_observations
            WHERE run_id = ? AND entity_id = ? AND metric = ?
                AND observed_at_s BETWEEN ? AND ?
            ORDER BY observed_at_s, event_id
        """
        params = (RUN_ID, "cabin-01", "co2", 600, 780)
        assert [row[0] for row in db.execute(query, params)] == [600, 660, 720, 780]
        assert db.execute(query, params).fetchall()[-1][1] == pytest.approx(2063.74, abs=0.01)
        plan = db.execute("EXPLAIN QUERY PLAN " + query, params).fetchall()
        assert any("telemetry_series_time" in row["detail"] for row in plan)
        private = db.execute(
            """SELECT crew_id, count(*) FROM health_observations
               WHERE run_id = ? GROUP BY crew_id ORDER BY crew_id""", (RUN_ID,),
        )
        assert [tuple(row) for row in private] == [(f"SIM-{i:02}", 3) for i in range(1, 5)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_private_event_cannot_enter_operational_series(tmp_path):
    database = tmp_path / "pilot.sqlite3"
    seed(database)
    repo = Repository(database)
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        with repo.write() as db:
            private_id = db.execute("SELECT event_id FROM health_observations LIMIT 1").fetchone()[0]
            db.execute(
                """INSERT INTO telemetry_observations
                   (run_id, event_id, entity_id, source_id, metric, observed_at_s,
                    received_at_s, value, unit, quality, model_version)
                   VALUES (?, ?, 'cabin-01', 'sim.cabin.co2', 'co2', 0, 0, 2000, 'ppm', 'valid', 'cabin-1')""",
                (RUN_ID, private_id),
            )
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        with repo.write() as db:
            db.execute("UPDATE health_observations SET structured_value_json = '{}'")
    with pytest.raises(sqlite3.IntegrityError, match="INTEGER"):
        with repo.write() as db:
            db.execute("UPDATE health_observations SET received_at_s = 1.5 WHERE observed_at_s = 0")
