"""SX-11A: private Crew data is absent from every actual shared output.

Markers go in through the real Crew check-in, measurement and emergency
routes of a golden cabin run, the health handoff is relayed to Ground, and
then the real Ground responses, Relay payloads, operational journal, role
traces and service diagnostics are searched for the markers and for the IDs
of every Crew-only journal record.
"""

import sqlite3
from contextlib import closing

from test_runs import local_client

GOLDEN_START = {"start_id": "privacy", "scenario_id": "sx01-golden", "scenario_version": "1", "seed": 4242}
CHECKIN_NOTE = "PRIVATE-MARKER-sx11a-checkin-text"
MOOD_ID = "private-marker-mood-01"
CHECKIN_ID = "private-marker-checkin-01"
MEASUREMENT_ID = "private-marker-measurement-01"
MEASUREMENT_SOURCE = "synthetic.watch.private-marker-sx11a"
MARKERS = (CHECKIN_NOTE, CHECKIN_ID, MOOD_ID, "mood_score", MEASUREMENT_ID, MEASUREMENT_SOURCE, "SIM-01", "SIM-02",
           "heart_rate", "bpm", "case-drill-chest-pain-v1", "drill-chest-pain-v1", "chest")


def _assert_absent(label, text, private_ids):
    for marker in (*MARKERS, *private_ids):
        assert marker not in text, f"{marker!r} leaked into {label}"


def test_private_marker_absent_from_shared_outputs(tmp_path):
    database = tmp_path / "privacy.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        as_role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        run_id = client.post("/api/v1/runs", json=GOLDEN_START, headers=as_role("facilitator")).json()["run_id"]
        runs = f"/api/v1/runs/{run_id}"

        checkin = client.post(f"{runs}/crew/check-ins", headers=as_role("crew"), json={
            "check_in_id": CHECKIN_ID, "crew_id": "SIM-01", "note": CHECKIN_NOTE, "synthetic": True})
        assert checkin.status_code == 201, checkin.text
        mood = client.post(f"{runs}/crew/check-ins", headers=as_role("crew"), json={
            "check_in_id": MOOD_ID, "crew_id": "SIM-02", "note": "", "mood_score": 4, "synthetic": True})
        assert mood.status_code == 201, mood.text
        assert client.get(f"{runs}/crew/check-ins", headers=as_role("crew")).json() == [
            {"crew_id": "SIM-02", "mission_s": 0, "mood_score": 4}
        ]
        measurement = client.post(f"{runs}/crew/measurements", headers=as_role("crew"), json={
            "measurement_id": MEASUREMENT_ID, "crew_id": "SIM-01", "synthetic": True,
            "measurement": {"metric": "heart_rate", "value": 95, "unit": "bpm", "quality": "valid",
                            "observed_at_s": 0, "source_id": MEASUREMENT_SOURCE},
            "context": {"activity": "rest"}})
        assert measurement.status_code == 201, measurement.text
        case = client.post(f"{runs}/crew/emergencies", headers=as_role("crew"), json={
            "operation_id": "op-private-case", "drill_id": "drill-chest-pain-v1",
            "reported_by": "SIM-01", "synthetic": True}).json()
        # The health handoff: Crew approves the minimal case status for Ground.
        shared = client.post(f"{runs}/crew/emergencies/{case['case_id']}/relay",
                             json={"operation_id": "op-share"}, headers=as_role("crew"))
        assert shared.status_code == 200, shared.text

        ground_reads = []
        for advance_id, step, target in (("to-06", 0, 360), ("to-13", 2, 780), ("to-15", 5, 900)):
            advanced = client.post(f"{runs}/advance", headers=as_role("facilitator"), json={
                "advance_id": advance_id, "expected_step": step, "target_mission_s": target})
            assert advanced.status_code == 200, advanced.text
            ground = client.get(f"{runs}/ground", headers=as_role("ground"))
            assert ground.status_code == 200
            ground_reads.append((f"Ground at {target} s", ground.text))
        # The handoff and the cabin trace really reached Ground, so the search is meaningful.
        assert ground.json()["health_cases"][0]["case_alias"] == shared.json()["case_alias"]
        assert {r["step"] for r in ground.json()["trace"]} >= {"incident_opened", "advice_queued"}

        # Crew can read every private record through its authorized routes.
        crew_checkin = client.get(f"{runs}/crew/check-ins/{CHECKIN_ID}", headers=as_role("crew"))
        assert crew_checkin.json()["note"] == CHECKIN_NOTE
        crew_measurement = client.get(f"{runs}/crew/measurements/{MEASUREMENT_ID}", headers=as_role("crew"))
        assert crew_measurement.json()["measurement"]["source_id"] == MEASUREMENT_SOURCE
        crew = client.get(f"{runs}/crew", headers=as_role("crew"))
        assert crew.status_code == 200
        # Ground cannot read them, and its refusals do not echo them.
        refusals = [client.get(f"{runs}/crew/check-ins/{CHECKIN_ID}", headers=as_role("ground")),
                    client.get(f"{runs}/crew/check-ins", headers=as_role("ground")),
                    client.get(f"{runs}/crew/wearables?crew_id=SIM-02", headers=as_role("ground")),
                    client.get(f"{runs}/crew/measurements/{MEASUREMENT_ID}", headers=as_role("ground")),
                    client.get(f"{runs}/crew/emergencies/{case['case_id']}", headers=as_role("ground"))]
        assert [r.status_code for r in refusals] == [403, 403, 403, 403, 403]

        diagnostics = [("readiness", client.get("/health/ready").text),
                       ("liveness", client.get("/health/live").text)]
        crew_trace = str(crew.json()["trace"])

    with closing(sqlite3.connect(database)) as db:
        private_ids = [row[0] for row in db.execute(
            "SELECT event_id FROM events WHERE run_id = ? AND visibility = 'crew'", (run_id,))]
        assert {CHECKIN_ID, MOOD_ID, MEASUREMENT_ID} <= set(private_ids)
        relay = " ".join(row[0] for row in db.execute(
            """SELECT payload_json FROM messages WHERE run_id = ?
               UNION ALL SELECT payload_json FROM snapshots WHERE run_id = ?""", (run_id, run_id)))
        operational = db.execute(
            """SELECT group_concat(event_id || ' ' || event_type || ' ' || payload_json, ' ')
               FROM events WHERE run_id = ? AND visibility = 'operational'""", (run_id,)).fetchone()[0]

    outputs = [*ground_reads, *diagnostics, ("Relay payloads", relay), ("operational journal", operational),
               ("Crew operational trace", crew_trace)]
    for label, text in outputs:
        _assert_absent(label, text, private_ids)
