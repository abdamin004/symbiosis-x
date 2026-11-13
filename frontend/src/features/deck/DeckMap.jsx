import { useState } from "react";

const SHIP_DECK_SVG = String.raw`<svg id="ship-map" viewBox="0 0 800 405" aria-labelledby="ship-title ship-desc">
<title id="ship-title">SYMBIOSIS X spacecraft schematic</title><desc id="ship-desc">A selectable plan view showing four simulated crew, the life-support rack, power bus, medical kit, communications, habitat, stores, command and three software agent roles.</desc>
<defs><pattern id="deck-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#1e3746" stroke-width="1"/></pattern><pattern id="solar-grid" width="18" height="16" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="16" height="14" rx="1" fill="#203d57" stroke="#4d7195" stroke-width=".7"/></pattern><linearGradient id="shell" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#284956"/><stop offset="1" stop-color="#172b38"/></linearGradient><symbol id="person" viewBox="0 0 30 30"><circle cx="15" cy="10" r="4.2" fill="currentColor"/><path d="M7.8 23c.3-4.4 3-7 7.2-7s6.9 2.6 7.2 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></symbol></defs>
<rect width="800" height="405" fill="#0b1923"/><rect width="800" height="405" fill="url(#deck-grid)" opacity=".57"/>
<g class="svg-fine" opacity=".9"><path d="M22 40h34m-17-17v34M744 40h34m-17-17v34M22 352h34m-17-17v34" stroke="#426173"/><text x="52" y="29">AFT</text><text x="708" y="29">FORE</text><text x="40" y="345">DECK PLAN</text></g>
<g aria-hidden="true"><path d="M207 82v37m0 194v24M506 82v36m0 197v22" stroke="#567990" stroke-width="8"/><rect x="122" y="49" width="172" height="34" rx="4" fill="url(#solar-grid)" stroke="#607d99"/><rect x="420" y="49" width="172" height="34" rx="4" fill="url(#solar-grid)" stroke="#607d99"/><path d="M54 174h47v106H54l-13-18v-69z" fill="#162c3c" stroke="#62869b" stroke-width="2"/><path d="M45 198h29m-29 14h29m-29 14h29m-29 14h29m-29 14h29" stroke="#3c5b6d" stroke-width="2"/><path d="M100 150l38-38h482c64 0 116 40 143 111-27 71-79 111-143 111H138l-38-38z" fill="url(#shell)" stroke="#92adbb" stroke-width="2.4"/><path d="M111 157l32-33h479c55 0 106 39 128 99-22 60-73 99-128 99H143l-32-33z" fill="#10212c" stroke="#536e79"/><path d="M121 207h568l27 16-27 16H121z" fill="#2b4650" stroke="#78979d" stroke-dasharray="4 5"/><path d="M116 220h588" stroke="#93c4bc" opacity=".4"/></g>
<g class="map-item" data-pick="scrubber" role="button" tabindex="0" aria-label="Inspect life support and scrubber" aria-pressed="false"><rect class="module" x="135" y="136" width="174" height="64" rx="5"/><text x="149" y="156" class="svg-label">01 / LIFE SUPPORT</text><circle cx="168" cy="178" r="12" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M168 169q12 0 4 9 5 10-6 7-9-5 2-9z" fill="currentColor"/><text x="190" y="183" class="svg-fine">CO₂ SCRUBBER</text><circle id="scrubber-led" cx="292" cy="151" r="4" fill="#83e7bf"/></g>
<g class="map-item" data-pick="medical" role="button" tabindex="0" aria-label="Inspect medical kit" aria-pressed="false"><rect class="module" x="319" y="136" width="148" height="64" rx="5"/><text x="331" y="156" class="svg-label">02 / MEDICAL</text><rect x="333" y="165" width="27" height="22" rx="4" fill="none" stroke="currentColor"/><path d="M346.5 170v12m-6-6h12" stroke="currentColor" stroke-width="2"/><text x="370" y="181" class="svg-fine">MED KIT</text></g>
<g class="map-item" data-pick="comms" role="button" tabindex="0" aria-label="Inspect communications and ground link" aria-pressed="false"><rect class="module" x="477" y="136" width="136" height="64" rx="5"/><text x="489" y="156" class="svg-label">03 / COMMS</text><path d="M496 171q11-9 22 0m-18 4q7-6 14 0m-10 4q3-3 6 0" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="507" cy="184" r="1.5" fill="currentColor"/><text x="524" y="183" class="svg-fine">LINK</text></g>
<g class="map-item" data-pick="power" role="button" tabindex="0" aria-label="Inspect power bus" aria-pressed="false"><rect class="module" x="135" y="246" width="174" height="64" rx="5"/><text x="149" y="266" class="svg-label">04 / POWER BUS</text><rect x="149" y="276" width="30" height="16" rx="3" fill="none" stroke="currentColor"/><path d="M180 280h3v8h-3m-21-4h12m-6-4v8" stroke="currentColor" fill="none"/><text x="190" y="288" class="svg-fine">LOAD MARGIN</text><circle id="power-led" cx="292" cy="261" r="4" fill="#83e7bf"/></g>
<g class="map-item" data-pick="habitat" role="button" tabindex="0" aria-label="Inspect habitat and rest facilities" aria-pressed="false"><rect class="module" x="319" y="246" width="148" height="64" rx="5"/><text x="331" y="266" class="svg-label">05 / HABITAT</text><path d="M335 277h32v19h-32zM375 277h32v19h-32z" fill="#233d48" stroke="#4c6a77"/><path d="M340 277v19m40-19v19" stroke="#7492a0"/></g>
<g class="map-item" data-pick="stores" role="button" tabindex="0" aria-label="Inspect food and water stores" aria-pressed="false"><rect class="module" x="477" y="246" width="136" height="64" rx="5"/><text x="489" y="266" class="svg-label">06 / STORES</text><path d="M492 277h19v16h-19zm25 0h19v16h-19zm25 0h19v16h-19z" fill="#244351" stroke="#557b8a"/></g>
<g class="map-item" data-pick="command" role="button" tabindex="0" aria-label="Inspect command procedures and training" aria-pressed="false"><path class="module" d="M625 143q67 8 109 80-42 70-109 80z"/><path d="M653 160q41 18 63 63-22 44-63 63" fill="none" stroke="#6a9caa" stroke-width="2"/><text x="642" y="223" class="svg-label">COMMAND</text></g>
<g class="map-item crew-node" data-pick="c03" role="button" tabindex="0" aria-label="Inspect crew C03 systems engineer" aria-pressed="false" transform="translate(249 222)"><circle r="15"/><use href="#person" x="-12" y="-12" width="24" height="24"/><text x="-12" y="-20">C03</text></g><g class="map-item crew-node" data-pick="c02" role="button" tabindex="0" aria-label="Inspect crew C02 medical officer" aria-pressed="false" transform="translate(399 222)"><circle r="15"/><use href="#person" x="-12" y="-12" width="24" height="24"/><text x="-12" y="-20">C02</text></g><g class="map-item crew-node" data-pick="c04" role="button" tabindex="0" aria-label="Inspect crew C04 communications specialist" aria-pressed="false" transform="translate(550 222)"><circle r="15"/><use href="#person" x="-12" y="-12" width="24" height="24"/><text x="-12" y="-20">C04</text></g><g class="map-item crew-node" data-pick="c01" role="button" tabindex="0" aria-label="Inspect crew C01 commander" aria-pressed="false" transform="translate(669 253)"><circle r="15"/><use href="#person" x="-12" y="-12" width="24" height="24"/><text x="-12" y="30">C01</text></g>
<path d="M234 311v38h131m40-35v35m135-39v39H445" stroke="#65a9b4" stroke-dasharray="3 4" fill="none" opacity=".7"/><text x="79" y="374" class="svg-fine">SOFTWARE ROLES</text>
<g class="map-item agent-node" data-pick="monitor" role="button" tabindex="0" aria-label="Inspect Monitor agent" aria-pressed="false" transform="translate(208 352)"><rect width="116" height="32" rx="6"/><text x="13" y="20">01  MONITOR</text></g><g class="map-item agent-node" data-pick="planner" role="button" tabindex="0" aria-label="Inspect Planner agent" aria-pressed="false" transform="translate(343 352)"><rect width="116" height="32" rx="6"/><text x="13" y="20">02  PLANNER</text></g><g class="map-item agent-node" data-pick="relay" role="button" tabindex="0" aria-label="Inspect Relay agent" aria-pressed="false" transform="translate(478 352)"><rect width="116" height="32" rx="6"/><text x="13" y="20">03  RELAY</text></g><path d="M328 368h11m123 0h12" stroke="#8dd5d4" stroke-width="2"/></svg>`;

const ITEMS = {
  scrubber: ["SHIP SYSTEM", "Life support and CO₂ scrubber", "Synthetic equipment · baseline flow", "Removes modeled cabin CO₂. The scrubber marker is a selectable device; this view does not issue equipment commands.", "Items · scrubber rack, filter and flow monitor"],
  medical: ["SHIP SYSTEM", "Medical kit", "Synthetic equipment · available", "Stores the crew medical kit and check-in equipment. Personal health records remain in the Crew-only panel.", "Items · medical kit and check-in tablet"],
  comms: ["SHIP SYSTEM", "Communications", "Synthetic link · status shown separately", "Carries the delayed Ground snapshot and receipt trail. Selecting this marker does not send messages.", "Items · communications console and relay"],
  power: ["SHIP SYSTEM", "Power bus", "Synthetic equipment · load margin", "Displays modeled electrical distribution and available load margin.", "Items · power bus and load monitor"],
  habitat: ["SHIP SYSTEM", "Habitat and rest facilities", "Synthetic module · illustrative", "Represents crew quarters and rest facilities in the shared deck plan.", "Items · crew quarters and environmental controls"],
  stores: ["SHIP SYSTEM", "Food and water stores", "Synthetic inventory · illustrative", "Represents the location of mission consumables. No inventory mutation is available from this map.", "Items · food and water storage"],
  command: ["SHIP SYSTEM", "Command station", "Synthetic module · illustrative", "Crew command procedures and training station.", "Items · command console and incident checklist"],
  c01: ["CREW / C01", "Commander", "Command station · illustrative role", "Reviews planner evidence and owns the crew authorization step in this walkthrough.", "Items · command console and incident checklist"],
  c02: ["CREW / C02", "Medical officer", "Medical station · synthetic crew marker", "Crew health observations are available only in the authorized Crew view.", "Items · check-in tablet and medical kit"],
  c03: ["CREW / C03", "Systems engineer", "Life-support rack · illustrative role", "Checks the scrubber and power indications. The room assignment represents responsibility.", "Items · service tablet and scrubber rack"],
  c04: ["CREW / C04", "Communications specialist", "Comms station · illustrative role", "Reviews delivery, acknowledgements and the age of Ground advice.", "Items · communications console and message log"],
  monitor: ["SOFTWARE ROLE", "Monitor agent", "Watching observations", "Tracks synthetic observations and captures fault evidence. It does not authorize or execute crew actions.", "Items · observation stream and evidence record"],
  planner: ["SOFTWARE ROLE", "Planner agent", "Nominal case", "Evaluates candidate plans against modeled constraints and returns reason codes.", "Items · candidate evaluation and constraints"],
  relay: ["SOFTWARE ROLE", "Relay agent", "Tracking delivery", "Prepares allowlisted Ground snapshots and tracks delivery receipts.", "Items · snapshot queue and receipt trail"],
};
const CSS = `
.deck-map{margin-top:1.5rem;border:1px solid #334155;border-radius:12px;background:#102331;color:#e2edf2;padding:1rem}
.deck-map-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.75rem}
.deck-map-head h2{font-size:1.1rem;font-weight:700;color:#f1f5f9}
.deck-map-head p{font-size:.75rem;color:#a9c0ce}
.deck-map-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(210px,.32fr);gap:.75rem}
.deck-map-canvas{min-width:0;overflow:auto;border:1px solid #3d5664;border-radius:8px;background:#0b1923}
.deck-map-canvas svg{display:block;width:100%;min-width:540px;height:auto}
.deck-map-inspector{border:1px solid #3d5664;border-radius:8px;padding:.85rem;background:#142b3a;min-width:0}
.deck-map-inspector .eyebrow{font-size:.68rem;letter-spacing:.08em;color:#9ce4e2;font-weight:700}
.deck-map-inspector h3{font-size:1rem;font-weight:700;margin:.45rem 0;color:#f1f5f9}
.deck-map-inspector p{font-size:.82rem;line-height:1.5;color:#d1dee5;margin:.4rem 0}
.deck-map-inspector .detail{font-size:.75rem;color:#9fb5c3}
.deck-map .module{fill:#203b47;stroke:#5b8290;stroke-width:1.3}
.deck-map .svg-label,.deck-map .svg-fine,.deck-map .crew-node text,.deck-map .agent-node text{font-family:ui-monospace,monospace;font-weight:650;letter-spacing:.35px}
.deck-map .svg-label{fill:#e4f6f6;font-size:10px}.deck-map .svg-fine{fill:#b6d0dc;font-size:9px}
.deck-map .map-item{cursor:pointer;color:#9ce4e2;outline:none}
.deck-map .map-item:hover .module,.deck-map .map-item:focus-visible .module,.deck-map .map-item[aria-pressed=true] .module{stroke:#b7ffed;stroke-width:2.7;fill:#244d59}
.deck-map .crew-node{color:#a5eeff}.deck-map .crew-node circle{fill:#153344;stroke:#a3e9ff;stroke-width:1.5}.deck-map .crew-node text{fill:#d1f3ff;font-size:9px}
.deck-map .crew-node:hover circle,.deck-map .crew-node:focus-visible circle,.deck-map .crew-node[aria-pressed=true] circle{stroke:#fff;stroke-width:3.2;fill:#295669}
.deck-map .agent-node rect{fill:#15343a;stroke:#6aadad}.deck-map .agent-node text{fill:#c1fae8;font-size:10px}
.deck-map .agent-node:hover rect,.deck-map .agent-node:focus-visible rect,.deck-map .agent-node[aria-pressed=true] rect{stroke:#a4f3d4;stroke-width:2.6;fill:#235057}
.deck-map button{border:1px solid #7696aa;background:#203847;color:#eaf6fc;border-radius:5px;padding:.3rem .55rem;font-size:.75rem}
.deck-map button:focus-visible{outline:3px solid #a4f3d4;outline-offset:2px}
.deck-map .map-readouts{display:flex;flex-wrap:wrap;gap:.35rem;padding:.55rem .2rem}
.deck-map .map-readouts span{font:700 .72rem ui-monospace,monospace;color:#aef1db;background:#1b3a44;padding:.26rem .44rem;border-radius:.25rem}
@media(max-width:800px){.deck-map-layout{grid-template-columns:1fr}.deck-map-inspector{min-height:130px}}
`;

export default function DeckMap({ role }) {
  const [selected, setSelected] = useState("scrubber");
  const [enlarged, setEnlarged] = useState(false);
  const item = ITEMS[selected] ?? ITEMS.scrubber;
  function select(event) {
    const marker = event.target.closest?.("[data-pick]");
    if (!marker || !event.currentTarget.contains(marker)) return;
    const key = marker.getAttribute("data-pick");
    if (!ITEMS[key]) return;
    setSelected(key);
    event.currentTarget.querySelectorAll("[data-pick]").forEach((node) => {
      node.setAttribute("aria-pressed", String(node === marker));
    });
  }
  function selectByKeyboard(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const marker = event.target.closest?.("[data-pick]");
    if (!marker) return;
    event.preventDefault();
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  return (
    <section className="deck-map" aria-labelledby="deck-map-title" data-testid="deck-map" data-role={role}>
      <style>{CSS}</style>
      <header className="deck-map-head">
        <div><h2 id="deck-map-title">Shared spacecraft deck</h2><p>SYMBIOSIS X · Concept schematic · no vehicle geometry</p></div>
        <span className="text-xs text-slate-300">{role === "ground" ? "Ground view · shared equipment only" : "Crew view · shared equipment and crew markers"}</span>
      </header>
      <div className="deck-map-layout">
        <div>
          <div className="deck-map-canvas" onClick={select} onKeyDown={selectByKeyboard} tabIndex={-1} aria-label="Interactive spacecraft deck map">
            <div dangerouslySetInnerHTML={{ __html: SHIP_DECK_SVG }} />
          </div>
          <div className="map-readouts"><span>SCRUBBER · 20 m³/h</span><span>HEADROOM · 0.60 kW</span></div>
        </div>
        <aside className="deck-map-inspector" aria-live="polite" data-testid="deck-inspector">
          <p className="eyebrow">{item[0]}</p><h3 data-testid="deck-selected-title">{item[1]}</h3>
          <p>{item[2]}</p><p>{item[3]}</p><p className="detail">{item[4]}</p>
          {role === "ground" && selected.startsWith("c0") && <p className="detail">Ground cannot access personal health records. Crew markers are shown as illustrative positions only.</p>}
          <p className="detail">Selection is local to this browser view; it does not issue a command or change simulated equipment state.</p>
        </aside>
      </div>
      <div className="mt-2 flex justify-end"><button type="button" aria-pressed={enlarged} onClick={() => setEnlarged((v) => !v)}>{enlarged ? "Fit deck" : "Enlarge deck"}</button></div>
      {enlarged && <style>{".deck-map-canvas svg{min-width:800px!important}"}</style>}
    </section>
  );
}
