function createDockingScene(canvas, caption) {
  const ctx = canvas.getContext("2d");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let frame;
  let scene;
  let distance = 1;
  const stars = Array.from({length:70},(_,i)=>[(i*131+17)%760,(i*i*47+13)%320,i%4===0 ? 1.3 : .65]);
  function box(x,y,w,h,color) {
    ctx.fillStyle = color;
    ctx.fillRect(x,y,w,h);
  }
  function outline(points,fill,stroke) {
    ctx.beginPath();
    points.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath();
    ctx.fillStyle=fill; ctx.fill(); ctx.strokeStyle=stroke; ctx.stroke();
  }
  function paint(gap,phase) {
    ctx.fillStyle="#070d1b";
    ctx.fillRect(0,0,760,320);
    for (const [x,y,size] of stars) box(x,y,size,size,"#b5d1e8");
    const earth = ctx.createRadialGradient(534,565,248,534,565,360);
    earth.addColorStop(0,"#101e3c"); earth.addColorStop(.92,"#244d72"); earth.addColorStop(1,"#87b6d0");
    ctx.fillStyle=earth;
    ctx.beginPath(); ctx.arc(534,565,360,0,Math.PI*2); ctx.fill();

    box(432,126,258,5,"#8f9aab");
    for (const x of [446,511,598,663]) {
      for (const y of [49,145]) {
        box(x,y,31,63,"#293f6b");
        for (let line=0;line<7;line++) box(x+1,y+line*9,29,1,"#7791b0");
        box(x+14,y,2,63,"#af9c73");
      }
    }
    outline([[467,140],[485,131],[611,131],[628,144],[628,174],[610,182],[486,182],[467,172]],
      "#aebdcc","#eef3fa");
    box(501,140,6,35,"#76869b"); box(570,140,6,35,"#76869b");
    box(548,182,30,27,"#92a2b5");
    box(433,148,34,15,"#879aaf"); box(430,145,8,21,"#e1e8ef");
    ctx.font="600 12px system-ui"; ctx.fillStyle="#dceafa"; ctx.fillText("ISS",542,161);
    const nose = 430-gap*190;
    ctx.save();
    ctx.translate(nose,155);
    ctx.rotate(phase === "departure" ? -.16*gap : -.12*gap);
    outline([[-98,-19],[-54,-21],[-18,-12],[-6,-7],[0,-5],[0,5],[-18,12],[-54,21],[-98,19]],
      "#a7bbc9","#ebf1f9");
    box(-88,-19,10,38,"#697c95"); box(-50,-13,16,8,"#21344a"); box(-8,-7,8,14,"#dfebf0");
    ctx.fillStyle="#152337"; ctx.fillText("ASTERIA",-75,7);
    ctx.restore();
    if (phase !== "captured") {
      ctx.setLineDash([3,5]); ctx.strokeStyle="#9ad7d885";
      ctx.beginPath(); ctx.moveTo(nose+7,155); ctx.lineTo(430,155); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function show(next) {
    const identity = next && [next.phase,next.range,next.caption].join(":");
    if (identity === scene) return;
    scene = identity;
    cancelAnimationFrame(frame);
    if (!next) return;
    caption.textContent = next.caption;
    const target = next.range;
    if (motion.matches || next.phase === "held") {
      distance = target;
      paint(distance,next.phase);
      return;
    }
    const from = distance;
    const started = performance.now();
    const duration = next.phase === "departure" ? 1800 : 650;
    function advance(now) {
      const progress = Math.min(1,(now-started)/duration);
      distance = from+(target-from)*(1-(1-progress)**3);
      paint(distance,next.phase);
      if (progress < 1) frame = requestAnimationFrame(advance);
    }
    frame = requestAnimationFrame(advance);
  }
  return {show};
}
