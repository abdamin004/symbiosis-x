"""Generate and validate the deterministic 30-day synthetic Crew dataset."""

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict
from json import dumps
from pathlib import Path
from random import Random
from statistics import mean
from tempfile import TemporaryDirectory

from symbiosis_x.application.projections import latest_crew_trend
from symbiosis_x.application.runs import start_run
from symbiosis_x.contracts.commands import StartRunRequest
from symbiosis_x.crew.assessment import assess, load_rules
from symbiosis_x.crew.emergency import OpenEmergencyRequest, open_emergency
from symbiosis_x.crew.followup import compute_followup
from symbiosis_x.crew.measurements import SaveMeasurementRequest, record_measurement
from symbiosis_x.crew.profile import profile_for_crew
from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import migrate

ROOT = Path(__file__).resolve().parents[1]
DAY = 86400
SEED = 4242
CREW = ("SIM-01", "SIM-02", "SIM-03", "SIM-04")
METRICS = ("heart_rate", "blood_pressure", "glucose", "temperature", "sleep", "sleep_quality", "mood", "symptoms")
# Synthetic personal preflight anchors for the archived fixture.
BASELINES = dict(zip(CREW, (
    (72, (112, 72), 89, 36.7, 450, 4, 4, 0),
    (68, (108, 70), 87, 36.6, 440, 4, 4, 0),
    (76, (116, 74), 93, 36.8, 430, 3, 4, 0),
    (71, (110, 72), 90, 36.7, 445, 4, 4, 0),
)))
UNITS = dict(zip(METRICS, ("bpm", "mmHg", "mg/dL", "°C", "min", "score", "score", "count")))


def metric_payload(metric, baseline, random):
    match metric:
        case "heart_rate":
            return {"value": baseline + random.randint(-2, 2), "unit": "bpm"}, {"activity": "rest"}
        case "blood_pressure":
            systolic, diastolic = baseline
            return (
                {"systolic": systolic + random.randint(-1, 1), "diastolic": diastolic, "unit": "mmHg"},
                {"method": "automatic_upper_arm_cuff", "posture": "seated_rested"},
            )
        case "glucose":
            return {"value": baseline + random.randint(-1, 1), "unit": "mg/dL",
                    "method": "lab_plasma", "meal_context": "fasting"}, {}
        case "temperature":
            return {"value": round(baseline + random.uniform(-0.1, 0.1), 1),
                    "unit": "°C", "method": "assigned_device", "site": "oral"}, {}
        case "sleep":
            return {"duration_min": baseline + random.randint(-16, 16)}, {}
        case "sleep_quality" | "mood":
            scale = "sleep-quality-1-to-5-v1" if metric == "sleep_quality" else "mood-1-to-5-v1"
            return {"score": baseline, "scale_id": scale, "unit": "score"}, {}
        case "symptoms":
            return {"symptoms": ["none"]}, {}
    raise ValueError(metric)


def build_fixture():
    random = Random(SEED)
    observations = {}
    events = []
    duplicates = []

    def put(crew, day, metric, baseline):
        values, context = metric_payload(metric, baseline, random)
        time = (day - 1) * DAY + 8 * 3600 + METRICS.index(metric) * 600
        measurement_id = f"30d-{crew}-{day:02}-{metric}"
        observations[crew, day, metric] = {
            "mission_day": day, "received_at_s": time,
            "command": {"measurement_id": measurement_id, "crew_id": crew, "synthetic": True,
                        "measurement": {"metric": metric, "observed_at_s": time, "quality": "valid",
                                        "source_id": "synthetic.mission-30d-v1", **values}, "context": context},
        }

    def event(kind, crew, day, metric, days=None, **extra):
        involved_days = days or [day]
        ids = [observations[crew, item, metric]["command"]["measurement_id"] for item in involved_days] if metric else []
        events.append({"id": f"{kind}-{crew}-{day:02}", "kind": kind, "crew_id": crew,
                       "mission_day": day, "metric": metric, "measurement_ids": ids, **extra})

    for crew, baselines in BASELINES.items():
        for day in range(1, 31):
            for metric, baseline in zip(METRICS, baselines):
                put(crew, day, metric, baseline)
        for day in (2, 7, 22):
            observations[crew, day, "heart_rate"]["command"]["measurement"]["value"] = 115
            event("abnormal_reading", crew, day, "heart_rate")
        for day in (7, 16, 25):
            days = list(range(day - 3, day + 1))
            # A usefully separable drift in systolic pressure across four days.
            for offset, reading_day in enumerate(days):
                row = observations[crew, reading_day, "blood_pressure"]
                row["command"]["measurement"]["systolic"] = baselines[1][0] + 5 * offset
            event("slow_trend", crew, day, "blood_pressure", days, window_start_day=days[0])
        for day in (4, 13, 23):
            row = observations[crew, day, "temperature"]
            row["command"]["measurement"].update(value=40.5, quality="suspect")
            event("sensor_artifact", crew, day, "temperature")
        for day in (6, 15, 24):
            days = list(range(day - 2, day + 1))
            for gap_day in days:
                observations[crew, gap_day, "glucose"]["command"]["measurement"].update(value=None, quality="unavailable")
            event("missing_run", crew, day, "glucose", days)
        for day in (8, 17, 26):
            row = observations[crew, day, "sleep_quality"]
            row["received_at_s"] += 4 * 3600
            event("late_packet", crew, day, "sleep_quality")
        for day in (9, 18, 27):
            source = observations[crew, day, "mood"]
            duplicates.append({**source, "received_at_s": source["received_at_s"] + 1, "delivery": "duplicate"})
            event("duplicate_retry", crew, day, "mood")

    # Both existing emergency stories stay on their authored subjects and reporters.
    for drill, subject, reporter in (("chest-pain", "SIM-01", "SIM-01"), ("collapse", "SIM-03", "SIM-04")):
        for day in (8, 17, 26):
            event("emergency_trigger", subject, day, None, drill_id=f"drill-{drill}-v1", reported_by=reporter)

    samples = sorted((*observations.values(), *duplicates), key=lambda row: row["received_at_s"])
    sleep_records, sleep_summary = summarize_sleep(observations, random)
    fixture = {
        "schema_version": 1, "scenario_id": "mission-30d", "scenario_version": "1", "seed": SEED,
        "synthetic": True, "mission_days": 30, "indicators": METRICS,
        "profiles": [{
            "crew_id": crew, "baseline_source_id": "synthetic.mission-30d-preflight-v1",
            "baselines": {metric: {"value": baseline, "unit": UNITS[metric], "context": "Synthetic preflight record"}
                          for metric, baseline in zip(METRICS, values)},
        } for crew, values in BASELINES.items()],
        "observations": samples, "sleep_phase_summary": sleep_summary,
        "sleep_phase_archive": sleep_records,
    }
    return fixture, {"schema_version": 1, "synthetic": True, "events": events}


def summarize_sleep(observations, random):
    records = []
    summary = []
    for crew, baselines in BASELINES.items():
        for phase, days in (("preflight", range(-2, 1)), ("inflight", range(1, 31)), ("postflight", range(31, 34))):
            rows = []
            for day in days:
                if phase == "inflight":
                    duration = observations[crew, day, "sleep"]["command"]["measurement"]["duration_min"]
                    quality = observations[crew, day, "sleep_quality"]["command"]["measurement"]["score"]
                else:
                    duration = baselines[4] + random.randint(-16, 16)
                    quality = baselines[5]
                    records.append({"crew_id": crew, "phase": phase, "relative_day": day,
                                    "duration_min": duration, "quality_score": quality,
                                    "source_id": "synthetic.mission-30d-sleep-archive-v1"})
                rows.append((duration, quality))
            summary.append({
                "crew_id": crew, "phase": phase,
                "mean_duration_min": round(mean(row[0] for row in rows), 1),
                "mean_quality_score": round(mean(row[1] for row in rows), 1),
                "duration_samples": len(rows), "quality_samples": len(rows),
            })
    return records, summary


def set_clock(db, run_id, time):
    # The offline harness replays arrival timestamps on a disposable run.
    db.execute("UPDATE runs SET mission_s = ? WHERE run_id = ?", (time, run_id))


def outside(result):
    return any(item.status.startswith("outside_") for item in (result.personal, result.reference))


def validate(fixture, expected):
    with TemporaryDirectory(prefix="sx-mission-30d-") as folder:
        database = Path(folder) / "validation.sqlite3"
        migrate(database)
        repository = Repository(database)
        run_id = start_run(repository, StartRunRequest(
            start_id="mission-30d-validation", scenario_id="nominal", scenario_version="1", seed=SEED,
        )).run_id
        profiles = {crew: profile_for_crew(crew) for crew in CREW}
        captured, duplicate_results, early_absence = {}, {}, {}
        rules = load_rules()
        clean_alerts = set()
        excluded_days = set()
        for event in expected["events"]:
            first = event.get("window_start_day", event["mission_day"])
            # A four-day rolling comparison still contains the injected drift after its last sample.
            last = event["mission_day"] + (4 if event["kind"] == "slow_trend" else 0)
            excluded_days.update((event["crew_id"], day) for day in range(first, last + 1))
        missing_as_normal = 0
        with repository.write() as db:
            for sample in fixture["observations"]:
                now = sample["received_at_s"]
                set_clock(db, run_id, now)
                command = SaveMeasurementRequest.model_validate(sample["command"])
                metric, crew, identity = command.measurement.metric, command.crew_id, command.measurement_id
                if sample.get("delivery") == "duplicate":
                    prior = captured[identity]["receipt"]
                    retry = record_measurement(db, run_id, command, received_at_s=now)
                    rows = db.execute("SELECT COUNT(*) FROM health_observations WHERE run_id = ? AND event_id = ?",
                                      (run_id, identity)).fetchone()[0]
                    duplicate_results[identity] = (retry == prior and rows == 1)
                    continue
                if now > command.measurement.observed_at_s:
                    count = db.execute(
                        "SELECT COUNT(*) FROM health_observations WHERE run_id = ? AND event_id = ?",
                        (run_id, identity),
                    ).fetchone()[0]
                    early_absence[identity] = count == 0
                receipt = record_measurement(db, run_id, command, received_at_s=now)
                assessed = assess(receipt.measurement.model_dump(), context=receipt.context, profile=profiles[crew], rules=rules)
                trend = latest_crew_trend(db, run_id, crew, metric)
                followup = compute_followup(db, run_id, crew, now, asdict(assessed))
                reminder = next((item for item in followup["reminders"] if item["metric"] == metric), None)
                captured[identity] = {"receipt": receipt, "assessment": assessed, "trend": trend, "reminder": reminder}
                if command.measurement.quality == "unavailable":
                    missing_as_normal += (
                        assessed.personal.status != "unknown" or assessed.reference.status != "unknown"
                        or bool(assessed.evidence.keys() & {"value", "systolic", "score", "duration_min", "symptoms"})
                    )
                key = (crew, sample["mission_day"])
                if key not in excluded_days and (outside(assessed) or (trend and trend["status"] == "review")):
                    clean_alerts.add(key)

        def detected(event):
            kind = event["kind"]
            if kind == "emergency_trigger":
                drill_id = event["drill_id"]
                emergency_run = start_run(repository, StartRunRequest(
                    start_id=event["id"], scenario_id="nominal", scenario_version="1", seed=SEED,
                )).run_id
                time = event["mission_day"] * DAY
                with repository.write() as connection:
                    set_clock(connection, emergency_run, time)
                case, opened = open_emergency(repository, emergency_run, OpenEmergencyRequest(
                    operation_id=event["id"], drill_id=drill_id, reported_by=event["reported_by"], synthetic=True,
                ))
                with repository.read() as connection:
                    followup = compute_followup(connection, emergency_run, case.subject_crew_id, time, None)
                return opened and case.opened_at_s == time and case.status == "open" and followup["precedence"] == "emergency"

            identity = event["measurement_ids"][-1]
            reading = captured[identity]
            result = reading["assessment"]
            reminder = reading["reminder"]
            match kind:
                case "abnormal_reading":
                    return outside(result) and reminder["action"] in ("review_with_designated_role", "routine_check")
                case "slow_trend":
                    trend = reading["trend"]
                    return trend["status"] == "review" and trend["direction"] == "rising" and trend["reason_code"] == "DAILY_TREND"
                case "sensor_artifact":
                    return result.personal.reason_code == "QUALITY_REJECTED" and reminder["action"] == "repeat_measurement"
                case "missing_run":
                    return (all(captured[item]["assessment"].reference.status == "unknown" for item in event["measurement_ids"])
                            and reminder["status"] == "overdue")
                case "late_packet":
                    receipt = reading["receipt"]
                    return early_absence[identity] and receipt.received_at_s - receipt.measurement.observed_at_s == 4 * 3600
                case "duplicate_retry":
                    return duplicate_results[identity]
            raise ValueError(kind)

        counts = defaultdict(Counter)
        for event in expected["events"]:
            counts[event["kind"]]["total"] += 1
            counts[event["kind"]]["detected"] += bool(detected(event))
        return counts, len(clean_alerts), len(CREW) * 30 - len(excluded_days), missing_as_normal


def render_report(results):
    counts, false_alerts, clean_days, missing = results
    total = sum(row["total"] for row in counts.values())
    detected = sum(row["detected"] for row in counts.values())
    rows = ["# Thirty-day synthetic mission validation", "",
            f"**{detected} of {total} authored events recognized by the replay checks.**", "",
            "Seed 4242. Four fictional crew members, 30 mission days and eight scheduled indicators. "
            "The run has 960 observation slots and 12 retry deliveries. Evidence stays inside an isolated SQLite run.", "",
            "| Event type | Recognized | Authored |", "| --- | ---: | ---: |"]
    rows.extend(f"| {kind.replace('_', ' ').capitalize()} | {row['detected']} | {row['total']} |"
                for kind, row in sorted(counts.items()))
    rows.extend(["", f"False review alerts on clean crew-days — {false_alerts} of {clean_days}.",
                 f"Missing data shown as normal — {missing}.", "",
                 "The harness replays arrival timestamps, persists observations through Crew measurement code and "
                 "checks the assessment, trend, and reminder at each receipt. A missing run contains three explicit "
                 "unavailable results. A retry must return the original receipt and leave one row in the ledger. "
                 "Emergency checks use independent runs to exercise each case's existing single-open contract.",
                 "",
                 "Daily drift uses one comparable observation per day over a four-day window. Each metric has a "
                 "synthetic demo threshold. Blood pressure drift uses systolic pressure with matching method and "
                 "posture. Symptom drift counts distinct reported labels without revealing private notes. Clean crew-days "
                 "exclude authored event days and days whose four-day trend window contains injected drift. "
                 "The reference comparisons in individual assessments retain their sourced Earth-based scope.",
                 "",
                 "These results measure behavior on a seeded fixture of authored cases. The data and rules are for "
                 "training simulation.", "",
                 "Regenerate and check the committed artifacts with `PYTHONPATH=backend/src python scripts/generate_mission_dataset.py --check`.",
                 ""])
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare regenerated outputs with checked-in artifacts")
    args = parser.parse_args()
    fixture, events = build_fixture()
    outputs = {
        "scenarios/mission-30d-v1.json": dumps(fixture, indent=2, ensure_ascii=False) + "\n",
        "scenarios/expected/mission-30d-events.json": dumps(events, indent=2) + "\n",
        "docs/validation-report.md": render_report(validate(fixture, events)),
    }
    for name, content in outputs.items():
        target = ROOT / name
        if args.check:
            if not target.exists() or target.read_text(encoding="utf-8") != content:
                raise SystemExit(f"Regenerate {name} with scripts/generate_mission_dataset.py")
        else:
            target.write_text(content, encoding="utf-8")
    print(outputs["docs/validation-report.md"])


if __name__ == "__main__":
    main()
