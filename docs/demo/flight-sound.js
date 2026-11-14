// Copyright-free, synthesized mission sounds. UI only; never drives mission state.
// A user click enables playback under browser audio autoplay policy.
function installFlightSoundEffects() {
  const toggle=document.getElementById("flight-audio");
  if (!toggle) return;
  let enabled=true,ctx=null;
  toggle.hidden=false;
  toggle.textContent="🔊 Sounds on";
  toggle.setAttribute("aria-label","Mute mission sound effects");
  toggle.setAttribute("aria-pressed","true");
  toggle.title="Toggle original synthesized launch and mission effects";
  const getContext=()=>{
    try {
      const Engine=window.AudioContext || window.webkitAudioContext;
      if (!Engine) return null;
      ctx ??=new Engine();
      if (ctx.state==="suspended") void ctx.resume();
      return ctx;
    } catch {return null;}
  };
  function tone(frequency,duration,kind="sine",volume=.075,slide=1) {
    if (!enabled) return;
    const ac=getContext();
    if (!ac) return;
    const start=ac.currentTime+.005;
    const osc=ac.createOscillator(),gain=ac.createGain();
    osc.type=kind;
    osc.frequency.setValueAtTime(frequency,start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20,frequency*slide),start+duration);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),start+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);osc.stop(start+duration+.02);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function noise(duration,volume=.1,cutoff=190) {
    if (!enabled) return;
    const ac=getContext();
    if (!ac) return;
    const count=Math.min(Math.ceil(ac.sampleRate*duration),ac.sampleRate*5);
    const buffer=ac.createBuffer(1,count,ac.sampleRate);
    const channel=buffer.getChannelData(0);
    for(let i=0;i<count;i++) channel[i]=Math.random()*2-1;
    const src=ac.createBufferSource(),filter=ac.createBiquadFilter(),gain=ac.createGain();
    src.buffer=buffer;filter.type="lowpass";filter.frequency.value=cutoff;
    const t=ac.currentTime+.005;
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.linearRampToValueAtTime(volume,t+Math.min(.55,duration*.22));
    gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t);src.stop(t+duration+.02);
    src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
  }
  function effect(id) {
    if (!enabled) return;
    if (id==="launch-go") {
      // Engine ignition: bass rumble and air plume, then a short ascent swell.
      noise(3.4,.18,260);tone(48,3.3,"sawtooth",.085,1.9);
      tone(84,2.6,"triangle",.045,1.5);
    } else if (id==="launch-separate") {
      noise(.5,.13,950);tone(180,.45,"triangle",.055,.5);
    } else if (["launch-insert","launch-phasing","launch-match"].includes(id)) {
      noise(1.1,.08,520);tone(90,1.0,"sawtooth",.045,1.4);
    } else if (["launch-capture","launch-dock"].includes(id)) {
      tone(420,.18,"sine",.065,1.2);tone(660,.32,"sine",.04,1.15);
    } else if (["launch-abort","show-flight-emergency"].includes(id)) {
      tone(490,.18,"triangle",.055,1.4);tone(680,.3,"triangle",.045,.72);
    } else if (["next-event","step","checkpoint-advance","show-inspector","show-crew","show-workflow"].includes(id)) {
      tone(450,.07,"sine",.022,1.2);
    } else if (id==="launch-coast" || id==="launch-research") {
      tone(540,.14,"sine",.045,1.5);
    }
  }
  toggle.addEventListener("click",()=>{
    enabled=!enabled;
    toggle.textContent=enabled?"🔊 Sounds on":"🔇 Sounds off";
    toggle.setAttribute("aria-label",enabled?"Mute mission sound effects":"Enable mission sound effects");
    toggle.setAttribute("aria-pressed",String(enabled));
    if (enabled) tone(600,.11,"sine",.03,1.3);
  });
  document.addEventListener("click",event=>{
    const button=event.target.closest("button");
    if (button && button!==toggle) effect(button.id);
  },true);
}
installFlightSoundEffects();
