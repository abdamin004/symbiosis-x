import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { CREW_HEALTH_UNKNOWN_FIXTURE } from "../../src/api/crewHealthFixture.js";
import CrewHealthPanel from "../../src/features/crew/CrewHealthPanel.jsx";

createRoot(document.getElementById("test-root")).render(
  createElement(CrewHealthPanel, { health: CREW_HEALTH_UNKNOWN_FIXTURE, cabin: null }),
);
