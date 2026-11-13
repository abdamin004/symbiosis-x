// Deterministic, local Flight gameplay. These needs are game meters, independent of vitals.
function createCrewRoutines({count,tick,occupied,rules}) {
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

  function applyCommands(session,campaign,time) {
    for (const event of campaign.commands) {
      if (event.time > time || session.appliedProvisionCommands?.has(event.id)) continue;
      const returned = campaign.departure != null && event.time >= campaign.departure;
      const ledger = session.ledgers[returned || event.action === "replenish" ? "returned" : "outbound"];
      ledger.commit(event.id,event.action,"routine",{
        time:event.time,power:remainingPower(session,campaign,event.time),
        stationReceipt:campaign.transferAt != null && event.time>=campaign.transferAt && !returned,
      });
      (session.appliedProvisionCommands ??= new Set()).add(event.id);
    }
  }

  function remainingPower(session,campaign,time) {
    const loads = {meal:rules.load_kw.prepare_meal,hygiene:rules.load_kw.hygiene};
    const committed = session.crew.reduce((sum,person)=>{
      const job = person.active;
      return sum + (job && job.arrival<=time && time<job.finishes ? loads[job.need?.id] ?? 0 : 0);
    },0);
    return Math.max(0,campaign.powerAt(time)-committed);
  }

  function update(mode,start,now,revision,campaign) {
    let session = sessions.get(mode);
    if (!session || session.start !== start || session.revision !== revision || now < session.time) {
      session = {...create(start),start,revision};
      if (campaign) session.ledgers = {
        outbound:createFlightProvisions(rules,campaign.vehicle),
        returned:createFlightProvisions(rules,"return-capsule"),
      };
      sessions.set(mode,session);
    }
    for (let time = session.time+tick; time <= now; time += tick) {
      const ledger = session.ledgers?.[campaign.departure != null && time>=campaign.departure ? "returned" : "outbound"];
      const power = campaign ? remainingPower(session,campaign,time) : 0;
      const reserved = new Set();
      const remaining = {...session.supplies};
      session.crew.forEach((person,member)=>{
        const job = person.active;
        if (!job) return;
        if (time >= job.finishes) {
          if (job.need) {
            const operation = {meal:"prepare_meal",water:"drink",hygiene:"hygiene"}[job.need.id];
            const reason = ledger && operation ? ledger.commit("crew-"+member+"-"+job.assigned,operation,
              job.activity,{time,power}) : null;
            if (!reason) person.refreshed[job.need.id] = job.finishes;
            else person.provisionHold = reason;
            if (!ledger && job.need.stock) {
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
          if (!ledger && job.need?.stock) remaining[job.need.stock] -= job.need.cost;
        }
      });
      session.crew.forEach((person,member)=>{
        person.blocked = person.provisionHold ?? "";
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
            if (!ledger && partner.active.need?.stock) remaining[partner.active.need.stock] += partner.active.need.cost;
            partner.active = null;
          }
          person.active = {asset:"lab",action:"Daily crew checkup",checkup:patient,previous:person.previous,
            patientPrevious:partner.previous,assigned:time,arrival:time+travel,finishes:time+travel+180};
          reserved.add("lab");
          return;
        }
        const activity = person.previous === "bed" ? "rest" : person.previous ? "working" : "routine";
        const need = urgent.find(({need})=>available(need.asset) && (ledger
          ? need.id === "rest" ||
            need.id === "meal" && ledger.stock.meals > 0 && power >= rules.load_kw.prepare_meal &&
              ledger.stock.potable >= ledger.cost("prepare_meal",activity) ||
            need.id === "water" && ledger.stock.potable >= ledger.cost("drink",activity) ||
            need.id === "hygiene" && ledger.ration === "standard" && power >= rules.load_kw.hygiene &&
              ledger.stock.potable >= rules.hygiene_ml
          : !need.stock || remaining[need.stock] >= need.cost))?.need;
        const routine = duties[member][person.rotation%duties[member].length];
        if (!need && urgent.length) {
          const first = urgent[0].need;
          person.blocked = person.provisionHold ?? (ledger && first.id === "hygiene" && ledger.ration === "conserve"
            ? "Hygiene deferred by conservation" : first.label + " waiting for a free station or supplies");
        }
        const asset = need?.asset ?? routine[0];
        if (!available(asset)) return;
        if (need) person.provisionHold = null;
        person.active = {asset,action:need?.action ?? routine[1],need,activity,previous:person.previous,
          assigned:time,arrival:time+travel,finishes:time+travel+(need?.duration ?? 120+member*tick)};
        reserved.add(asset);
        if (!ledger && need?.stock) remaining[need.stock] -= need.cost;
      });
      if (ledger) applyCommands(session,campaign,time);
      session.time = time;
    }
    if (session.ledgers) {
      applyCommands(session,campaign,now);
      session.provisions = session.ledgers[campaign.departure != null && now>=campaign.departure ? "returned" : "outbound"];
      session.supplies = {meals:session.provisions.stock.meals,water:session.provisions.stock.potable/1000};
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
function createFlightProvisions(rules, vehicle) {
  const [potable,reserve,meals] = rules.stores[vehicle];
  const stock = {potable,reserve,meals,waste:0,held:0,rejected:0,used:0};
  const receipts = new Map();
  let ration = "standard";
  let transferAccepted = false;
  let qualityAt = null;

  function cost(action, activity) {
    if (action === "drink") return rules.drink_ml[activity];
    if (action === "prepare_meal") return rules.meal_ml[ration];
    if (action === "hygiene") return rules.hygiene_ml;
    return 250;
  }

  function consume(action, activity) {
    const amount = cost(action,activity);
    if (action === "hygiene" && ration === "conserve") return "Hygiene deferred by conservation";
    if (action === "prepare_meal" && stock.meals === 0) return "No meal packs available";
    if (stock.potable < amount) return "Potable water shortage";
    const waste = action === "drink" ? Math.floor(amount/2) : action === "hygiene" ? rules.hygiene_waste_ml : 0;
    stock.potable -= amount;
    stock.waste += waste;
    stock.used += amount-waste;
    if (action === "prepare_meal") stock.meals--;
    return null;
  }

  function apply(action, activity, evidence) {
    if (rules.load_kw[action] > evidence.power) return "Power headroom too low";
    if (["drink","prepare_meal","hygiene","oxygen_generation"].includes(action)) return consume(action,activity);
    if (action === "standard" || action === "conserve") ration = action;
    if (action === "release_reserve") {
      if (!stock.reserve) return "Reserve exhausted";
      const amount = Math.min(stock.reserve,500);
      stock.reserve -= amount;
      stock.potable += amount;
    }
    if (action === "treat") {
      if (!stock.waste) return "No wastewater available";
      const produced = Math.floor(stock.waste*rules.treatment_yield_percent/100);
      stock.held += produced;
      stock.rejected += stock.waste-produced;
      stock.waste = 0;
      qualityAt = evidence.time+15;
    }
    if (action === "verify" || action === "reject") {
      if (!stock.held) return "No treatment batch held";
      if (action === "verify" && evidence.time < qualityAt) return "Quality verification pending";
      stock[action === "verify" ? "potable" : "rejected"] += stock.held;
      stock.held = 0;
      qualityAt = null;
    }
    if (action === "replenish") {
      if (!evidence.stationReceipt) return "Station transfer receipt required";
      if (transferAccepted) return "Station receipt already used";
      stock.potable += rules.transfer_ml;
      transferAccepted = true;
    }
    return null;
  }

  function commit(id, action, activity, evidence) {
    if (!receipts.has(id)) receipts.set(id,{action, reason:apply(action,activity,evidence)});
    return receipts.get(id).reason;
  }
  return {stock, receipts, cost, commit, get ration() { return ration; }};
}
