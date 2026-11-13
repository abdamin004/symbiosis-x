import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import GroundHealthStatus from "../../src/features/ground/GroundHealthStatus.jsx";

// Shape of GET /api/v1/runs/{id}/ground → health_cases after the 05:00 delivery (SX-25C test).
const DELIVERED = {
  case_alias: "health-case-3f2a9c1b7e",
  review_priority: "urgent",
  status: "open",
  delivered_at_s: 300,
  ground_ack: "pending",
  ground_acknowledged_at_s: null,
};

function Fixture() {
  const [cases, setCases] = useState([DELIVERED]);
  const acknowledge = (alias) =>
    setCases((current) =>
      current.map((item) =>
        item.case_alias === alias ? { ...item, ground_ack: "acknowledged", ground_acknowledged_at_s: 360 } : item,
      ),
    );
  return createElement(GroundHealthStatus, { cases, onAcknowledge: acknowledge });
}

createRoot(document.getElementById("test-root")).render(createElement(Fixture));
