import { Link, Route, Routes } from "react-router-dom";
import { FIXTURE_RUN } from "./api/fixtures.js";
import MissionConsole from "./features/mission/MissionConsole.jsx";
import RunLauncher from "./features/mission/RunLauncher.jsx";
import MeasurementPage from "./features/crew/MeasurementPage.jsx";
import EmergencyAssist from "./features/crew/EmergencyAssist.jsx";
import MedicalTimeline from "./features/crew/MedicalTimeline.jsx";
import BackupReplay from "./features/mission/BackupReplay.jsx";

// Routes choose a view. The server resolves the caller's role and decides what it may read.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RunLauncher run={FIXTURE_RUN} />} />
      <Route path="/runs/:runId/crew" element={<MissionConsole role="crew" />} />
      <Route path="/runs/:runId/crew/measure" element={<MeasurementPage />} />
      <Route path="/runs/:runId/crew/emergency" element={<EmergencyAssist />} />
      <Route path="/runs/:runId/crew/medical" element={<MedicalTimeline />} />
      <Route path="/runs/:runId/ground" element={<MissionConsole role="ground" />} />
      <Route path="/backup" element={<BackupReplay />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link className="mt-4 inline-block text-selection underline" to="/">
        Back to the run launcher
      </Link>
    </main>
  );
}
