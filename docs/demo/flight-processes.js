// Flight rehearsal procedures derived from Mission Operations and Mission Control Design.
const flightProcedures = {
  shift: {name:"Life Support watch",source:"Plan and start a shift · W2 Crew work and activity",asset:"scrubber",members:[2,0],
    steps:["Commander releases inspection","Crew travels to scrubber","Crew inspects equipment","Inspection result recorded"]},
  power: {name:"Power watch",source:"W2 Crew work and activity",asset:"bus",members:[2,0],
    steps:["Release inspection","Travel to the power bus","Inspect supply and loads","Record bus condition"]},
  comms: {name:"Comms watch",source:"W4 Ground advice",asset:"radio",members:[3,0],
    steps:["Release relay check","Travel to the comms console","Check the link","Record link condition"]},
  eva: {name:"Exterior inspection",source:"Commander approval · exterior maintenance",asset:"airlock",members:[2,0],
    steps:["Release and suit up","Cross-check suits and airlock","Transit to the antenna","Inspect or replace antenna","Return through the airlock","Commander verifies return"]},
  checkout: {name:"Launch checkout",source:"Plan and start a shift",
    steps:["Start ship systems","Assign and verify crew checks","Arm countdown","Commander commits launch"]},
  relay: {name:"Ground fault inspection",source:"Handle a fault · W4 Ground advice",
    steps:["Ground sends advice","Relay delivers advice","Commander assigns or holds","Crew records result","Relay delivers report"]},
  docking: {name:"ISS approach and transfer",source:"Dock and open · Transfer and return · W6",
    steps:["Commit ISS transfer","Match station orbit","Capture station","Verify seal and pressure","Authorize hatch","Accept cargo receipt","Archive research","Depart station"]},
};

function createFlightAllocator({tick,booked,position}) {
  const key = "sx:flight-procedures:v1";
  const defaults = {version:1,member:2,deadline:360};
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch {}
  const configurations = saved?.configurations ?? {};
  const tasks = Array.isArray(saved?.tasks) ? saved.tasks : [];
  let nextCase = Number.isSafeInteger(saved?.nextCase) ? saved.nextCase : 1;
  function persist() {
    try { localStorage.setItem(key,JSON.stringify({configurations,tasks,nextCase})); } catch {}
  }
  function settings(mode, procedure="shift") {
    const key = procedure === "shift" ? mode : mode+":"+procedure;
    return configurations[key] ?? {...defaults,member:flightProcedures[procedure].members[0]};
  }
  function configure(mode,member,deadline,procedure="shift",repeat=0) {
    if (!flightProcedures[procedure].members.includes(member) || ![180,360,600].includes(deadline) || ![0,300,600].includes(repeat)) return false;
    const key = procedure === "shift" ? mode : mode+":"+procedure;
    configurations[key] = {version:settings(mode,procedure).version+1,member,deadline,repeat};
    persist();
    return true;
  }
  function problem(job) {
    if (job.finishes > job.deadline) return "The job would finish after its deadline.";
    return booked(job);
  }
  function allocate(job) {
    const reason = problem(job);
    if (reason) return reason;
    clear(job.mode,job.queued);
    tasks.push({...job,caseId:job.mode+"-"+nextCase++});
    persist();
    return "";
  }
  function routine(mode,now,start,procedure="shift") {
    const {version,member,deadline} = mode.endsWith("-timed-demo")
      ? {...defaults,member:flightProcedures[procedure].members[0]}
      : settings(mode,procedure);
    const assigned = Math.ceil(now/tick)*tick;
    const definition = flightProcedures[procedure];
    const eva = procedure === "eva";
    const support = eva ? 3 : null;
    return {mode,procedure,version,member,support,deadline:start+deadline,queued:now,assigned,
      arrival:assigned+tick,finishes:assigned+(eva ? 7 : 3)*tick,origin:position(member),
      supportOrigin:eva ? position(support) : null,asset:definition.asset,routine:true,
      action:procedure === "shift" ? "Inspect the scrubber on the routine watch" : definition.name,
      result:definition.steps.at(-1)};
  }
  function clear(mode,after=-1,{save=true}={}) {
    for (let i=tasks.length-1;i>=0;i--) {
      if (tasks[i].mode === mode && tasks[i].queued > after) tasks.splice(i,1);
    }
    if (save) persist();
  }
  function events(job,now) {
    if (job.procedure === "eva") {
      const stages = [[job.assigned+tick,"Buddy and airlock checks"],
        [job.assigned+2*tick,"Exterior transit"],[job.assigned+3*tick,"Antenna service"],
        [job.assigned+5*tick,"Returning to airlock"]];
      return [[job.queued,"Released · suit-up assigned"],
        ...stages.filter(([time])=>job.recalledAt == null || time < job.recalledAt),
        [job.recalledAt,"Recall ordered"],
        [job.finishes,"Crew safely inside"],[job.verifiedAt,"Commander verified antenna service"]]
        .filter(([time])=>time != null && time<=now);
    }
    return [[job.queued,"Released"],[job.assigned,"Travelling"],[job.arrival,"Inspection started"],
      [job.finishes,"Result recorded"]].filter(([time])=>time<=now);
  }
  function suit(job,now) {
    const step = Math.floor(Math.max(0,now-job.assigned)/tick);
    const returning = job.recalledAt != null || step >= 5;
    const outer = returning ? now < job.finishes-tick && (job.recalledAt == null ||
      job.recalledAt >= job.assigned+2*tick) : step >= 2;
    const inner = returning ? now >= job.finishes : step === 0;
    return {oxygen:Math.max(0,100-step*8),battery:Math.max(0,100-step*4),
      inner,outer,pressure:outer ? "Vacuum" : inner ? "Cabin" : "Isolated",
      tethered:outer && now < job.finishes};
  }
  function recall(job,now) {
    if (job.procedure !== "eva" || job.recalledAt != null || now >= job.finishes) return;
    job.recalledAt = now;
    job.finishes = Math.min(job.finishes,now+2*tick);
    persist();
  }
  function verify(job,now) {
    if (job.procedure !== "eva" || now < job.finishes || job.recalledAt != null || job.verifiedAt != null) return;
    job.verifiedAt = now;
    persist();
  }
  return {tasks,settings,configure,problem,allocate,routine,clear,events,recall,verify,suit};
}
