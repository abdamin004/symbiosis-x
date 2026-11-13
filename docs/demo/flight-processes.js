// Flight rehearsal procedures derived from Mission Operations and Mission Control Design.
const flightProcedures = {
  shift: {name:"Life Support watch",source:"Plan and start a shift · W2 Crew work and activity",
    steps:["Commander releases inspection","Crew travels to scrubber","Crew inspects equipment","Inspection result recorded"]},
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
  function settings(mode) { return configurations[mode] ?? defaults; }
  function configure(mode,member,deadline) {
    if (![0,2].includes(member) || ![180,360,600].includes(deadline)) return false;
    configurations[mode] = {version:settings(mode).version+1,member,deadline};
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
  function routine(mode,now,start) {
    const {version,member,deadline} = settings(mode);
    const assigned = Math.ceil(now/tick)*tick;
    return {mode,version,member,deadline:start+deadline,queued:now,assigned,
      arrival:assigned+tick,finishes:assigned+3*tick,origin:position(member),asset:"scrubber",routine:true,
      action:"Inspect the scrubber on the routine watch",result:"Routine scrubber check recorded"};
  }
  function clear(mode,after=-1) {
    for (let i=tasks.length-1;i>=0;i--) {
      if (tasks[i].mode === mode && tasks[i].queued > after) tasks.splice(i,1);
    }
    persist();
  }
  function events(job,now) {
    return [[job.queued,"Released"],[job.assigned,"Travelling"],[job.arrival,"Inspection started"],
      [job.finishes,"Result recorded"]].filter(([time])=>time<=now);
  }
  return {tasks,settings,configure,problem,allocate,routine,clear,events};
}
