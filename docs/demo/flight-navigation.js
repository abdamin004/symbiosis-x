function createFlightNavigation(reference, hosts) {
  const minimap = hosts.mini;
  const {large,preview} = hosts;
  const fields = hosts.fields;
  const tau = Math.PI * 2;
  let snapshot = null;

  function pointAt(orbit, elapsed) {
    const sample = ((elapsed % orbit.period + orbit.period) % orbit.period) / orbit.period * (orbit.points.length - 1);
    const lo = Math.floor(sample);
    return orbit.points[lo].map((value,i)=>value+(orbit.points[lo+1][i]-value)*(sample-lo));
  }

  function paint(canvas, data) {
    const ctx = canvas.getContext("2d");
    const {width,height} = canvas;
    const guidance = canvas === hosts.guidance;
    const compact = canvas === preview;
    const scale = Math.min(width,height)*(guidance ? .31 : .405)/reference.earth;
    const center = [width/2,height/2];
    let waypoint;
    // Expand altitude on the maneuver canvas so changes of a few hundred km
    // stay legible beside an Earth radius of more than six thousand km.
    const screen = (x,y)=>{
      const radius = Math.hypot(x,y);
      const factor = guidance && radius > 0
        ? 1+4*(radius-reference.earth)/radius : 1;
      return [center[0]+x*scale*factor,center[1]+y*scale*factor];
    };
    function dot(x,y,r,color) {
      ctx.beginPath();
      ctx.arc(x,y,r,0,tau);
      ctx.fillStyle=color;
      ctx.fill();
    }
    function route(points,color,dash=[]) {
      ctx.beginPath();
      points.forEach(([x,y],index)=>index ? ctx.lineTo(...screen(x,y)) : ctx.moveTo(...screen(x,y)));
      ctx.strokeStyle=color;
      ctx.lineWidth=1.4;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function label(value,x,y,color) {
      ctx.fillStyle=color;
      ctx.font="600 12px system-ui";
      ctx.fillText(value,x,y);
    }
    if (compact) ctx.clearRect(0,0,width,height);
    else {
      ctx.fillStyle="#090f20";
      ctx.fillRect(0,0,width,height);
    }
    const globe = ctx.createRadialGradient(width*.45,height*.41,3,...center,reference.earth*scale);
    globe.addColorStop(0,"#35648e");
    globe.addColorStop(1,"#142747");
    dot(...center,reference.earth*scale,globe);
    const orbit = data.inserted ? reference.parking : reference.insertion;
    const insertionBurn = guidance && data.burn?.kind === "insertion";
    const epoch = data.inserted ? data.insertion : data.ignition;
    const elapsed = Math.max(0,data.time-(epoch ?? data.time));
    const target = pointAt(reference.station,data.time-(data.insertion ?? data.ignition)+reference.stationEpochS);
    if (!data.checkout && (!guidance || data.transfer !== null || data.guidanceMode === "burn")) {
      route(reference.station.points,"#778dc1",[4,4]);
      dot(...screen(...target),canvas === large ? 4 : 3,"#a6bcff");
    }
    if (!data.captured && data.departure === null && data.matched === null) {
      const path = insertionBurn ? orbit.points.map(([x,y],index)=>{
        const [startX,startY] = reference.insertion.points[index];
        return [startX+(x-startX)*data.burn.progress,startY+(y-startY)*data.burn.progress];
      }) : orbit.points;
      route(path,data.inserted ? "#8ce5cb" : "#f4bf8f",data.inserted ? [] : [3,3]);
    }
    let craft = pointAt(orbit,elapsed);
    if (guidance && data.guidanceMode === "coast" && data.coastUntil !== undefined) {
      waypoint = pointAt(orbit,data.coastUntil-epoch);
    }
    if (guidance && (data.plannedBurn === "insertion" || data.burn?.kind === "insertion")) {
      route(reference.parking.points,"#ffbf92",[5,4]);
    }
    if (guidance && data.plannedBurn === "transfer") {
      const angle = Math.atan2(craft[1],craft[0]);
      route(reference.transfer.points.map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),
        x*Math.sin(angle)+y*Math.cos(angle)]),"#ffbf92",[5,4]);
    }
    if (!data.inserted) {
      const progress = Math.min(1,elapsed/data.ascentDuration);
      const angle = Math.PI + (progress-1)*.53;
      const radius = reference.earth + orbit.ap * progress**1.45;
      const ascent = Array.from({length:24},(_,i)=>{
        const f = progress*i/23;
        const r = reference.earth + orbit.ap*f**1.45;
        return [r*Math.cos(Math.PI+(f-1)*.53),r*Math.sin(Math.PI+(f-1)*.53)];
      });
      route(ascent,"#ffd0a4");
      craft = [radius*Math.cos(angle),radius*Math.sin(angle),null];
    }
    if (data.transfer !== null && !data.captured && data.departure === null) {
      const atBurn = pointAt(reference.parking,data.transfer-data.insertion);
      const angle = Math.atan2(atBurn[1],atBurn[0]);
      const align = ([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
      const progress = data.burn?.kind === "transfer" ? data.burn.progress : 1;
      const match = data.matched === null ? 0 : data.burn?.kind === "match" ? data.burn.progress : 1;
      const transfer = reference.transfer.points.map((point)=>{
        const [x,y] = align(point);
        const radius = Math.hypot(x,y);
        const base = reference.earth + reference.parking.ap;
        const scale = (base + progress*(radius-base) + match*(reference.earth+reference.station.ap-radius))/radius;
        return [x*scale,y*scale];
      });
      if (match < 1) route(reference.transfer.points.map(align),"#bd9bff",[3,4]);
      if (guidance && data.guidanceMode === "burn" && data.matched === null && data.time >= data.transfer+reference.transferS) {
        route(reference.station.points,"#ffbf92",[5,4]);
      }
      if (guidance && data.guidanceMode === "coast") waypoint = transfer[0];
      route(transfer,"#ffbb89");
      const fraction = Math.min(1,(data.time-data.transfer)/reference.transferS);
      const index = (180+Math.round(fraction*180))%360;
      craft = [...transfer[index],null];
      if (match === 1) {
        const [mx,my,v] = pointAt(reference.station,data.time-data.matched);
        craft = [...align([mx,my]),v];
      }
    }
    if (data.captured) craft = target;
    if (data.departure !== null) {
      const departureEpoch = data.departure-data.insertion;
      const stationAtDeparture = pointAt(reference.station,departureEpoch + reference.stationEpochS);
      const departureAngle = Math.atan2(stationAtDeparture[1],stationAtDeparture[0]);
      const angle = departureAngle + tau*(data.time-data.departure)/reference.station.period;
      const radius = Math.hypot(stationAtDeparture[0],stationAtDeparture[1]);
      craft = [radius*Math.cos(angle),radius*Math.sin(angle),stationAtDeparture[2]];
    }
    if (data.deorbit !== null) {
      const atBurn = data.checkout ? pointAt(orbit,data.deorbit-data.insertion) : craft;
      const start = Math.atan2(atBurn[1],atBurn[0]) -
        (data.checkout ? 0 : tau*(data.time-data.deorbit)/reference.station.period);
      const altitude = Math.hypot(atBurn[0],atBurn[1])-reference.earth;
      const entry = Array.from({length:30},(_,i)=>{
        const f = i/29;
        const radius = reference.earth + altitude*(1-f*f);
        return [radius*Math.cos(start+f*.47),radius*Math.sin(start+f*.47)];
      });
      route(entry,"#ff9778",[5,4]);
      const fraction = Math.min(1,Math.max(0,(data.time-data.deorbit)/data.entryDuration));
      craft = [...entry[Math.round(fraction*29)],null];
    }
    if (guidance && waypoint) {
      const [wx,wy] = screen(...waypoint);
      ctx.strokeStyle="#9dd7ff";
      ctx.lineWidth=1.5;
      ctx.strokeRect(wx-6,wy-6,12,12);
      label("CHECKPOINT",wx+10,wy+4,"#9dd7ff");
    }
    const [x,y] = screen(...craft);
    const heading = Math.atan2(craft[1],craft[0]) + Math.PI/2 + data.attitude*Math.PI/180;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(heading);
    if (data.burn && data.burn.kind !== "coast" && data.burn.progress < 1) {
      ctx.fillStyle="#ff9c62";
      ctx.beginPath();
      ctx.moveTo(-3,-3);ctx.lineTo(-14,0);ctx.lineTo(-3,3);ctx.fill();
    }
    ctx.fillStyle="#fff0bf";
    ctx.beginPath();
    ctx.moveTo(7,0);ctx.lineTo(-4,4);ctx.lineTo(-2,0);ctx.lineTo(-4,-4);ctx.closePath();ctx.fill();
    ctx.restore();
    if (guidance) {
      label(data.ship,10,19,"#fff0bf");
      label("Altitude exaggerated",10,height-10,"#b4c8de");
      if (data.guidanceMode === "burn") label("Target path",width-76,19,"#ffbf92");
      else if (data.deorbit !== null) label("Entry path",width-68,19,"#ff9778");
      else if (data.matched !== null) label("ISS orbit",width-61,19,"#b9c8f7");
      else if (data.inserted) label("Current path",width-85,19,data.transfer === null ? "#8ce5cb" : "#ffbb89");
    } else if (canvas === large && data.inserted && !data.captured && data.deorbit === null && data.transfer === null) {
      ctx.fillStyle="#d8f6ed";
      ctx.font="12px system-ui";
      ctx.fillText("AP",center[0]+orbit.points[0][0]*scale-18,center[1]-8);
      ctx.fillText("PE",center[0]+orbit.points[180][0]*scale+5,center[1]-8);
    }
    return craft;
  }

  function show(data) {
    snapshot = data;
    if (!data) return;
    const craft = paint(preview,data);
    if (large.closest("dialog").open) paint(large,data);
    paintAttitude(data);
    if (!hosts.guidance.hidden) paint(hosts.guidance,data);
    const orbit = data.captured || data.departure !== null || data.matched !== null ? reference.station
      : data.inserted ? reference.parking : reference.insertion;
    hosts.caption.textContent = data.phase;
    hosts.heading.textContent = "Yaw "+data.attitude+"° · Pitch "+data.pitch+"°";
    const transferProgress = data.burn?.kind === "transfer" ? data.burn.progress : 1;
    const transferring = data.transfer !== null && data.matched === null && !data.captured && data.departure === null;
    const ap = transferring ? Math.round(orbit.ap+(reference.transfer.ap-orbit.ap)*transferProgress) : orbit.ap;
    const pe = data.burn?.kind === "insertion"
      ? Math.round(reference.insertion.pe+(orbit.pe-reference.insertion.pe)*data.burn.progress)
      : data.burn?.kind === "match" ? Math.round(reference.transfer.pe+(orbit.pe-reference.transfer.pe)*data.burn.progress)
      : transferring ? reference.transfer.pe : orbit.pe;
    fields.ap.textContent = data.deorbit === null ? ap+" km" : "—";
    fields.pe.textContent = data.deorbit === null ? pe+" km" : "—";
    fields.altitude.textContent = Math.round(Math.hypot(craft[0],craft[1])-reference.earth)+" km";
    fields.speed.textContent = craft[2] === null ? "Scripted segment" : craft[2].toFixed(2)+" km/s";
    fields.period.textContent = data.inserted && data.deorbit === null
      ? Math.round((transferring ? reference.transfer : orbit).period/60)+" min" : "—";
    fields.attitude.textContent = data.attitude+"° relative to prograde · pitch "+data.pitch+"°";
    fields.reserve.textContent = data.rcs+" cold-gas pulses";
    fields.stage.textContent = data.propulsion;
    fields.target.textContent = data.target;
    fields.owner.textContent = data.owner;
    fields.approach.textContent = data.approach;
    fields.basis.textContent = data.captured ? "Station orbit reference" : data.deorbit !== null ? "Scripted descent path"
      : data.departure !== null ? "Departure reference in station orbit"
      : data.matched !== null ? "Matched orbit · final approach uses scripted range"
      : data.transfer !== null ? "Ideal coplanar transfer · fictional station ephemeris"
      : data.inserted ? "Ideal two-body parking orbit · approach follows the range readout"
      : data.ignition === null ? "Launchpad · dashed insertion reference" : "Scripted ascent · dashed insertion reference";
    for (const button of hosts.attitudeControls) button.disabled = !data.canOrient;
  }

  function paintAttitude(data) {
    const ctx = minimap.getContext("2d");
    const center = minimap.width/2;
    const yaw = data.attitude*Math.PI/180;
    const horizon = center + data.pitch*.72;
    ctx.clearRect(0,0,minimap.width,minimap.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center,center,center-4,0,tau);
    ctx.clip();
    ctx.fillStyle = "#244f7d";
    ctx.fillRect(0,0,minimap.width,horizon);
    ctx.fillStyle = "#604236";
    ctx.fillRect(0,horizon,minimap.width,minimap.height);
    ctx.strokeStyle = "#e6efff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0,horizon);
    ctx.lineTo(minimap.width,horizon);
    ctx.stroke();
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    for (let angle=-360;angle<=360;angle+=15) {
      const x = center+(angle-data.attitude)*1.55;
      if (Math.abs(x-center)>center) continue;
      ctx.fillStyle = "#d5e5ff";
      ctx.fillRect(x,17,1,angle%45===0 ? 10 : 5);
      if (angle%45===0) ctx.fillText(String((angle+360)%360),x,42);
    }
    for (const offset of [-30,-15,15,30]) {
      const y = horizon+offset*1.2;
      ctx.fillStyle = "#d5e5ff";
      ctx.fillRect(center-12,y,24,1);
    }
    ctx.beginPath();
    ctx.arc(center-Math.sin(yaw)*54,horizon,7,0,tau);
    ctx.strokeStyle = "#97f7ce";
    ctx.stroke();
    ctx.strokeStyle = "#ffd789";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(center-30,center);
    ctx.lineTo(center-9,center);
    ctx.lineTo(center,center+8);
    ctx.lineTo(center+9,center);
    ctx.lineTo(center+30,center);
    ctx.stroke();
    ctx.restore();
  }

  function showAt(time) {
    if (snapshot) show({...snapshot,time});
  }
  return {show,showAt};
}
