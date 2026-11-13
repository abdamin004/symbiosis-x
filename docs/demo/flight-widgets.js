// Single owner for canvas panel placement and lifecycle. Parked panels retain
// their contents and can be recalled without stacking on the active panels.
function createFlightWidgets(overlay, shelf, notice) {
  const gap = 10;
  const entries = [];
  const overlaps = (a, b) => a.x < b.x+b.w+gap && a.x+a.w+gap > b.x
    && a.y < b.y+b.h+gap && a.y+a.h+gap > b.y;
  const clamp = (value, max) => Math.max(0, Math.min(value, max));
  const rect = entry => ({...entry.position,w:entry.panel.offsetWidth,h:entry.panel.offsetHeight});
  let focused = null;

  function place(entry, preferred, occupied) {
    const {w,h} = rect(entry);
    const width = overlay.clientWidth, height = overlay.clientHeight;
    if (!w || !h || w > width || h > height) return false;
    const xs = [preferred.x, gap, width-w-gap, ...occupied.flatMap(r=>[r.x+r.w+gap,r.x-w-gap])];
    const ys = [preferred.y, gap, height-h-gap, ...occupied.flatMap(r=>[r.y+r.h+gap,r.y-h-gap])];
    const points = xs.flatMap(x=>ys.map(y=>({x:clamp(x,width-w),y:clamp(y,height-h),w,h})));
    points.sort((a,b)=>Math.hypot(a.x-preferred.x,a.y-preferred.y)-Math.hypot(b.x-preferred.x,b.y-preferred.y));
    const result = points.find(p=>!occupied.some(r=>overlaps(p,r)));
    if (!result) return false;
    entry.position = {x:result.x,y:result.y};
    Object.assign(entry.panel.style,{left:result.x+"px",top:result.y+"px"});
    return true;
  }

  function refreshShelf() {
    for (const entry of entries) {
      entry.recall.hidden = !entry.wanted || !entry.panel.hidden;
      entry.toggle?.setAttribute("aria-pressed",String(entry.wanted && !entry.panel.hidden));
    }
    shelf.hidden = entries.every(entry=>entry.recall.hidden);
  }

  function layout() {
    const active = entries.filter(entry=>entry.wanted);
    const ordered = [focused,...active.filter(entry=>entry!==focused)].filter(entry=>entry?.wanted);
    const occupied = [];
    for (const entry of ordered) {
      const hadFocus = entry.panel.contains(document.activeElement);
      entry.panel.hidden = false;
      if (place(entry,entry.position ?? entry.preferred(),occupied)) occupied.push(rect(entry));
      else {
        entry.panel.hidden = true;
        if (hadFocus) { entry.recall.hidden = false; shelf.hidden = false; entry.recall.focus(); }
      }
    }
    refreshShelf();
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(()=>{pending=false;layout();});
  }
  const sizes = new ResizeObserver(entries=>{ if (entries.some(e=>!e.target.hidden)) schedule(); });
  sizes.observe(overlay);

  function register(panel, toggle, preferred) {
    const handle = panel.querySelector(".move-widget"), bar = panel.querySelector(".widget-bar");
    const recall = document.createElement("button");
    recall.type = "button";
    recall.textContent = panel.querySelector("h2")?.textContent || "Inspector";
    recall.setAttribute("aria-controls",panel.id);
    recall.hidden = true;
    shelf.append(recall);
    const entry = {panel,toggle,preferred,recall,wanted:!panel.hidden,position:null,trigger:null};
    entries.push(entry);
    sizes.observe(panel);
    toggle?.setAttribute("aria-controls",panel.id);

    function open(trigger) {
      entry.wanted = true;
      entry.trigger = trigger ?? toggle ?? entry.trigger;
      focused = entry;
      layout();
      notice.textContent = entry.panel.hidden ? recall.textContent + " is parked. Recall it from Parked widgets." : "";
    }
    function close() {
      entry.wanted = false;
      entry.panel.hidden = true;
      if (focused===entry) focused=null;
      layout();
      const target = entry.trigger?.closest("[hidden]") ? null : entry.trigger;
      (target ?? toggle ?? document.getElementById("show-inspector"))?.focus();
    }
    function move(x,y) {
      const occupied = entries.filter(other=>other!==entry && !other.panel.hidden).map(rect);
      place(entry,{x,y},occupied);
    }

    recall.addEventListener("click",()=>{open();if (!panel.hidden) handle.focus();});
    toggle?.addEventListener("click",()=>entry.wanted && !panel.hidden ? close() : open(toggle));
    panel.querySelector(".widget-close").addEventListener("click",close);
    let pointer = null;
    bar.addEventListener("pointerdown", event=>{
      if (event.button!==0 || !entry.position || event.target.closest(".widget-close")) return;
      bar.setPointerCapture(event.pointerId);
      pointer={id:event.pointerId,x:event.clientX-entry.position.x,y:event.clientY-entry.position.y};
    });
    bar.addEventListener("pointermove",event=>{
      if (pointer?.id===event.pointerId) move(event.clientX-pointer.x,event.clientY-pointer.y);
    });
    bar.addEventListener("lostpointercapture",()=>{pointer=null;});
    handle.addEventListener("keydown",event=>{
      const offset={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
      if (!offset || !entry.position) return;
      event.preventDefault();
      move(entry.position.x+offset[0],entry.position.y+offset[1]);
    });
    return {open,close};
  }

  return {register,layout,schedule};
}
