import React from "react";

export default function AssetInspector({ selected, co2, scrubber, power, version }) {
  const asset = ASSETS.find((item) => item.id === selected);
  if (!asset) return <section className="details-panel"><h2>Selected Details</h2><p>Select a spacecraft module.</p></section>;
  const scrubberFault = selected === "life-support" && typeof scrubber === "number" && scrubber < 20;
  const powerFault = selected === "power" && typeof power === "number" && power < 0.4;
  return (
    <section className="details-panel" aria-live="polite">
      <h2>Selected Details</h2>
      <div className="selected-heading"><strong>{asset.name}</strong> <span className="tiny-tag">SELECTED</span></div>
      <div className="detail-row"><span>Asset ID</span><b>{asset.id}</b></div>
      <div className="detail-row"><span>Subsystem</span><b>{asset.detail}</b></div>
      {version != null && <div className="detail-row"><span>Revision</span><b>v{version}</b></div>}
      {selected === "life-support" && <>
        {typeof co2 === "number" && <div className="detail-row"><span>CO₂</span><b>{co2.toLocaleString()} ppm</b></div>}
        {typeof scrubber === "number" && <div className="detail-row"><span>Scrubber</span><b>{scrubberFault ? "FAULT" : "NORMAL"}</b></div>}
      </>}
      {selected === "power" && typeof power === "number" && <div className="detail-row"><span>Available power</span><b>{power.toFixed(2)} kW {powerFault ? "· LOW" : ""}</b></div>}
      <p>Demo values only. Operational interpretation comes from the authorized run projection.</p>
    </section>
  );
}

const ASSETS = [
  { id: "life-support", name: "Life Support", detail: "CO₂ Scrubber" },
  { id: "medical", name: "Medical", detail: "Medical Kit" },
  { id: "comms", name: "Communications", detail: "Link" },
  { id: "power", name: "Power", detail: "Load Margin" },
  { id: "habitat", name: "Habitat", detail: "Crew Quarters" },
  { id: "stores", name: "Stores", detail: "Supplies" },
  { id: "command", name: "Command", detail: "Flight Control" },
];
