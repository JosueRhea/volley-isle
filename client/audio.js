// Cartoon sound kit. Everything is synthesized (no audio files), tuned to feel toy-like and rubbery
// to match the visuals: bouncy pitch slides, soft round attacks, slight random variation, stereo
// panning, and a touch of bright outdoor reverb.
import { createCrowd } from './crowd-audio.js';

let ctx = null;
let master = null;
let sfxBus = null;
let whiteBuf = null;
let crowd = null;
// Player volume settings (0..1); applied whenever the audio graph exists.
const volume = { master: 0.8, music: 0.6, sfx: 0.9, musicOn: true, sfxOn: true };
const MUSIC_LEVEL = 0.9; // music bus level at 100%

export function setVolumes(v) {
  Object.assign(volume, v);
  if (!ctx) return;
  master.gain.setTargetAtTime(0.75 * volume.master, ctx.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(volume.sfxOn ? volume.sfx : 0, ctx.currentTime, 0.05);
  music.refresh?.();
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    // Brick-wall limiter last in the chain: whatever stacks up, the output never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const trim = ctx.createGain();
    trim.gain.value = 0.85; // headroom for the compressors' automatic makeup gain
    comp.connect(limiter).connect(trim).connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.75 * volume.master;
    master.connect(comp);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = volume.sfxOn ? volume.sfx : 0;
    sfxBus.connect(master);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(1.1, 3.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    sfxBus.connect(verb).connect(wet).connect(master);
    whiteBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = whiteBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    crowd = createCrowd(ctx, sfxBus);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const rand = (a, b) => a + Math.random() * (b - a);
const vary = (v, amt = 0.05) => v * (1 + rand(-amt, amt));

// Output node, optionally panned left/right.
function out(pan = 0) {
  if (!pan) return sfxBus;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(sfxBus);
  return p;
}

// Oscillator with a pitch slide (f → to), optional vibrato, and a smooth envelope.
function osc({ type = 'sine', f, to = null, glide, dur, vol, attack = 0.004, delay = 0, dest = sfxBus, vib = 0, vibRate = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + (glide ?? dur));
  if (vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = vibRate;
    depth.gain.value = vib;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Filtered noise with an optional filter sweep: whooshes, sand, cracks, rattles.
function hiss({ type = 'bandpass', f, to = null, q = 1, dur, vol, attack = 0.003, delay = 0, dest = sfxBus }) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = whiteBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f, t);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(dest);
  src.start(t, rand(0, 1.5));
  src.stop(t + dur + 0.05);
}

// FM bell: bright strike that mellows out. Used for chimes, plucks and the fanfare.
function bell({ f, dur = 1.2, vol = 0.1, ratio = 3.5, index = 2.5, delay = 0, dest = sfxBus }) {
  const t = ctx.currentTime + delay;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  car.frequency.value = f;
  mod.frequency.value = f * ratio;
  modGain.gain.setValueAtTime(f * index, t);
  modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
  mod.connect(modGain).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(g).connect(dest);
  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.05);
  mod.stop(t + dur + 0.05);
}

// The beach ball itself: a rubbery "bomp" with a little contact click.
function ballBomp(dest, v, pitch) {
  osc({ f: vary(240 * pitch), to: 110 * pitch, glide: 0.1, dur: 0.2, vol: 0.55 * v, dest });
  osc({ type: 'triangle', f: vary(600 * pitch), to: 300 * pitch, dur: 0.06, vol: 0.14 * v, dest });
  hiss({ f: 2400, q: 1.5, dur: 0.025, vol: 0.18 * v, dest });
}

function wahWah(dest = sfxBus) {
  osc({ type: 'triangle', f: 330, to: 311, dur: 0.17, vol: 0.08, vib: 8, vibRate: 7, dest });
  osc({ type: 'triangle', f: 262, to: 220, dur: 0.38, vol: 0.08, vib: 10, vibRate: 6, delay: 0.18, dest });
}

const live = () => !!ctx;

export const sfx = {
  unlock: () => ac(),

  // pan: -1 (left) … 1 (right). vol: 0..1, quieter for far-away hits.
  hit(kind, { pan = 0, vol = 1 } = {}) {
    if (!live()) return;
    const d = out(pan);
    const v = vol;
    switch (kind) {
      case 'spike': // KA-POW: body thump + rubber smack + crack + whoosh tail
        osc({ f: vary(150), to: 42, dur: 0.35, vol: 0.7 * v, dest: d });
        osc({ type: 'triangle', f: vary(520), to: 180, dur: 0.12, vol: 0.35 * v, dest: d });
        hiss({ type: 'highpass', f: 1800, dur: 0.09, vol: 0.5 * v, dest: d });
        hiss({ f: 2600, to: 500, q: 0.8, dur: 0.45, vol: 0.12 * v, delay: 0.03, dest: d });
        break;
      case 'block': // cartoon BONK, like a ball hitting a wall
        osc({ type: 'square', f: vary(330), to: 165, dur: 0.16, vol: 0.1 * v, dest: d });
        osc({ f: vary(220), to: 110, dur: 0.25, vol: 0.45 * v, dest: d });
        hiss({ f: 900, q: 6, dur: 0.12, vol: 0.4 * v, dest: d });
        break;
      case 'tip': // light fingertip "plip"
        osc({ f: vary(700), to: 1250, dur: 0.1, vol: 0.25 * v, dest: d });
        osc({ type: 'triangle', f: vary(1400), dur: 0.06, vol: 0.06 * v, delay: 0.02, dest: d });
        break;
      case 'serve':
        ballBomp(d, v, 1);
        hiss({ f: 700, to: 2600, q: 0.9, dur: 0.35, vol: 0.12 * v, dest: d });
        break;
      case 'set':
        ballBomp(d, v * 0.8, 1.25);
        osc({ f: vary(900), to: 1300, dur: 0.08, vol: 0.05 * v, delay: 0.01, dest: d });
        break;
      case 'dig':
        ballBomp(d, v, 0.85);
        hiss({ type: 'lowpass', f: 900, dur: 0.18, vol: 0.25 * v, dest: d });
        break;
      default:
        ballBomp(d, v, 1);
    }
  },

  // Air swish of a swing.
  swing: () => live() && hiss({ f: 900, to: 3200, q: 1.2, dur: 0.16, vol: 0.05 }),

  // Springy cartoon "boing".
  jump() {
    if (!live()) return;
    osc({ f: vary(190), to: 480, glide: 0.16, dur: 0.28, vol: 0.12, vib: 25, vibRate: 28 });
    osc({ type: 'triangle', f: vary(380), to: 960, glide: 0.16, dur: 0.18, vol: 0.03 });
  },

  // Soft "pmf" on the sand.
  land() {
    if (!live()) return;
    osc({ f: vary(110), to: 60, dur: 0.09, vol: 0.18 });
    hiss({ type: 'lowpass', f: 600, dur: 0.08, vol: 0.12 });
  },

  // "Fwoosh" through the air, then a sandy splat.
  dive() {
    if (!live()) return;
    hiss({ f: 2200, to: 400, q: 0.7, dur: 0.32, vol: 0.18 });
    hiss({ type: 'lowpass', f: 700, dur: 0.25, vol: 0.3, delay: 0.28 });
    osc({ f: 120, to: 50, dur: 0.15, vol: 0.3, delay: 0.28 });
  },

  // Missed swing: comedic little "wah-wah".
  whiff: () => live() && wahWah(),

  // Deep "whooom" as time slows down.
  slowmo() {
    if (!live()) return;
    osc({ f: 200, to: 38, dur: 1.1, vol: 0.35 });
    hiss({ type: 'lowpass', f: 400, to: 120, dur: 0.9, vol: 0.15 });
  },

  // Serve meter starting: rising wobbly "vwoop".
  charge() {
    if (!live()) return;
    osc({ type: 'triangle', f: 260, to: 1040, dur: 0.5, vol: 0.08, vib: 12, vibRate: 14 });
  },

  serveResult(zone) {
    if (!live()) return;
    if (zone === 'perfect') {
      [1319, 1568, 2093].forEach((f, i) => bell({ f, dur: 1.1, vol: 0.09, ratio: 2.01, index: 1.2, delay: i * 0.07 }));
      hiss({ type: 'highpass', f: 6000, dur: 0.5, vol: 0.04, delay: 0.1 });
    } else if (zone === 'good') bell({ f: 1047, dur: 0.8, vol: 0.08, ratio: 2.01, index: 1 });
    else wahWah();
  },

  // Into the mesh: soft "fwump" plus the rope rattling. Net cord: a plucked "ploink".
  net(cord, { pan = 0 } = {}) {
    if (!live()) return;
    const d = out(pan);
    if (cord) {
      bell({ f: vary(700), dur: 0.6, vol: 0.12, ratio: 2.01, index: 1.5, dest: d });
      osc({ f: 300, to: 620, dur: 0.25, vol: 0.08, vib: 20, vibRate: 25, dest: d });
      return;
    }
    hiss({ type: 'lowpass', f: 500, dur: 0.25, vol: 0.35, dest: d });
    for (let i = 0; i < 6; i++) hiss({ f: 3000, q: 4, dur: 0.015, vol: 0.08 * (1 - i / 6), delay: 0.02 + i * 0.035, dest: d });
  },

  // Referee whistle with a real trill: a short pip and a long blast.
  whistle() {
    if (!live()) return;
    for (const [delay, dur] of [[0, 0.13], [0.17, 0.45]]) {
      osc({ f: 2900, dur, vol: 0.06, vib: 140, vibRate: 38, delay, attack: 0.01 });
      hiss({ f: 2900, q: 3, dur, vol: 0.025, delay });
    }
  },

  // The stands (see crowd-audio.js): react to a game event, and follow the rally every frame.
  crowdReact: (kind, info) => live() && crowd.react(kind, info),
  crowdUpdate: (s) => live() && crowd.update(s),

  // Victory fanfare on bells, with a warm bass under it.
  fanfare() {
    if (!live()) return;
    const melody = [[392, 0.12], [523, 0.12], [659, 0.12], [784, 0.3], [659, 0.12], [784, 0.12], [1047, 0.7]];
    let d = 0;
    for (const [f, len] of melody) {
      bell({ f, dur: len + 0.5, vol: 0.09, ratio: 2.01, index: 1.4, delay: d });
      d += len;
    }
    for (const [f, at] of [[131, 0], [175, 0.36], [196, 0.66], [262, 0.9]]) osc({ type: 'triangle', f, dur: 0.5, vol: 0.12, delay: at });
  },

  // Soft UI pop for buttons.
  click() {
    ac();
    osc({ f: vary(600), to: 900, dur: 0.06, vol: 0.08 });
  },
};

// ---------- Music ----------
// An original island tune, sequenced live on a 16th-note grid: steel drum melody,
// marimba off-beat chords, bouncy bass, and percussion that only kicks in during matches.
const BPM = 112;
const SIXTEENTH = 60 / BPM / 4;
const LOOP = 128; // 8 bars
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// C – Am – F – G, two bars each: [bass root, chord tones]
const CHORDS = [
  [36, [60, 64, 67]],
  [33, [57, 60, 64]],
  [29, [57, 60, 65]],
  [31, [59, 62, 67]],
];
// [step, midi, length in 16ths]
const MELODY = [
  [0, 76, 2], [2, 79, 2], [4, 81, 3], [8, 79, 2], [10, 76, 2], [12, 74, 4],
  [16, 72, 2], [18, 74, 2], [20, 76, 4], [26, 79, 2], [28, 76, 4],
  [32, 81, 2], [34, 84, 2], [36, 81, 3], [40, 79, 2], [42, 76, 2], [44, 79, 4],
  [48, 76, 2], [50, 74, 2], [52, 72, 6], [60, 69, 4],
  [64, 72, 2], [66, 74, 2], [68, 76, 3], [72, 79, 2], [74, 81, 2], [76, 79, 4],
  [80, 76, 2], [82, 74, 2], [84, 72, 4], [90, 74, 2], [92, 76, 4],
  [96, 79, 2], [98, 81, 2], [100, 84, 4], [104, 83, 2], [106, 81, 2], [108, 79, 4],
  [112, 74, 2], [114, 76, 2], [116, 74, 2], [118, 71, 2], [120, 74, 8],
];
const MELODY_AT = new Map(MELODY.map(([s, m, l]) => [s, [m, l]]));

let bus = null;
let muffle = null;
let drums = null;
let noiseBuf = null;
let timer = null;
let step = 0;
let loopCount = 0;
let nextTime = 0;
let mode = 'lobby';

function voice(type, f, t, dur, vol, out, attack = 0.005) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Steel pan: bright fundamental plus a couple of metallic partials.
function steel(m, t, len) {
  const f = mtof(m);
  const dur = Math.max(0.35, len * SIXTEENTH * 1.6);
  voice('sine', f, t, dur, 0.09, bus);
  voice('sine', f * 2, t, dur * 0.6, 0.035, bus);
  voice('triangle', f * 3.01, t, dur * 0.3, 0.012, bus);
}

function marimba(m, t, vol = 0.035) {
  const f = mtof(m);
  voice('sine', f, t, 0.28, vol, bus);
  voice('sine', f * 4, t, 0.08, vol * 0.25, bus);
}

function bass(m, t, len) {
  voice('triangle', mtof(m), t, len * SIXTEENTH * 0.95, 0.16, bus, 0.01);
  voice('sine', mtof(m), t, len * SIXTEENTH * 0.95, 0.1, bus, 0.01);
}

function hit(t, { freq, q = 1, dur, vol, type = 'bandpass' }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(drums);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function kick(t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(drums);
  o.start(t);
  o.stop(t + 0.25);
}

function playStep(s, t) {
  const [root, chord] = CHORDS[Math.floor(s / 32)];
  const inBar = s % 16;
  const lobby = mode === 'lobby';

  // Bass: root on 1 and 3, octave bounce in between.
  if (inBar === 0 || inBar === 8) bass(root, t, 3);
  if (!lobby && (inBar === 6 || inBar === 14)) bass(root + 12, t, 1);

  // Marimba skank on the off-beats.
  if (s % 4 === 2) for (const n of chord) marimba(n, t, lobby ? 0.022 : 0.03);

  // Melody: every other pass it drops an octave onto marimba for variety.
  const note = MELODY_AT.get(s);
  if (note) {
    if (loopCount % 2 === 0) steel(note[0], t, note[1]);
    else marimba(note[0] - 12, t, 0.06);
  }

  // Percussion (matches only): kick, rim click, shaker.
  if (!lobby) {
    if (s % 8 === 0) kick(t);
    if (s % 8 === 4) hit(t, { freq: 1800, q: 3, dur: 0.06, vol: 0.18 });
    hit(t, { freq: 7000, type: 'highpass', dur: s % 2 ? 0.03 : 0.05, vol: s % 4 === 2 ? 0.07 : 0.035 });
  } else if (s % 4 === 2) {
    hit(t, { freq: 7000, type: 'highpass', dur: 0.04, vol: 0.03 });
  }
}

function schedule() {
  while (nextTime < ctx.currentTime + 0.12) {
    playStep(step, nextTime);
    nextTime += SIXTEENTH;
    step = (step + 1) % LOOP;
    if (step === 0) loopCount++;
  }
}

export const music = {
  // Needs a user gesture first (browser autoplay rules); safe to call repeatedly.
  start() {
    ac();
    if (timer) return;
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    bus = ctx.createGain();
    bus.gain.value = volume.musicOn ? volume.music * MUSIC_LEVEL : 0;
    drums = ctx.createGain();
    drums.connect(bus);
    bus.connect(muffle).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 25);
  },
  // 'lobby' = light arrangement, 'match' = full band.
  setMode(m) {
    mode = m;
  },
  // Muffled "underwater" sound during slow-mo.
  setMuffled(on) {
    if (!muffle) return;
    muffle.frequency.setTargetAtTime(on ? 700 : 20000, ctx.currentTime, 0.08);
  },
  refresh() {
    if (bus) bus.gain.setTargetAtTime(volume.musicOn ? volume.music * MUSIC_LEVEL : 0, ctx.currentTime, 0.05);
  },
};
