// The race screen's sounds, made with Web Audio (no files): the crowd, the bugle at the start,
// hooves on a surge, the bell for the final furlong, a cheer at the finish. A browser plays
// nothing until someone clicks the page (unlock), and nothing while muted.
let ctx = null;
let master = null;
let crowd = null;
let muted = false;

export const soundReady = () => Boolean(ctx && ctx.state === "running");

// On a click: the browser allows sound from then on.
export async function unlock() {
  if (!ctx) {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return false;
    ctx = new Context();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  return soundReady();
}

export function setMuted(value) {
  muted = Boolean(value);
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
}

function noiseBuffer(seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function tone(freq, start, length, { type = "triangle", gain = 0.18, attack = 0.02 } = {}) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.setValueAtTime(gain, start + Math.max(attack, length - 0.06));
  env.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

// The call to the post: a brassy run up and a held top note.
export function bugle() {
  if (!soundReady()) return;
  const notes = [
    [392, 0.16], [523, 0.16], [659, 0.16], [784, 0.34],
    [659, 0.16], [784, 0.16], [659, 0.16], [523, 0.34],
    [659, 0.16], [784, 0.16], [1047, 0.7],
  ];
  let t = ctx.currentTime + 0.05;
  for (const [freq, length] of notes) {
    tone(freq, t, length * 0.92, { type: "sawtooth", gain: 0.07 });
    tone(freq, t, length * 0.92, { type: "square", gain: 0.035 });
    t += length;
  }
}

// A burst of hooves: a gallop's three-beat rhythm, a few times over.
export function hooves(times = 3) {
  if (!soundReady()) return;
  const buffer = noiseBuffer(0.1);
  let t = ctx.currentTime + 0.02;
  for (let i = 0; i < times; i++) {
    for (const offset of [0, 0.07, 0.14]) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 320 + Math.random() * 120;
      band.Q.value = 1.4;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.5, t + offset);
      env.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.07);
      src.connect(band).connect(env).connect(master);
      src.start(t + offset);
      src.stop(t + offset + 0.09);
    }
    t += 0.38;
  }
}

// A stumble: a low "whoa" thud.
export function thud() {
  if (!soundReady()) return;
  const t = ctx.currentTime + 0.02;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.3);
  env.gain.setValueAtTime(0.3, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + 0.4);
}

// The bell: three rings.
export function bell() {
  if (!soundReady()) return;
  for (let i = 0; i < 3; i++) {
    const t = ctx.currentTime + 0.05 + i * 0.45;
    for (const [freq, gain] of [[880, 0.18], [1320, 0.08], [2210, 0.04]]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      env.gain.setValueAtTime(gain, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + 1.25);
    }
  }
}

// A small chime: a badge.
export function chime() {
  if (!soundReady()) return;
  const t = ctx.currentTime + 0.02;
  tone(1319, t, 0.12, { type: "sine", gain: 0.08 });
  tone(1760, t + 0.1, 0.22, { type: "sine", gain: 0.07 });
}

// The crowd: a murmur under the race, that swells now and then.
export function crowdStart() {
  if (!soundReady() || crowd) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.6;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 2200;
  const gain = ctx.createGain();
  gain.gain.value = 0.035;
  src.connect(band).connect(low).connect(gain).connect(master);
  src.start();
  crowd = { src, gain };
}

export function crowdStop() {
  if (!crowd) return;
  crowd.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  const { src } = crowd;
  setTimeout(() => src.stop(), 1500);
  crowd = null;
}

export function roar(seconds = 2.5, peak = 0.16) {
  if (!soundReady()) return;
  if (!crowd) crowdStart();
  const g = crowd.gain.gain;
  const t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(peak, t + 0.4);
  g.linearRampToValueAtTime(0.035, t + seconds);
}

// The finish, and the podium: a roar and a fanfare.
export function fanfare() {
  if (!soundReady()) return;
  roar(4, 0.2);
  const t = ctx.currentTime + 0.1;
  const chord = (at, freqs, length) => freqs.forEach((f) => tone(f, at, length, { type: "sawtooth", gain: 0.045 }));
  chord(t, [523, 659, 784], 0.22);
  chord(t + 0.24, [523, 659, 784], 0.22);
  chord(t + 0.48, [587, 740, 880], 0.22);
  chord(t + 0.72, [659, 784, 1047], 0.9);
}
