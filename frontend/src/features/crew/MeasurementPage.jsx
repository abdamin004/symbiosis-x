import { useMemo, useRef, useState } from "react";
import { createOperationId, saveCrewMeasurement } from "../../api/client.js";
import { Link, useParams } from "react-router-dom";
import { HEALTH_GUIDE_DISCLAIMER, HEALTH_GUIDES, HEALTH_METRICS } from "../../api/healthCatalog.js";
import MetricGuide from "./MetricGuide.jsx";

const EMPTY = {
  observed_at_s: "0", source_id: "synthetic.manual.sim-01", quality: "valid",
  value: "", systolic: "", diastolic: "", method: "assigned_device",
  meal_context: "fasting", site: "oral", duration_min: "",
  start_mission_s: "", end_mission_s: "", score: "3", symptoms: "", private_text: "",
};

function Field({ id, label, children, hint }) {
  return <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}{children}{hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}</label>;
}
function Input({ id, value, onChange, type = "text", min, max, step = "any" }) {
  return <input id={id} value={value} type={type} min={min} max={max} step={step}
    onChange={(event) => onChange(event.target.value)}
    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-selection focus:outline-2 focus:outline-selection" />;
}
const Select = ({ id, value, onChange, children }) => <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2">{children}</select>;

export function buildMeasurement(metric, values) {
  const common = { observed_at_s: Number(values.observed_at_s), source_id: values.source_id.trim(), quality: values.quality };
  const number = (value) => value.trim() === "" ? null : Number(value);
  switch (metric) {
    case "heart_rate": return { ...common, metric, value: number(values.value), unit: "bpm" };
    case "blood_pressure": return { ...common, metric, systolic: number(values.systolic), diastolic: number(values.diastolic), unit: "mmHg" };
    case "glucose": return { ...common, metric, value: number(values.value), unit: "mg/dL", method: values.method, meal_context: values.meal_context };
    case "temperature": return { ...common, metric, value: number(values.value), unit: "°C", method: values.method, site: values.site };
    case "sleep": return values.duration_min.trim() !== "" ? { ...common, metric, duration_min: Number(values.duration_min) } : { ...common, metric, start_mission_s: Number(values.start_mission_s), end_mission_s: Number(values.end_mission_s) };
    case "mood": return { ...common, metric, score: Number(values.score), scale_id: "mood-1-to-5-v1", unit: "score" };
    case "symptoms": return { ...common, metric, symptoms: values.symptoms.split(",").map((x) => x.trim()).filter(Boolean), private_text: values.private_text.trim() || null };
    default: throw new Error("UNKNOWN_METRIC");
  }
}
function validate(metric, m) {
  if (!Number.isInteger(m.observed_at_s) || m.observed_at_s < 0) return "Mission time must be a non-negative whole number.";
  if (!m.source_id) return "Source ID is required.";
  if (metric === "blood_pressure" && (!(m.systolic > 0) || !(m.diastolic > 0))) return "Enter both blood pressure values greater than zero.";
  if (metric === "sleep" && ("duration_min" in m ? !Number.isInteger(m.duration_min) || m.duration_min < 0 : !Number.isInteger(m.start_mission_s) || !Number.isInteger(m.end_mission_s) || m.start_mission_s < 0 || m.end_mission_s <= m.start_mission_s)) return "Enter a valid sleep duration or a start/end interval.";
  if (metric === "mood" && (!Number.isInteger(m.score) || m.score < 1 || m.score > 5)) return "Mood score must be between 1 and 5.";
  if (metric === "symptoms" && !m.symptoms.length) return "Enter at least one symptom.";
  if (!["blood_pressure", "sleep", "mood", "symptoms"].includes(metric) && (!Number.isFinite(m.value) || m.value < 0)) return "Enter a valid non-negative measurement.";
  return "";
}

export default function MeasurementPage() {
  const { runId } = useParams();
  const [metric, setMetric] = useState("heart_rate");
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const measurementId = useRef(null);
  const guide = useMemo(() => HEALTH_GUIDES.get(metric), [metric]);
  const selected = HEALTH_METRICS.find((item) => item.id === metric);
  const update = (key) => (value) => setValues((old) => ({ ...old, [key]: value }));
  function changeMetric(value) { setMetric(value); setValues(EMPTY); setError(""); setPreview(null); setSaved(null); setSaveError(""); measurementId.current = null; }
  function submit(event) {
    event.preventDefault();
    const measurement = buildMeasurement(metric, values);
    const message = validate(metric, measurement);
    setError(message);
    setPreview(message ? null : measurement);
    setSaved(null);
    setSaveError("");
  }
  async function saveMeasurement() {
    if (!preview) return;
    setSaving(true);
    setSaveError("");
    if (!measurementId.current) measurementId.current = createOperationId("measurement");
    const context = metric === "heart_rate" ? { activity: values.activity } : {};
    try {
      const receipt = await saveCrewMeasurement(runId, { measurement_id: measurementId.current, crew_id: "SIM-01", synthetic: true, measurement: preview, context });
      setSaved(receipt);
      measurementId.current = null;
    } catch (e) { setSaveError(e.message); }
    finally { setSaving(false); }
  }
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" data-testid="measurement-page">
      <header className="border-b border-slate-200 pb-4">
        <Link className="text-sm text-slate-500 underline" to={`/runs/${encodeURIComponent(runId)}/crew`}>Back to Crew Health</Link>
        <h1 className="mt-2 text-2xl font-semibold">Take a measurement</h1>
        <p className="mt-1 text-sm text-slate-600">Run {runId} · Synthetic training data only · Private Crew entry</p>
      </header>
      <p className="mt-4 text-sm text-slate-600">{HEALTH_GUIDE_DISCLAIMER}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <Field id="metric-picker" label="Indicator">
            <Select id="metric-picker" value={metric} onChange={changeMetric}>{HEALTH_METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
          </Field>
          <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="observed_at_s" label="Observed at (mission seconds)"><Input id="observed_at_s" type="number" min="0" step="1" value={values.observed_at_s} onChange={update("observed_at_s")} /></Field>
              <Field id="source_id" label="Source ID"><Input id="source_id" value={values.source_id} onChange={update("source_id")} /></Field>
            </div>
            {metric === "blood_pressure" ? <div className="grid grid-cols-2 gap-3">
              <Field id="systolic" label="Systolic (mmHg)"><Input id="systolic" type="number" min="1" value={values.systolic} onChange={update("systolic")} /></Field>
              <Field id="diastolic" label="Diastolic (mmHg)"><Input id="diastolic" type="number" min="1" value={values.diastolic} onChange={update("diastolic")} /></Field>
            </div> : null}
            {["heart_rate", "glucose", "temperature"].includes(metric) ? <Field id="value" label={`Value (${selected.unit})`}><Input id="value" type="number" min="0" value={values.value} onChange={update("value")} /></Field> : null}
            {metric === "heart_rate" ? <Field id="activity" label="Activity context"><Select id="activity" value={values.activity ?? "rest"} onChange={update("activity")}><option value="rest">Rest</option><option value="exercise">Exercise</option><option value="recovery">Recovery</option></Select></Field> : null}
            {metric === "glucose" ? <>
              <Field id="method" label="Method"><Select id="method" value={values.method} onChange={update("method")}><option value="assigned_device">Assigned device</option><option value="laboratory">Laboratory</option></Select></Field>
              <Field id="meal_context" label="Meal context"><Select id="meal_context" value={values.meal_context} onChange={update("meal_context")}><option value="fasting">Fasting</option><option value="before_meal">Before meal</option><option value="after_meal">After meal</option></Select></Field>
            </> : null}
            {metric === "temperature" ? <>
              <Field id="method" label="Method"><Select id="method" value={values.method} onChange={update("method")}><option value="assigned_device">Assigned device</option><option value="manual">Manual</option></Select></Field>
              <Field id="site" label="Measurement site"><Select id="site" value={values.site} onChange={update("site")}><option value="oral">Oral</option><option value="ear">Ear</option><option value="forehead">Forehead</option><option value="armpit">Armpit</option></Select></Field>
            </> : null}
            {metric === "sleep" ? <>
              <Field id="duration_min" label="Duration (minutes)" hint="Alternatively enter both mission-time fields."><Input id="duration_min" type="number" min="0" step="1" value={values.duration_min} onChange={update("duration_min")} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="start_mission_s" label="Start (seconds)"><Input id="start_mission_s" type="number" min="0" step="1" value={values.start_mission_s} onChange={update("start_mission_s")} /></Field>
                <Field id="end_mission_s" label="End (seconds)"><Input id="end_mission_s" type="number" min="0" step="1" value={values.end_mission_s} onChange={update("end_mission_s")} /></Field>
              </div>
            </> : null}
            {metric === "mood" ? <Field id="score" label="Mood score (1–5)"><Input id="score" type="number" min="1" max="5" step="1" value={values.score} onChange={update("score")} /></Field> : null}
            {metric === "symptoms" ? <>
              <Field id="symptoms" label="Symptoms (comma separated)"><Input id="symptoms" value={values.symptoms} onChange={update("symptoms")} /></Field>
              <Field id="private_text" label="Private note (optional)"><textarea id="private_text" value={values.private_text} onChange={(event) => update("private_text")(event.target.value)} rows="3" className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></Field>
            </> : null}
            <Field id="quality" label="Reading quality"><Select id="quality" value={values.quality} onChange={update("quality")}><option value="valid">Valid</option><option value="suspect">Suspect</option><option value="unavailable">Unavailable</option></Select></Field>
            {error && <p role="alert" data-testid="measurement-error" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <button className="rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white" type="submit">Validate measurement</button>
          </form>
          {preview && <section role="status" data-testid="measurement-preview" className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <h2 className="font-semibold">Measurement validated · local preview</h2>
            <p className="mt-1 text-xs">Validated against the project metric shape. Save sends this synthetic reading to the private Crew API.</p>
            <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(preview, null, 2)}</pre>
            <button type="button" onClick={saveMeasurement} disabled={saving} className="mt-3 rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save to private Crew record"}</button>
          </section>}
          {saveError && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
          {saved && <p role="status" data-testid="measurement-saved" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Saved privately for {saved.crew_id} at mission time {saved.received_at_s}s.</p>}
        </section>
        <MetricGuide guide={guide} />
      </div>
    </main>
  );
}
