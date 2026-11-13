const modules = [
  {
    id: "life-support",
    number: "01",
    name: "Life Support",
    short: "LIFE SUPPORT",
    detail: "CO₂ SCRUBBER",
    x: 118,
    y: 125,
    width: 164,
  },
  {
    id: "medical",
    number: "02",
    name: "Medical",
    short: "MEDICAL",
    detail: "MED KIT",
    x: 290,
    y: 125,
    width: 145,
  },
  {
    id: "comms",
    number: "03",
    name: "Communications",
    short: "COMMS",
    detail: "LINK",
    x: 443,
    y: 125,
    width: 138,
  },
  {
    id: "power",
    number: "04",
    name: "Power",
    short: "POWER BUS",
    detail: "LOAD MARGIN",
    x: 118,
    y: 275,
    width: 164,
  },
  {
    id: "habitat",
    number: "05",
    name: "Habitat",
    short: "HABITAT",
    detail: "CREW QUARTERS",
    x: 290,
    y: 275,
    width: 145,
  },
  {
    id: "stores",
    number: "06",
    name: "Stores",
    short: "STORES",
    detail: "SUPPLIES",
    x: 443,
    y: 275,
    width: 138,
  },
  {
    id: "command",
    number: "07",
    name: "Command",
    short: "COMMAND",
    detail: "FLIGHT CONTROL",
  },
];

export default function ShipDeck({
  selected,
  setSelected,
  version,
  scrubber,
  power,
}) {
  function isFault(id) {
    return (
      (id === "life-support" && scrubber < 20) ||
      (id === "power" && power < 0.4)
    );
  }

  function selectOnKeyboard(event, id) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(id);
    }
  }

  const roomHeight = 86;

  return (
    <div className="deck-map">
      <div className="deck-topbar">
        <span>ONBOARD / V{version}</span>
        <span>DECK 01 · ONE CABIN ZONE</span>
        <span>TOP VIEW</span>
      </div>

      <div className="deck-scroll">
        <svg
          className="deck-svg"
          viewBox="0 0 760 425"
          xmlns="http://www.w3.org/2000/svg"
          role="group"
          aria-label="Interactive spacecraft schematic"
        >
          <defs>
            <pattern
              id="deck-grid"
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M22 0H0V22"
                fill="none"
                stroke="#254458"
                strokeWidth=".6"
              />
            </pattern>

            <pattern
              id="solar-grid"
              width="17"
              height="17"
              patternUnits="userSpaceOnUse"
            >
              <rect
                width="17"
                height="17"
                fill="#25465e"
                stroke="#5987a2"
                strokeWidth=".8"
              />
            </pattern>

            <linearGradient
              id="ship-metal"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop offset="0%" stopColor="#3d687c" />
              <stop offset="55%" stopColor="#1c3848" />
              <stop offset="100%" stopColor="#102332" />
            </linearGradient>
          </defs>

          {/* BACKGROUND */}
          <rect width="760" height="425" fill="#081824" />
          <rect
            width="760"
            height="425"
            fill="url(#deck-grid)"
          />

          {/* CORNER MARKERS */}
          <g
            stroke="#56869a"
            strokeWidth="1"
            opacity=".7"
          >
            <path d="M20 35h35M37 18v35" />
            <path d="M705 35h35M722 18v35" />
            <path d="M20 385h35M37 368v35" />
          </g>

          <text x="48" y="26" className="deck-small">
            AFT
          </text>

          <text x="692" y="26" className="deck-small">
            FORE
          </text>

          {/* SOLAR PANEL SUPPORTS */}
          <rect
            x="190"
            y="78"
            width="8"
            height="39"
            fill="#729eb2"
          />

          <rect
            x="480"
            y="78"
            width="8"
            height="39"
            fill="#729eb2"
          />

          {/* SOLAR PANELS */}
          <rect
            x="110"
            y="45"
            width="170"
            height="33"
            rx="4"
            fill="url(#solar-grid)"
            stroke="#80aec8"
          />

          <rect
            x="400"
            y="45"
            width="170"
            height="33"
            rx="4"
            fill="url(#solar-grid)"
            stroke="#80aec8"
          />

          {/* REAR EQUIPMENT */}
          <path
            d="M90 170H62L35 208V292L62 325H90Z"
            fill="#18394a"
            stroke="#86b8ce"
            strokeWidth="2"
          />

          {[230, 244, 258, 272, 286].map((y) => (
            <line
              key={y}
              x1="41"
              x2="69"
              y1={y}
              y2={y}
              stroke="#6a9bb0"
            />
          ))}

          {/* OUTER HULL */}
          <path
            d="
              M128 107
              H580
              Q668 107 712 175
              L744 250
              L712 325
              Q668 393 580 393
              H128
              L90 355
              V145
              Z
            "
            fill="url(#ship-metal)"
            stroke="#a3c8d9"
            strokeWidth="3"
          />

          {/* INNER HULL */}
          <path
            d="
              M136 119
              H578
              Q656 119 700 183
              L730 250
              L700 317
              Q656 381 578 381
              H136
              L103 348
              V152
              Z
            "
            fill="#102938"
            stroke="#6a99ae"
            strokeWidth="1.7"
          />

          {/* WIDER CENTER CORRIDOR */}
          <rect
            x="112"
            y="220"
            width="478"
            height="34"
            rx="3"
            fill="#315260"
            stroke="#8eb9c8"
            strokeWidth="1.4"
            strokeDasharray="5 4"
          />

          <line
            x1="112"
            y1="237"
            x2="590"
            y2="237"
            stroke="#739bab"
            strokeDasharray="3 8"
          />

          {/* SIX ALIGNED ROOMS */}
          {modules
            .filter((module) => module.id !== "command")
            .map((module) => {
              const active = selected === module.id;
              const fault = isFault(module.id);
              const { x, y, width } = module;

              return (
                <g
                  key={module.id}
                  className="deck-room"
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${module.name}`}
                  aria-pressed={active}
                  onClick={() => setSelected(module.id)}
                  onKeyDown={(event) =>
                    selectOnKeyboard(event, module.id)
                  }
                >
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={roomHeight}
                    rx="5"
                    fill={
                      active ? "#3c5575" : "#1d3e4c"
                    }
                    stroke={
                      active
                        ? "#e5b1ff"
                        : fault
                        ? "#ff8aaf"
                        : "#759eb1"
                    }
                    strokeWidth={active ? 2.5 : 1.5}
                  />

                  {/* ROOM NAME */}
                  <text
                    x={x + 12}
                    y={y + 22}
                    className="deck-room-title"
                  >
                    {module.number} / {module.short}
                  </text>

                  {/* STATUS LIGHT */}
                  <circle
                    cx={x + width - 14}
                    cy={y + 15}
                    r="4"
                    fill={
                      fault ? "#ff789d" : "#69e5c0"
                    }
                  />

                  {/* ICON FRAME */}
                  <rect
                    x={x + 13}
                    y={y + 34}
                    width="26"
                    height="25"
                    rx="4"
                    fill="none"
                    stroke="#91d6e5"
                    strokeWidth="1.5"
                  />

                  {/* ROOM ICON */}
                  <text
                    x={x + 26}
                    y={y + 52}
                    textAnchor="middle"
                    fill="#9de9f6"
                    fontSize="16"
                  >
                    {module.id === "life-support"
                      ? "◉"
                      : module.id === "medical"
                      ? "+"
                      : module.id === "comms"
                      ? "⌁"
                      : module.id === "power"
                      ? "ϟ"
                      : module.id === "habitat"
                      ? "⌂"
                      : "▣"}
                  </text>

                  {/* ROOM DETAIL */}
                  <text
                    x={x + 45}
                    y={y + 51}
                    className="deck-room-detail"
                  >
                    {module.detail}
                  </text>
                </g>
              );
            })}

          {/* CREW MARKERS CENTERED IN CORRIDOR */}
          {[
            { x: 192, id: "C03" },
            { x: 346, id: "C02" },
            { x: 490, id: "C04" },
          ].map((person) => (
            <g key={person.id}>
              <circle
                cx={person.x}
                cy="237"
                r="11"
                fill="#173d4c"
                stroke="#a1eaff"
                strokeWidth="1.6"
              />

              <circle
                cx={person.x}
                cy="233"
                r="3.5"
                fill="none"
                stroke="#d4f7ff"
                strokeWidth="1.5"
              />

              <path
                d={`
                  M${person.x - 6} 244
                  Q${person.x} 233
                  ${person.x + 6} 244
                `}
                fill="none"
                stroke="#d4f7ff"
                strokeWidth="1.5"
              />

              <text
                x={person.x + 17}
                y="241"
                className="crew-marker-text"
                textAnchor="start"
              >
                {person.id}
              </text>
            </g>
          ))}

          {/* COMMAND MODULE */}
          <g
            className="deck-room"
            role="button"
            tabIndex={0}
            aria-label="Select Command"
            aria-pressed={selected === "command"}
            onClick={() => setSelected("command")}
            onKeyDown={(event) =>
              selectOnKeyboard(event, "command")
            }
          >
            <path
              d="
                M598 138
                Q672 158 710 250
                Q672 342 598 362
                Z
              "
              fill={
                selected === "command"
                  ? "#3c5575"
                  : "#1c3b4a"
              }
              stroke={
                selected === "command"
                  ? "#e5b1ff"
                  : "#79a8bc"
              }
              strokeWidth="2"
            />

            <path
              d="
                M622 158
                Q677 184 696 250
                Q677 316 622 342
              "
              fill="none"
              stroke="#83b4c9"
              strokeWidth="1.8"
            />

            <text
              x="642"
              y="243"
              textAnchor="middle"
              className="command-text"
            >
              COMMAND
            </text>

            <circle
              cx="642"
              cy="275"
              r="15"
              fill="#1d4654"
              stroke="#b7efff"
              strokeWidth="2"
            />

            <circle
              cx="642"
              cy="270"
              r="5"
              fill="#b7efff"
            />

            <path
              d="M632 285Q642 271 652 285"
              fill="none"
              stroke="#b7efff"
              strokeWidth="2"
            />

            <text
              x="642"
              y="305"
              textAnchor="middle"
              className="crew-marker-text"
            >
              C01
            </text>
          </g>

          <text
            x="35"
            y="410"
            className="deck-small"
          >
            SX-01 / DECK PLAN
          </text>
        </svg>
      </div>

      {/* SOFTWARE ROLES */}
      <div className="deck-bottom">
        <span>SOFTWARE ROLES</span>

        <div className="deck-agent-tags">
          <span>01 MONITOR</span>
          <span>02 PLANNER</span>
          <span>03 RELAY</span>
        </div>
      </div>
    </div>
  );
}
