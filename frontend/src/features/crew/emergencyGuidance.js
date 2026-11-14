// Shared by the Crew console and the generated Flight canvas.
export function resolveEmergencyGuidance(procedure, answers) {
  if (!procedure?.guidance) return [];
  const {responsive, breathing, pain_ongoing: painOngoing} = answers;
  const guide = procedure.guidance;
  if (!responsive || responsive === "unknown" || !breathing || breathing === "unknown") return guide.check ?? [];
  if (responsive === "no" && breathing === "no") return guide.unresponsive_not_breathing ?? [];
  if (responsive === "no" && breathing === "yes") return guide.unresponsive_breathing ?? [];
  if (breathing === "no") return guide.breathing_concern ?? [];
  if (!guide.chest_pain_ongoing) return guide.responsive ?? [];
  if (!painOngoing || painOngoing === "unknown") return guide.check ?? [];
  return painOngoing === "yes" ? guide.chest_pain_ongoing : guide.chest_pain_resolved;
}

export function emergencyAssessment(drill, answers) {
  const fields = {};
  if (drill.kind === "collapse" || answers.responsive) {
    fields.responsiveness = {yes:"responsive", no:"unresponsive"}[answers.responsive] ?? "unknown";
  }
  if (answers.breathing || answers.responsive || answers.pain_ongoing) {
    fields.breathing = {yes:"normal", no:"abnormal"}[answers.breathing] ?? "unknown";
  }
  if (drill.kind === "chest_pain" && answers.pain_ongoing) fields.pain_ongoing = answers.pain_ongoing;
  return fields;
}
