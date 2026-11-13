// Synthetic food safety workflow. This records training events on the mission clock.
function createGalleyHygiene(start, tick, crewCount) {
  const interval = 8 * 3600;
  const surfaces = new Map([
    ["worktop", {name:"Galley work surfaces"}],
    ["utensils", {name:"Shared eating tools"}],
    ["latches", {name:"High-touch storage latches"}],
  ]);
  const audit = [];
  let incident = null;
  let waterLot = null;
  const meals = [];
  for (const surface of surfaces.values()) {
    surface.due = start + interval;
    surface.nextCleaning = surface.due;
  }

  function record(order, event, detail) {
    audit.push({time:order.time, member:order.member, event, detail});
  }

  function logMeal(member, time) {
    meals.push({member, time, batch:incident ? "Horizon meal lot B" : "Horizon meal lot A"});
  }

  function apply(order, ledger) {
    if (!Number.isInteger(order.member) || order.member < 0 || order.member >= crewCount) return;
    if (order.action === "hold-water" && !waterLot && ledger.stock.potable > 0) {
      const heldMl = Math.min(500, ledger.stock.potable);
      ledger.stock.potable -= heldMl;
      waterLot = {heldMl, heldAt:order.time, member:order.member};
      record(order, "Potable water lot isolated", "Horizon water lot A");
      return;
    }
    if (order.action === "clear-water" && canClearWater(order.member,order.time)) {
      ledger.stock.potable += waterLot.heldMl;
      waterLot.releasedAt = order.time;
      record(order, "Potable water lot verified and released", "Horizon water lot A");
      return;
    }
    const surface = surfaces.get(order.target);
    if (!surface) return;
    if (order.action === "inspect") {
      if (surface.job || surface.verification || surface.held) return;
      surface.inspected = order.time;
      surface.due = order.time + interval;
      record(order, "Inspection recorded", surface.name);
    } else if (order.action === "suspect") {
      if (order.target !== "worktop" || incident || surface.job || surface.verification) return;
      const batch = "Horizon meal lot A";
      const heldPacks = Math.min(2, ledger.stock.meals);
      ledger.stock.meals -= heldPacks;
      incident = {batch, time:order.time, heldPacks, observation:"Possible bacterial contamination · simulated inspection flag",
        meals:meals.filter(meal=>meal.batch === batch), reports:[], review:null};
      surface.held = true;
      record(order, "Placed on hold", incident.batch + " and " + surface.name);
    } else if (order.action === "clean" || order.action === "disinfect") {
      if (activeJob(order.member,order.time) || surface.job || surface.verification || Boolean(surface.held) !== (order.action === "disinfect")) return;
      surface.job = {action:order.action, member:order.member, due:order.time + 2*tick};
      record(order, order.action === "disinfect" ? "Disinfection assigned" : "Cleaning assigned", surface.name);
    } else if (["pass", "fail"].includes(order.action) && surface.verification && surface.verification.member !== order.member) {
      surface.verification = null;
      if (order.action === "pass") {
        surface.held = false;
        surface.verified = "Passed";
        surface.inspected = order.time;
        surface.due = order.time + interval;
        record(order, "Verification passed · surface released", surface.name);
      } else {
        surface.held = true;
        surface.verified = "Failed";
        record(order, "Verification failed · hold maintained", surface.name);
      }
    } else if (order.action === "report" && incident && incident.review?.rechecked == null) {
      if (!Object.hasOwn(symptoms,order.symptom) || !incident.meals.some(meal=>meal.member === order.member) ||
          incident.reports.some(report=>report.member === order.member)) return;
      incident.reports.push({member:order.member, symptom:symptoms[order.symptom], time:order.time});
    } else if (order.action === "review" && incident?.reports.length && !incident.review) {
      incident.review = {member:order.member,time:order.time,recheckDue:order.time + 4*tick};
    } else if (order.action === "recheck" && incident?.review && order.time >= incident.review.recheckDue) {
      incident.review.rechecked ??= order.time;
    } else if (order.action === "share" && incident?.review?.rechecked != null && !incident.relay) {
      incident.relay = {deliverAt:order.time + 300, status:"Food safety review complete · affected meal lot remains isolated"};
    }
  }

  const symptoms = {nausea:"Nausea reported", stomach:"Stomach discomfort reported", none:"No symptoms reported"};

  function canClearWater(member, time) {
    return waterLot && waterLot.releasedAt == null && waterLot.member !== member && time >= waterLot.heldAt + tick;
  }

  function finishDue(time) {
    for (const surface of surfaces.values()) {
      const job = surface.job;
      if (!job || job.due > time) continue;
      surface.job = null;
      surface.completed = job.due;
      surface.nextCleaning = job.due + interval;
      surface.verification = {member:job.member};
      record({time:job.due, member:job.member}, "Work completed · verification pending", surface.name);
    }
  }

  function scheduleRoutine(member, time) {
    if (member !== 0 || [...surfaces.values()].some(surface=>surface.job || surface.verification)) return null;
    const due = [...surfaces].find(([,surface])=>time >= surface.nextCleaning && !surface.held && !surface.verification);
    if (!due) return null;
    apply({action:"clean", target:due[0], member, time});
    return activeJob(member,time);
  }

  function status(surface, time) {
    if (surface.job) return surface.held ? "Held · disinfection in progress" : "Cleaning in progress";
    if (surface.verification) return surface.held ? "Held · verification due" : "Verification due";
    if (surface.held) return "Held · disinfection due";
    if (surface.inspected == null || time >= surface.due) return "Cleanliness unknown · inspection due";
    return "Inspection recorded";
  }

  function prepareHeld() {
    return ["worktop", "utensils"].some(target => {
      const surface = surfaces.get(target);
      return surface.held || surface.job || surface.verification;
    });
  }

  function activeJob(member, time) {
    for (const [target, surface] of surfaces) {
      const job = surface.job;
      if (job?.member === member && time >= job.due - 2*tick && time < job.due) {
        return {...job, target, asset:"galley", action:job.action === "clean" ? "Clean galley" : "Disinfect galley",
          assigned:job.due - 2*tick, arrival:job.due - tick, finishes:job.due};
      }
    }
    return null;
  }

  return {surfaces, audit, apply, finishDue, logMeal, status, prepareHeld, activeJob, scheduleRoutine, canClearWater,
    incident:() => incident, waterLot:() => waterLot};
}
