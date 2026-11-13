// Campaign slots use the existing browser-local Flight store. The Asteria key predates the menu.
function createFlightSaves() {
  const session = new Map();
  const key = mission => "sx:" + mission.id + ":v" + mission.version;

  function read(mission) {
    const slot = key(mission);
    if (session.has(slot)) return session.get(slot);
    try {
      const saved = JSON.parse(localStorage.getItem(slot));
      return saved && Number.isInteger(saved.time) && saved.time >= 0 &&
        saved.jobs && typeof saved.jobs === "object" && !Array.isArray(saved.jobs) ? saved : null;
    } catch {
      return null;
    }
  }

  function write(mission, state) {
    const slot = key(mission);
    try {
      localStorage.setItem(slot, JSON.stringify(state));
      session.delete(slot);
      return true;
    } catch {
      session.set(slot, JSON.parse(JSON.stringify(state)));
      return false;
    }
  }

  return {read,write};
}

function bindFlightMenu(missions, crew, replayVersion, {select,launch,replay}) {
  const find = id => document.getElementById(id);
  const choices = find("campaign-choices");
  const radioGroup = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Playable missions";
  radioGroup.append(legend);
  for (const mission of missions) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    const name = document.createElement("span");
    radio.type = "radio";
    radio.name = "campaign";
    radio.value = mission.id;
    name.textContent = mission.title;
    radio.addEventListener("change",()=>select(mission));
    label.append(radio,name);
    radioGroup.append(label);
  }
  choices.append(radioGroup);

  const crewNames = crew.map(person=>person.name + " · " + person.role);
  function list(container, values) {
    container.replaceChildren(...values.map(text=>{
      const row = document.createElement("li");
      row.textContent = text;
      return row;
    }));
  }

  function setBriefing(mission) {
    find("briefing-title").textContent = mission ? mission.title + " briefing" : "ISS Research Replay briefing";
    find("briefing-intro").textContent = mission?.objective ??
      "Review the scripted ISS journey and the synthetic crew and cabin data at each checkpoint.";
    find("briefing-vehicle").textContent = mission?.vehicle ?? "Outbound and return capsules";
    find("briefing-version").textContent = mission ? "Version " + mission.version + " · Seed " + mission.seed
      : "Replay · Version " + replayVersion;
    find("briefing-duration").textContent = mission?.pacing ?? "Self-paced · scrub or play";
    list(find("briefing-crew"),crewNames);
    list(find("briefing-steps"),mission?.briefing ?? ["Use the timeline to compare cabin readings, crew activity, station transfer and Earth recovery."]);
  }

  function render(mission, save, phase) {
    choices.querySelector("input[value='" + mission.id + "']").checked = true;
    find("campaign-objective").textContent = mission.objective;
    find("campaign-ship").textContent = mission.vehicle;
    find("campaign-pacing").textContent = mission.pacing;
    find("campaign-version").textContent = "Version " + mission.version;
    find("campaign-crew").textContent = crew.map(person=>person.name).join(", ");
    find("campaign-save").textContent = save ? phase + " · T+" + stamp(save.time) : "Available · no saved run";
    find("resume-campaign").hidden = !save;
  }

  function stamp(seconds) {
    return Math.floor(seconds/60) + ":" + String(seconds%60).padStart(2,"0");
  }

  find("resume-campaign").addEventListener("click",()=>launch(false));
  find("new-campaign").addEventListener("click",()=>launch(true));
  find("open-flight-replay").addEventListener("click",replay);
  return {render,setBriefing};
}
