import { createElement } from "react";
import { createRoot } from "react-dom/client";
import archivedSeries from "@contracts/examples/radlab-instrument-series.json";
import RadiationContext from "../../src/features/crew/RadiationContext.jsx";

const fixture = {
  ...archivedSeries,
  row_count: 3,
  missing_value_count: 1,
  coverage_utc: {
    start: archivedSeries.points[0].timestamp_utc,
    end: archivedSeries.points[2].timestamp_utc,
  },
  points: [
    archivedSeries.points[0],
    { timestamp_utc: "2022-04-01T00:00:05Z", value: null },
    archivedSeries.points[2],
  ],
};

createRoot(document.getElementById("test-root")).render(
  createElement(RadiationContext, { series: fixture }),
);
