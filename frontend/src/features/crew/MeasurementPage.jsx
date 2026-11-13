
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import metricsCatalog from "@catalogs/crew/health-metrics.json";
import guidesCatalog from "@catalogs/crew/health-guides.json";
import MetricGuide from "./MetricGuide.jsx";

const metrics = metricsCatalog.metrics;

function fieldsFor(metric) {
  if (metric.id === "blood_pressure") {
    return ["systolic", "diastolic"];
  }
  if (metric.id === "glucose") {
    return ["value", "method", "meal_context"];
  }
  if (metric.id === "temperature") {
    return ["value", "method", "site"];
  }
  if (metric.id === "sleep") {
    return ["duration_min"];
  }
  if (metric.id === "mood") {
    return ["value"];
  }
  if (metric.id === "symptoms") {
    return ["symptoms", "private_text"];
  }
  return ["value"];
}

export default function MeasurementPage() {
  const { runId } = useParams();
  const [selectedId, setSelectedId] = useState(metrics[0].id);
  const [values, setValues] = useState({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);

  const metric = metrics.find((item) => item.id === selectedId);
  const guide = guidesCatalog.guides.find(
    (item) => item.metric_id === selectedId
  );

  function selectMetric(id) {
    setSelectedId(id);
    setValues({});
    setError("");
    setSaved(null);
  }

  function updateValue(name, value) {
    setValues((previous) => ({ ...previous, [name]: value }));
    setError("");
    setSaved(null);
  }

  function submit(event) {
    event.preventDefault();

    const fields = fieldsFor(metric).filter(
      (field) => field !== "private_text"
    );

    if (fields.some((field) => !String(values[field] ?? "").trim())) {
      setError("Please complete all required fields.");
      return;
    }

    const numericFields = fields.filter(
      (field) =>
        !["method", "meal_context", "site", "symptoms"].includes(field)
    );

    if (numericFields.some((field) => {
      const number = Number(values[field]);
      return !Number.isFinite(number) || number < 0;
    })) {
      setError("Please enter valid nonnegative numbers.");
      return;
    }

    if (metric.id === "mood") {
      const score = Number(values.value);
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        setError("Mood must be a whole number from 1 to 5.");
        return;
      }
    }

    if (metric.id === "blood_pressure") {
      if (
        Number(values.systolic) <= 0 ||
        Number(values.diastolic) <= 0
      ) {
        setError("Both blood pressure values must be positive.");
        return;
      }
    }

    setSaved({ metricId: metric.id, values: { ...values } });
    setError("");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link
        to={`/runs/${encodeURIComponent(runId)}/crew`}
        className="text-sm underline"
      >
        Back to Crew console
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">
        Take Measurement
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Synthetic training data only. No backend submission yet.
      </p>

      <section aria-label="Choose a metric" className="mt-6">
        <h2 className="font-semibold">Select an indicator</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {metrics.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selectedId === item.id}
              onClick={() => selectMetric(item.id)}
              className={`rounded border px-3 py-2 ${
                selectedId === item.id
                  ? "border-blue-700 bg-blue-50"
                  : "border-slate-300 bg-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="text-xl font-semibold">{metric.label}</h2>
          <form onSubmit={submit} noValidate className="mt-4">
            {fieldsFor(metric).map((field) => {
              const isText = [
                "method", "meal_context", "site",
                "symptoms", "private_text"
              ].includes(field);

              return (
                <div key={field} className="mb-4">
                  <label
                    htmlFor={`measurement-${field}`}
                    className="mb-1 block font-medium"
                  >
                    {field.replaceAll("_", " ")}
                    {field !== "private_text" && " *"}
                  </label>

                  <div className="flex items-center gap-2">
                    <input
                      id={`measurement-${field}`}
                      type={isText ? "text" : "number"}
                      step={metric.id === "mood" ? "1" : "any"}
                      value={values[field] ?? ""}
                      onChange={(event) =>
                        updateValue(field, event.target.value)
                      }
                      aria-invalid={Boolean(error)}
                      className="w-full rounded border border-slate-300 p-2"
                    />
                    {!isText && (
                      <span className="text-sm text-slate-600">
                        {field === "duration_min"
                          ? "min"
                          : metric.unit ?? ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {error && (
              <p role="alert" className="mb-3 text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="rounded bg-blue-700 px-4 py-2 text-white"
            >
              Record synthetic measurement
            </button>
          </form>

          {saved && (
            <p role="status" className="mt-4 text-green-700">
              Synthetic {metric.label} entry recorded locally.
              Not sent to the server.
            </p>
          )}
        </section>

        <MetricGuide guide={guide} />
      </div>
    </main>
  );
}
