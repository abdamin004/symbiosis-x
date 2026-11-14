// The Flight panel uses the same questions and guidance as the Crew console.
function bindFlightEmergency({host, drills, getRunId, crewNames, session, clock}) {
  const find = id => host.querySelector("[data-emergency=" + id + "]");
  const picker = find("drill");
  const controls = find("questions");
  const steps = find("guidance");
  const source = find("source");
  const alert = find("alert");
  const acknowledge = find("acknowledge");
  const status = find("status");
  let caseData;
  let pending = false;
  let operationId;

  for (const drill of drills) {
    picker.add(new Option(drill.title, drill.drill_id));
  }

  function activeDrill() {
    return drills.find(drill => drill.drill_id === picker.value);
  }

  function assessments() {
    return Object.fromEntries([...controls.querySelectorAll("select")].map(control => [control.name,control.value]));
  }

  function guidance() {
    const procedure = caseData?.procedure?.questions?.length ? caseData.procedure : activeDrill().procedure;
    steps.replaceChildren(...resolveEmergencyGuidance(procedure,assessments()).map(step => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }));
    source.replaceChildren(...procedure.sources.map(item => {
      const link = document.createElement("a");
      link.href = item.url;
      link.textContent = item.title;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }));
  }

  function reset() {
    caseData = null;
    operationId = undefined;
    const procedure = activeDrill().procedure;
    controls.replaceChildren(...procedure.questions.map(question => {
      const label = document.createElement("label");
      label.append(question.label);
      const field = document.createElement("select");
      field.name = question.id;
      for (const [id,title] of [["unknown","Unknown"],["yes","Yes"],["no","No"]]) field.add(new Option(title,id));
      label.append(field);
      return label;
    }));
    guidance();
    display();
  }

  function display() {
    const acknowledgment = caseData?.acknowledgment;
    const responder = caseData && (crewNames[caseData.owner] ?? caseData.owner);
    status.textContent = caseData ? "Opened T+" + clock(caseData.opened_at_s) + " · Responder " + responder +
      (acknowledgment ? " · Acknowledged T+" + clock(acknowledgment.acknowledged_at_s) : " · Local alert raised") : "";
    alert.disabled = pending || Boolean(caseData) || !getRunId();
    acknowledge.hidden = !caseData || Boolean(acknowledgment);
    acknowledge.disabled = pending;
    picker.disabled = pending;
    for (const control of controls.querySelectorAll("select")) control.disabled = pending || Boolean(caseData?.assessment);
  }

  async function post(path, body) {
    const run = getRunId();
    if (!run || pending) return;
    pending = true;
    find("error").textContent = "";
    display();
    try {
      const {crew} = await session();
      const response = await fetch("/api/v1/runs/" + encodeURIComponent(run) + "/crew/emergencies" + path, {
        method:"POST", cache:"no-store",
        headers:{"Content-Type":"application/json", Authorization:"Bearer " + crew},
        body:JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Drill action failed");
      const next = await response.json();
      if (next.run_id !== run || next.drill_id !== picker.value || getRunId() !== run) {
        throw new Error("Drill response mismatch");
      }
      caseData = next;
      if (next.assessment) {
        for (const control of controls.querySelectorAll("select")) control.value = next.assessment[control.name] ?? "unknown";
      }
      guidance();
    } catch {
      find("error").textContent = "Could not complete this local drill action. Try again.";
    } finally {
      pending = false;
      display();
    }
  }

  picker.addEventListener("change",reset);
  controls.addEventListener("change",() => {
    if (!pending && !caseData) operationId = undefined;
    guidance();
  });
  alert.addEventListener("click",() => {
    const drill = activeDrill();
    operationId ??= "flight-emergency-" + crypto.randomUUID();
    const answers = Object.fromEntries(Object.entries(assessments()).filter(([,value]) => value !== "unknown"));
    const body = {operation_id:operationId, drill_id:drill.drill_id, reported_by:drill.reported_by,
      synthetic:true, ...emergencyAssessment(drill,answers)};
    post("",body);
  });
  acknowledge.addEventListener("click",() => {
    if (caseData) post("/" + encodeURIComponent(caseData.case_id) + "/acknowledgment",{acknowledged_by:caseData.owner});
  });

  return {
    show() {
      if (!getRunId() || host.open) return;
      reset();
      host.showModal();
    },
  };
}
