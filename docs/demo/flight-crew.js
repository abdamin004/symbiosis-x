// Deterministic, local Flight gameplay. These needs are game meters, independent of vitals.
function createCrewRoutines({count,tick,occupied}) {
  const needs = [
    {id:"meal",label:"Food",asset:"galley",action:"Eat a meal",interval:7200,duration:240,stock:"meals",cost:1},
    {id:"water",label:"Hydration",asset:"galley",action:"Drink water",interval:4200,duration:90,stock:"water",cost:.25},
    {id:"rest",label:"Rest",asset:"bed",action:"Rest in bunk",interval:14400,duration:900},
    {id:"hygiene",label:"Hygiene",asset:"wc",action:"Use the WC",interval:6600,duration:150},
  ];
  const duties = [
    [["radio","Review mission plan"],["stores","Review supply manifest"],["galley","Check galley supplies"]],
    [["lab","Log experiment baseline"],["bench","Compare motion samples"],["stores","Inspect research kit"]],
    [["scrubber","Check scrubber status"],["bus","Review power loads"],["bench","Log engineering readings"]],
    [["radio","Review relay queue"],["stores","Log inventory movement"],["radio","Prepare the next watch report"]],
  ];
  const travel = 2*tick;
  const stock = {meals:40,water:24};
  const sessions = new Map();

  function create(start) {
    return {time:start-tick,supplies:{...stock},crew:Array.from({length:count},(_,member)=>({
      active:null,previous:null,rotation:0,blocked:"",checkup:null,
      refreshed:Object.fromEntries(needs.map((need,i)=>[need.id,start-need.interval*(.56+(member+i)%4*.07)])),
    }))};
  }

  function update(mode,start,now,revision) {
    let session = sessions.get(mode);
    if (!session || session.start !== start || session.revision !== revision || now < session.time) {
      session = {...create(start),start,revision};
      sessions.set(mode,session);
    }
    for (let time = session.time+tick; time <= now; time += tick) {
      const reserved = new Set();
      const remaining = {...session.supplies};
      session.crew.forEach((person,member)=>{
        const job = person.active;
        if (!job) return;
        if (time >= job.finishes) {
          if (job.need) {
            person.refreshed[job.need.id] = job.finishes;
            if (job.need.stock) {
              session.supplies[job.need.stock] -= job.need.cost;
              remaining[job.need.stock] -= job.need.cost;
            }
          } else if (job.checkup !== undefined) {
            session.crew[job.checkup].checkup = {observer:member,time};
          } else person.rotation++;
          person.previous = job.asset;
          person.active = null;
        } else if (occupied(member,job.asset,time) ||
            job.checkup !== undefined && occupied(job.checkup,null,time)) {
          person.previous = time >= job.arrival ? job.asset : person.previous;
          person.active = null;
        } else {
          reserved.add(job.asset);
          if (job.need?.stock) remaining[job.need.stock] -= job.need.cost;
        }
      });
      session.crew.forEach((person,member)=>{
        person.blocked = "";
        if (person.active || session.crew.some(other=>other.active?.checkup === member) || occupied(member,null,time)) return;
        const urgent = needs.map(need=>({need,age:(time-person.refreshed[need.id])/need.interval}))
          .filter(item=>item.age >= .72).sort((a,b)=>b.age-a.age);
        const available = asset=>!reserved.has(asset) && !occupied(member,asset,time);
        const patient = (member + 1) % count;
        const lastCheck = session.crew[patient].checkup?.time ?? start - patient * 180;
        if (time - lastCheck >= 86400 && available("lab") && !occupied(patient,null,time)) {
          const partner = session.crew[patient];
          if (partner.active) {
            reserved.delete(partner.active.asset);
            if (partner.active.need?.stock) remaining[partner.active.need.stock] += partner.active.need.cost;
            partner.active = null;
          }
          person.active = {asset:"lab",action:"Daily crew checkup",checkup:patient,previous:person.previous,
            patientPrevious:partner.previous,assigned:time,arrival:time+travel,finishes:time+travel+180};
          reserved.add("lab");
          return;
        }
        const need = urgent.find(({need})=>available(need.asset) &&
          (!need.stock || remaining[need.stock] >= need.cost))?.need;
        const routine = duties[member][person.rotation%duties[member].length];
        if (!need && urgent.length) person.blocked = urgent[0].need.label + " waiting for a free station or supplies";
        const asset = need?.asset ?? routine[0];
        if (!available(asset)) return;
        person.active = {asset,action:need?.action ?? routine[1],need,previous:person.previous,
          assigned:time,arrival:time+travel,finishes:time+travel+(need?.duration ?? 120+member*tick)};
        reserved.add(asset);
        if (need?.stock) remaining[need.stock] -= need.cost;
      });
      session.time = time;
    }
    return session;
  }

  const levels = (person,time) => needs.map(need=>[need.label,
    Math.round(100*Math.max(0,Math.min(1,1-(time-person.refreshed[need.id])/need.interval)))]);
  const meters = (person,time) => levels(person,time).map(([label,value])=>[label,value+"%"]);

  function wellbeing(person,time,member,cabinStress) {
    const [need, reserve] = levels(person,time).sort((a,b)=>a[1]-b[1])[0];
    const needsLoad = Math.max(0,40-reserve) * 1.35 + (person.blocked ? 12 : 0);
    const eventLoad = cabinStress ? [24,45,33,29][member] : 0;
    const value = Math.max(0,Math.round(100-needsLoad-eventLoad));
    return {value, state:value < 43 ? "Strained" : value < 71 ? "Under pressure" : "Settled",
      driver:cabinStress ? "Cabin air alert" : person.blocked ? "Needs waiting for access" : need+" is lowest",
      need,reserve};
  }
  return {update,meters,wellbeing};
}
