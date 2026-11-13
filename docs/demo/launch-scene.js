// Presentation only. The checkout clock and Commander actions own flight state.
function createLaunchScene(canvas) {
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let phase = "pad", ship = "Asteria", lightStack = false, separated = false, elapsed = 0, burning = false, ignition = null, transition = null, frame;
  let separation = null;
  let previous = {rise:0, drift:0, tilt:0, camera:0, space:0};
  const padPose = previous;
  let daylight = {angle:.8,altitude:.7,light:1};
  const mix = (a,b,t) => a+(b-a)*t;
  const clamp = value => Math.max(0,Math.min(1,value));
  const rand = n => (Math.sin(n*76.91+14.77)*43758.5453%1+1)%1;

  function path(color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fill();
  }
  function rect(color,x,y,w,h) {
    ctx.fillStyle = color;
    ctx.fillRect(x,y,w,h);
  }
  function line(color,width,points) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  function ellipse(color,x,y,rx,ry) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);
    ctx.fill();
  }
  function gradient(x1,y1,x2,y2,stops) {
    const fill = ctx.createLinearGradient(x1,y1,x2,y2);
    stops.forEach(([position,color])=>fill.addColorStop(position,color));
    return fill;
  }

  function sky(w,h,ground,shipX,pose) {
    rect(gradient(0,0,0,h,[[0,"#162536"],[.45,"#495d6b"],[.73,"#9e8581"],[1,"#e9a77e"]]),0,0,w,h);
    const sunX = w*(.5-.4*Math.cos(daylight.angle));
    const sunY = ground-26-daylight.altitude*h*.58+pose.camera*.28;
    const darkness = 1-daylight.light;
    if (darkness > 0) {
      rect("rgba(3,10,31," + darkness*.94 + ")",0,0,w,h);
      for (let i=0;i<75;i++) rect("rgba(209,224,255," + darkness*(.25+rand(i+82)*.7) + ")",
        rand(i+13)*w,rand(i+69)*ground*.94,1.2,1.2);
    }
    const glow = ctx.createRadialGradient(sunX,sunY,4,sunX,sunY,Math.max(w*.43,200));
    glow.addColorStop(0,"#ffc892b3");
    glow.addColorStop(.47,"#f8ae7445");
    glow.addColorStop(1,"#e9917600");
    if (daylight.altitude > -.1) {
      ctx.save();
      ctx.globalAlpha=daylight.light;
      rect(glow,0,0,w,h);
      ellipse("#fff0b6",sunX,sunY,Math.min(19,w*.03),Math.min(19,w*.03));
      ctx.restore();
    }
    for(let i=0;i<29;i++) {
      const x=((rand(i+21)+daylight.angle*.029)%1)*w, y=h*(.28+rand(i+57)*.43)+pose.camera*.33;
      const length=25+rand(i+82)*w*.18;
      path(i%3===0?"#ffd9b22c":"#ffe3c217",[[x-length,y+3],[x,y],[x+length*.6,y+2],[x+length,y+6],[x-length*.18,y+7]]);
    }
    if (pose.space>0) {
      ctx.save();
      ctx.globalAlpha=pose.space;
      rect(gradient(0,0,0,h,[[0,"#03091a"],[.8,"#16263e"],[1,"#3b617c"]]),0,0,w,h);
      for(let i=0;i<110;i++) rect(i%7===0?"#dae8ff":"#8d9ebd",rand(i+13)*w,rand(i+69)*h*.9,i%7===0?1.8:1,1);
      if(phase==="upper") {
        const earth=gradient(0,h*.7,0,h,[[0,"#adcde0"],[.11,"#345e7d"],[1,"#172e52"]]);
        ellipse(earth,w*.47,h*1.35,w*.89,h*.66);
      }
      ctx.restore();
    }
  }

  function terrain(w,h,ground,x) {
    const horizon=ground-61;
    path("#535968",[[0,horizon],[w*.10,horizon-18],[w*.19,horizon-53],[w*.22,horizon-56],[w*.36,horizon-20],[w*.47,horizon-37],[w*.54,horizon-27],[w*.63,horizon-5],[w*.73,horizon-23],[w*.88,horizon-58],[w,horizon-13],[w,h],[0,h]]);
    path("#68717b",[[0,horizon],[w*.19,horizon-53],[w*.22,horizon-56],[w*.29,horizon-39],[w*.22,horizon-41],[w*.19,horizon-33],[w*.12,horizon-18]]);
    path("#263644",[[0,horizon+8],[w*.16,horizon-6],[w*.26,horizon+10],[w*.39,horizon+6],[w*.50,horizon+15],[w*.69,horizon+5],[w*.79,horizon+11],[w*.91,horizon-8],[w,horizon-6],[w,h],[0,h]]);
    path(gradient(0,ground-33,0,h,[[0,"#35434c"],[1,"#111c29"]]),[[0,ground-20],[w*.25,ground-32],[w*.51,ground-23],[w*.81,ground-38],[w,ground-28],[w,h],[0,h]]);
    for(let i=0;i<115;i++) {
      const y=ground-22+rand(i+390)*(h-ground+24);
      const rockX=rand(i+255)*w;
      rect(i%3?"#84919130":"#08132065",rockX,y,2+rand(i+512)*(2+Math.max(0,y-ground)*.11),1.2);
    }
    path("#151f2a",[[x-128,ground-4],[x+105,ground-4],[x+286,h],[x-358,h]]);
    path(gradient(0,ground,0,ground+74,[[0,"#778083"],[.18,"#47545d"],[1,"#26313b"]]),[[x-142,ground],[x+128,ground],[x+202,ground+50],[x-208,ground+50]]);
    line("#f1bd7c",2,[[x-142,ground],[x+128,ground]]);
    line("#8b9392",1,[[x-192,ground+43],[x+189,ground+43]]);
    for(let i=-5;i<6;i++) line("#98a09a51",1,[[x+i*23,ground+3],[x+i*35,ground+43]]);
    line("#e7b377",2,[[x-25,ground+13],[x+25,ground+13]]);
    line("#e7b377",2,[[x-32,ground+26],[x+32,ground+26]]);
    for(const offset of [-135,-95,96,131]) {
      ellipse("#f5ac7c21",x+offset,ground+11,14,7);
      rect("#ffc894",x+offset-3,ground+8,6,2);
    }
    for(const offset of [-205,168]) {
      rect("#1d2a36",x+offset,ground-38,46,17);
      rect("#58616a",x+offset-3,ground-39,52,3);
      for(let i=0;i<3;i++) rect("#dba77f",x+offset+6+i*10,ground-34,4,2);
    }
    // The service road, hangar and tank farm give the launch complex a readable scale.
    path("#252e34",[[x-380,ground-21],[x-166,ground-20],[x-145,ground-10],[x-412,ground-11]]);
    for (let i=0;i<7;i++) rect("#b9a780",x-374+i*28,ground-16,11,1);
    const hangar = x-282;
    path("#5b6870",[[hangar,ground-39],[hangar+15,ground-68],[hangar+68,ground-68],[hangar+83,ground-39]]);
    rect("#303e49",hangar,ground-40,83,26);
    rect("#192839",hangar+20,ground-38,40,24);
    for (let i=0;i<4;i++) rect("#5c7182",hangar+21,ground-34+i*5,38,1);
    rect("#c1aa80",hangar+36,ground-50,12,2);
    for (const offset of [234,269,304]) {
      const tank = x+offset;
      rect(gradient(tank,0,tank+25,0,[[0,"#425460"],[.5,"#93a0a1"],[1,"#3d4e57"]]),tank,ground-41,25,25);
      ellipse("#a6afb0",tank+12.5,ground-41,12.5,4);
      line("#a6a28b",1,[[tank+25,ground-22],[tank+30,ground-22],[tank+30,ground-11]]);
    }
    line("#68808c",2,[[x+145,ground-11],[x+338,ground-11]]);
  }

  function gantry(x,y,s,away) {
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(s,s);
    rect("#172637",-85,-247,21,247);
    rect("#64717a",-86,-248,3,248);
    rect("#46515c",-65,-247,3,247);
    for(let i=0;i<10;i++) {
      const a=-i*24;
      line("#566673",2,[[-84,a-1],[-65,a-23],[-84,a-23]]);
    }
    rect("#273542",-91,-253,33,6);
    rect("#536674",-78,-274,3,21);
    ellipse("#ff9875",-76,-274,2,2);
    const reach=28*(1-away);
    for(const level of [-179,-103]) {
      rect("#344652",-65,level,9+reach,8);
      rect("#a4a19a",-65,level,9+reach,1);
    }
    rect("#26313e",-96,-5,41,5);
    for (const level of [-200,-152,-104,-56]) {
      rect("#77848c",-89,level,30,3);
      rect("#ffcd91",-90,level-2,4,2);
    }
    ctx.restore();
  }

  function rocket(x,y,s,pose,now,thrust) {
    ctx.save();
    ctx.translate(x+pose.drift*s,y-pose.rise*s+pose.camera);
    ctx.scale(s,s);
    ctx.rotate(pose.tilt);
    if(thrust) {
      const upper = phase === "upper";
      const nozzleY = upper ? -121 : 0;
      const length=(upper ? 45 : 86)+Math.sin(now*.051)*8+Math.sin(now*.032)*6;
      ctx.save();
      ctx.translate(0,nozzleY);
      const glow=ctx.createRadialGradient(0,-4,2,0,15,65);
      glow.addColorStop(0,"#fff5dcae");
      glow.addColorStop(.35,"#ff9b5566");
      glow.addColorStop(1,"#f16c4700");
      ellipse(glow,0,15,63,65);
      path(gradient(0,0,0,length,[[0,"#fff4bc"],[.38,"#ffc078"],[1,"#ff754500"]]),[[-12,-5],[12,-5],[14,length*.38],[7,length*.67],[0,length],[-10,length*.66],[-16,length*.38]]);
      path(gradient(0,0,0,length*.7,[[0,"#fff"],[.55,"#ffedbc"],[1,"#ffd08800"]]),[[-7,0],[7,0],[6,length*.39],[0,length*.72],[-6,length*.41]]);
      ctx.restore();
    }
    const alloy=gradient(-22,0,22,0,[[0,"#8d9fac"],[.24,"#c6d1d6"],[.54,"#edf0eb"],[.77,"#d0cebf"],[1,"#7a8791"]]);
    if(!separated || pose.booster<1) {
      ctx.save();
      ctx.translate(-72*pose.booster,215*pose.booster**1.25);
      ctx.rotate(-.62*pose.booster);
      path("#445362",[[-19,-34],[-30,-12],[-30,-6],[-13,-10],[13,-10],[30,-6],[30,-12],[19,-34]]);
      path("#283846",[[-14,-14],[14,-14],[17,-2],[10,0],[-10,0],[-17,-2]]);
      rect(alloy,-21,-132,42,117);
      rect("#4b5d67",-21,-132,42,5);
      rect("#172936",-21,-27,42,12);
      rect("#cd6d46",-21,-112,42,11);
      rect("#fbab70",-16,-111,16,2);
      rect("#84939a",15,-98,3,64);
      rect("#758490",-19,-72,5,28);
      rect("#5d6e7a",-3,-47,8,17);
      rect("#a4aeb0",-1,-46,2,14);
      ctx.font="700 7px system-ui";
      ctx.fillStyle="#273e4c";
      ctx.fillText("01",-14,-78);
      for (const level of [-108,-92,-57,-30]) line("#576976",.7,[[-21,level],[21,level]]);
      ctx.restore();
    }
    path(alloy,[[-21,-130],[-21,-202],[-16,-215],[-16,-222],[-9,-238],[-3,-243],[-3,-260],[3,-260],[3,-243],[9,-238],[16,-222],[16,-215],[21,-202],[21,-130]]);
    path("#243b4f",[[-14,-222],[-10,-231],[8,-231],[13,-222],[11,-217],[-11,-217]]);
    line("#6eabc3",1.6,[[-10,-223],[-7,-227],[6,-227],[9,-223]]);
    rect("#3f5160",-21,-204,42,6);
    rect("#b96045",-21,-189,42,7);
    rect("#677c86",-14,-170,5,22);
    rect("#586b76",11,-154,5,15);
    rect("#33444e",-20,-135,40,4);
    line("#e0e5e6",1,[[-18,-201],[-18,-137]]);
    ctx.font="700 7px system-ui";
    ctx.fillStyle="#253d4d";
    ctx.fillText(ship.toUpperCase(),-16,-179);
    if(separated) {
      path("#414d58",[[-10,-132],[10,-132],[14,-121],[-14,-121]]);
      if (pose.booster > 0 && pose.booster < .52) {
        const spread = pose.booster*70;
        for (let i=0;i<14;i++) {
          const alpha = Math.max(0,1-2*pose.booster);
          ellipse(`rgba(234,234,220,${alpha*.4})`,(rand(i+100)-.5)*spread,-128+rand(i+120)*spread,2+i%4,2+i%3);
        }
      }
    }
    ctx.restore();
  }

  function poseFor() {
    if(phase==="pad") return {...padPose,booster:0};
    if(phase==="ascent") return {rise:100+elapsed*2.6,drift:Math.min(43,elapsed*.7),tilt:Math.min(.17,elapsed*.003),camera:32+elapsed*2.3,space:Math.min(.67,elapsed/86),booster:0};
    if(phase==="abort") return {rise:190,drift:-37,tilt:-.24,camera:106,space:.24,booster:Number(separated)};
    return {rise:250,drift:34,tilt:.78,camera:128,space:1,booster:1};
  }

  function draw(now) {
    const w=canvas.clientWidth, h=canvas.clientHeight;
    if(!w || !h) return;
    const dpr=Math.min(devicePixelRatio || 1,2);
    if(canvas.width!==Math.round(w*dpr) || canvas.height!==Math.round(h*dpr)) {
      canvas.width=Math.round(w*dpr);
      canvas.height=Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const target=poseFor();
    const t=transition ? clamp((now-transition.start)/transition.duration) : 1;
    const ease=phase==="ascent" && elapsed===0 ? t*t*(3-2*t) : 1-(1-t)**3;
    const pose=Object.fromEntries(Object.keys(target).map(key=>[key,mix(transition?.from[key]??target[key],target[key],ease)]));
    previous=pose;
    const shipX=w*(w<610?.63:.66), ground=h*.79, s=Math.min(h/605,1.48);
    if (separation !== null) pose.booster = clamp((now-separation)/1250);
    const upperBurn = phase === "upper" && separation !== null && now-separation > 450 && now-separation < 1500;
    const thrust=phase==="ascent" && burning || upperBurn;
    sky(w,h,ground,shipX,pose);
    if(pose.space<1) {
      ctx.save();
      ctx.globalAlpha=1-pose.space;
      terrain(w,h,ground+pose.camera,shipX);
      gantry(shipX,ground+pose.camera,s,clamp(pose.rise/60));
      if(daylight.light<1) rect("rgba(4,12,35,"+(1-daylight.light)*.35+")",0,ground+pose.camera-60,w,h-ground+60);
      ctx.restore();
    }
    rocket(shipX,ground,lightStack ? s*.77 : s,pose,reduced.matches?0:now,thrust);
    if(ignition!==null && phase==="ascent" && !reduced.matches) {
      const age=(now-ignition)/1000;
      if(age<4) {
        for(let i=0;i<40;i++) {
          const life=clamp((age-rand(i+430)*.53)/3.35);
          if(life===0 || life===1) continue;
          const x=shipX+(rand(i+315)-.5)*s*(32+life*358);
          const y=ground+pose.camera+s*(4-life*(9+rand(i+212)*58));
          ellipse(`rgba(204,185,170,${Math.sin(life*Math.PI)*.2})`,x,y,s*(6+life*41),s*(3+life*23));
        }
      }
    }
    if(t===1) transition=null;
    if(!reduced.matches && (transition || thrust || separation!==null && now-separation<1500 ||
        (ignition!==null && now-ignition<4000))) frame=requestAnimationFrame(draw);
  }

  function show(next,animate) {
    const changed=phase!==next.phase || elapsed!==next.elapsed || separated!==next.separated;
    const lift=phase==="pad" && next.phase==="ascent" && next.elapsed===0;
    const staging=!separated && next.separated;
    phase=next.phase;
    ship=next.ship;
    lightStack=next.lightStack;
    separated=next.separated;
    elapsed=next.elapsed;
    burning=next.burning;
    const now=performance.now();
    if (staging && animate && !reduced.matches) separation=now;
    if (!separated || !animate || reduced.matches) separation=null;
    if(changed || !animate) {
      const motion=animate && !reduced.matches;
      transition=motion ? {start:now,from:previous,duration:lift?2600:820} : null;
      if(lift && motion) ignition=now;
      if(phase!=="ascent" || !motion) ignition=null;
    }
    refresh();
  }
  function refresh() {
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(draw);
  }
  new ResizeObserver(refresh).observe(canvas);
  reduced.addEventListener("change",()=>{transition=null; ignition=null; refresh();});
  return {show,setSky(light) {
    daylight = light;
    refresh();
  }};
}
