// Stadium crowd. Instead of a few buzzy oscillators per reaction, every crowd sound is a real
// ensemble rendered once in the background (OfflineAudioContext): dozens of individual
// "people", each a glottal source shaped by three vowel formants, with their own pitch, timing,
// stereo seat and distance. The results are plain AudioBuffers played back with variation.
//
// Layers:
//   babble   looped chatter bed, always there
//   roar     looped sustained shouting, grows with rally excitement and ball tension
//   one-shots: cheer, applause, ooh, aww, oh  (mixed per game event)

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Average adult formants (F1, F2, F3) in Hz.
const VOWELS = {
  oo: [300, 870, 2240],
  oh: [450, 800, 2830],
  ah: [730, 1090, 2440],
  aw: [570, 840, 2410],
  uh: [520, 1190, 2390],
  eh: [530, 1840, 2480],
  ae: [660, 1720, 2410],
  ee: [270, 2290, 3010],
};
const TALK = ['ah', 'eh', 'oh', 'uh', 'ee', 'ae', 'aw', 'oo'];

function person(near = 1) {
  const female = Math.random() < 0.5;
  return {
    f0: female ? rand(180, 250) : rand(100, 145),
    fs: female ? rand(1.1, 1.2) : rand(0.95, 1.04), // formant scale (vocal tract length)
    pan: rand(-0.95, 0.95),
    level: rand(0.35, 1) * near,
  };
}

function noiseBuffer(oc, seconds = 2) {
  const b = oc.createBuffer(1, Math.floor(oc.sampleRate * seconds), oc.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// One person producing a run of syllables. Each syllable glides between two vowels and two
// pitches with its own attack/release; syllables of one speaker must not overlap.
function speaker(oc, dest, noise, p, syllables, { breath = 0.25 } = {}) {
  if (!syllables.length) return;
  const t0 = syllables[0].t;
  const t1 = syllables.at(-1).t + syllables.at(-1).dur;
  const o = oc.createOscillator();
  o.type = 'sawtooth';
  // Natural pitch wobble: vibrato at a personal rate, never in sync with anyone else.
  const lfo = oc.createOscillator();
  const lfoDepth = oc.createGain();
  lfo.frequency.value = rand(4, 7);
  lfoDepth.gain.value = p.f0 * rand(0.008, 0.02);
  lfo.connect(lfoDepth).connect(o.frequency);
  const air = oc.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  const airGain = oc.createGain();
  airGain.gain.value = breath;
  // Real glottal pulses roll off faster than a sawtooth; tilt the source down.
  const tilt = oc.createBiquadFilter();
  tilt.type = 'lowpass';
  tilt.frequency.value = 1500;
  tilt.Q.value = 0.4;
  const src = oc.createGain();
  o.connect(tilt).connect(src);
  air.connect(airGain).connect(src);
  const env = oc.createGain();
  env.gain.value = 0;
  const pan = oc.createStereoPanner();
  pan.pan.value = p.pan;
  env.connect(pan).connect(dest);
  const formants = [0, 1, 2].map((k) => {
    const f = oc.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = [5, 8, 11][k];
    const g = oc.createGain();
    g.gain.value = [1, 0.75, 0.45][k];
    src.connect(f).connect(g).connect(env);
    return f;
  });
  for (const s of syllables) {
    const end = s.t + s.dur;
    const from = VOWELS[s.from];
    const to = VOWELS[s.to ?? s.from];
    o.frequency.setValueAtTime(s.f0a, s.t);
    o.frequency.linearRampToValueAtTime(s.f0b ?? s.f0a, end);
    formants.forEach((f, k) => {
      f.frequency.setValueAtTime(from[k] * p.fs, s.t);
      f.frequency.linearRampToValueAtTime(to[k] * p.fs, s.t + s.dur * (s.morph ?? 1));
    });
    const peak = s.vol * p.level;
    env.gain.setValueAtTime(0, s.t);
    env.gain.linearRampToValueAtTime(peak, s.t + s.atk);
    env.gain.linearRampToValueAtTime(peak * (s.sus ?? 1), Math.max(s.t + s.atk, end - s.rel));
    env.gain.linearRampToValueAtTime(0, end);
  }
  for (const n of [o, lfo]) {
    n.start(t0);
    n.stop(t1 + 0.05);
  }
  air.start(t0, rand(0, 1.5));
  air.stop(t1 + 0.05);
}

// Broad "mass of people" noise under the voices.
function mass(oc, dest, noise, { f = 900, q = 0.6, points }) {
  const s = oc.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  const bp = oc.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = oc.createGain();
  g.gain.value = 0;
  for (const [t, v] of points) g.gain.linearRampToValueAtTime(v, t);
  s.connect(bp).connect(g).connect(dest);
  s.start(0);
}

async function render(seconds, build) {
  const oc = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
  const noise = noiseBuffer(oc);
  const bus = oc.createGain();
  const air = oc.createBiquadFilter(); // distance: the far stands lose their top end
  air.type = 'lowpass';
  air.frequency.value = 4200;
  bus.connect(air).connect(oc.destination);
  build(oc, bus, noise);
  return normalize(await oc.startRendering());
}

function normalize(buf, target = 0.9) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    const k = target / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return buf;
}

// Fold the last `fade` seconds onto the start so the buffer loops without a seam.
function loopify(ctx, buf, fade) {
  const F = Math.floor(fade * buf.sampleRate);
  const L = buf.length - F;
  const out = ctx.createBuffer(buf.numberOfChannels, L, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, L));
    for (let i = 0; i < F; i++) {
      const a = i / F;
      dst[i] = src[i] * Math.sqrt(a) + src[L + i] * Math.sqrt(1 - a);
    }
  }
  return out;
}

// ---------- Ensembles ----------

function babble(seconds) {
  return render(seconds, (oc, bus, noise) => {
    for (let n = 0; n < 34; n++) {
      const p = person(rand(0.4, 1));
      const syl = [];
      let t = rand(0, 0.6);
      while (t < seconds - 0.3) {
        const dur = rand(0.09, 0.24);
        const f = p.f0 * rand(0.92, 1.18);
        syl.push({ t, dur, from: pick(TALK), to: pick(TALK), f0a: f, f0b: f * rand(0.85, 1.05), vol: rand(0.5, 1), atk: 0.025, rel: 0.05 });
        t += dur + (Math.random() < 0.12 ? rand(0.4, 1.4) : rand(0.03, 0.12));
      }
      speaker(oc, bus, noise, p, syl, { breath: 0.35 });
    }
    mass(oc, bus, noise, { f: 600, q: 0.5, points: [[0, 0.05], [seconds, 0.05]] });
  });
}

function roar(seconds) {
  return render(seconds, (oc, bus, noise) => {
    for (let n = 0; n < 56; n++) {
      const p = person(rand(0.4, 1));
      const syl = [];
      let t = rand(0, 0.8);
      while (t < seconds - 0.5) {
        const dur = rand(0.5, 1.6);
        const f = p.f0 * rand(1.35, 1.8);
        syl.push({ t, dur, from: pick(['eh', 'ah', 'oh', 'ae', 'oo']), to: pick(['ah', 'oh', 'aw']), f0a: f, f0b: f * rand(0.95, 1.12), vol: rand(0.6, 1), atk: rand(0.08, 0.2), rel: rand(0.15, 0.35) });
        t += dur + rand(0.05, 0.5);
      }
      speaker(oc, bus, noise, p, syl, { breath: 0.3 });
    }
    mass(oc, bus, noise, { f: 1000, q: 0.5, points: [[0, 0.25], [seconds, 0.25]] });
  });
}

// "YEAH!" / "WOOO!": a fast-onset shout that peaks, sustains and tails off one by one.
function cheer() {
  const len = 3.6;
  return render(len, (oc, bus, noise) => {
    for (let n = 0; n < 80; n++) {
      const p = person(rand(0.4, 1));
      const t = Math.min(0.5, -Math.log(1 - Math.random()) * 0.09);
      const dur = rand(0.9, 2.9);
      const f = p.f0 * rand(1.5, 2.1);
      const woo = Math.random() < 0.35;
      speaker(oc, bus, noise, p, [{
        t, dur,
        from: woo ? 'oo' : pick(['eh', 'ee', 'ae']), to: woo ? 'oo' : pick(['ah', 'ae']), morph: 0.3,
        f0a: f * (woo ? 0.85 : 1), f0b: f * (woo ? rand(1.2, 1.4) : rand(0.85, 1.05)),
        vol: rand(0.6, 1), atk: rand(0.05, 0.14), sus: 0.7, rel: dur * 0.55,
      }], { breath: 0.3 });
    }
    // Two-finger whistles: "fwee-oo".
    for (let n = 0; n < 5; n++) {
      const o = oc.createOscillator();
      const g = oc.createGain();
      const pan = oc.createStereoPanner();
      pan.pan.value = rand(-0.9, 0.9);
      const t = rand(0.15, 0.9);
      const f = rand(1900, 2700);
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.12);
      o.frequency.setValueAtTime(f, t + 0.45);
      o.frequency.linearRampToValueAtTime(f * rand(0.65, 0.8), t + 0.8);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.04, 0.08), t + 0.05);
      g.gain.setValueAtTime(rand(0.04, 0.07), t + 0.6);
      g.gain.linearRampToValueAtTime(0, t + 0.85);
      o.connect(g).connect(pan).connect(bus);
      o.start(t);
      o.stop(t + 0.9);
    }
    mass(oc, bus, noise, { f: 1100, q: 0.5, points: [[0, 0], [0.15, 0.5], [1.2, 0.4], [len, 0]] });
  });
}

// Collective vowel with a pitch arc: "OOOH" (gasp), "AWWW" (letdown), "OH!" (short).
function chorus({ len, voices, vowel, to, rise, fall, spread, durs, gasp = 0 }) {
  return render(len, (oc, bus, noise) => {
    for (let n = 0; n < voices; n++) {
      const p = person(rand(0.4, 1));
      const t = 0.02 + Math.random() ** 2 * spread;
      const dur = rand(...durs);
      const f = p.f0 * rand(1.25, 1.6);
      speaker(oc, bus, noise, p, [{
        t, dur, from: vowel, to, morph: 0.8,
        f0a: f * rise, f0b: f * fall,
        vol: rand(0.6, 1), atk: rand(0.04, 0.1), sus: 0.8, rel: dur * 0.5,
      }], { breath: 0.4 });
    }
    // The sharp intake of breath right before a gasp.
    if (gasp) mass(oc, bus, noise, { f: 1800, q: 0.7, points: [[0, 0], [0.04, gasp], [0.18, 0]] });
    mass(oc, bus, noise, { f: 700, q: 0.6, points: [[0, 0], [0.1, 0.25], [len * 0.5, 0.15], [len, 0]] });
  });
}

// Applause, synthesized sample by sample: each clapper has their own hand "tone", tempo and
// enthusiasm. Rendered directly (no audio graph) since it's hundreds of tiny bursts. Many quiet
// clappers with soft attacks blend into a smooth wash instead of a pile of clicks.
function applause(ctx, len = 4.5) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(len * sr), sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const atk = 0.0015 * sr;
  for (let n = 0; n < 80; n++) {
    const pan = rand(-1, 1);
    const gl = Math.cos((pan + 1) * Math.PI / 4);
    const gr = Math.sin((pan + 1) * Math.PI / 4);
    const tone = rand(700, 2000); // cupped hands sit low, flat palms higher
    const q = rand(0.9, 1.6);
    const level = rand(0.25, 1);
    const stop = rand(0.45, 1) * len;
    const period = rand(0.17, 0.28);
    // RBJ bandpass coefficients for this clapper.
    const w = 2 * Math.PI * tone / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0;
    const lp = 1 - Math.exp(-2 * Math.PI * 4500 / sr); // distance rolls off the top
    for (let t = rand(0.05, 0.4); t < stop; t += period * rand(0.88, 1.12)) {
      const fade = Math.min(1, (stop - t) / 1.2, t / 0.25);
      const amp = level * fade * rand(0.6, 1);
      const decay = rand(0.006, 0.012) * sr;
      const start = Math.floor(t * sr);
      const n2 = Math.min(Math.floor(decay * 5), L.length - start);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z = 0;
      for (let i = 0; i < n2; i++) {
        const x = (Math.random() * 2 - 1) * Math.exp(-i / decay) * Math.min(1, i / atk);
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        z += (y - z) * lp;
        L[start + i] += z * amp * gl;
        R[start + i] += z * amp * gr;
      }
    }
  }
  return normalize(buf, 0.6);
}

function stadiumVerb(ctx, seconds = 1.8) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  return buf;
}

// ---------- Runtime ----------

export function createCrowd(ctx, dest) {
  const bus = ctx.createGain();
  // The crowd is ambience: it sits under the music and the ball, never on top of them.
  // (No compressor here on purpose: Web Audio compressors add automatic makeup gain.)
  bus.gain.value = 0.3;
  const tone = ctx.createBiquadFilter(); // muffles everything during slow-mo
  tone.type = 'lowpass';
  tone.frequency.value = 12000;
  bus.connect(tone).connect(dest);
  const verb = ctx.createConvolver();
  verb.buffer = stadiumVerb(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
  tone.connect(verb).connect(wet).connect(dest);

  const buf = {};
  let ready = false;
  const beds = {};
  const active = [];
  let exc = 0; // rally excitement 0..1: builds with every touch, released by the point
  let tension = 0; // ball dropping toward the sand
  let lastApply = 0;
  let phase = 'menu';

  function bed(name, buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(bus);
    src.start(ctx.currentTime, rand(0, buffer.duration));
    beds[name] = { src, g };
  }

  (async () => {
    // Render one at a time so the startup work is spread out.
    buf.applause = applause(ctx);
    buf.oh = await chorus({ len: 1, voices: 26, vowel: 'oh', to: 'oh', rise: 1.05, fall: 0.85, spread: 0.12, durs: [0.25, 0.5] });
    buf.ooh = await chorus({ len: 2, voices: 60, vowel: 'oo', to: 'oh', rise: 0.95, fall: 1.15, spread: 0.2, durs: [0.8, 1.6], gasp: 0.45 });
    buf.aww = await chorus({ len: 2, voices: 60, vowel: 'ah', to: 'aw', rise: 1.15, fall: 0.75, spread: 0.18, durs: [0.8, 1.5] });
    buf.cheer = await cheer();
    bed('babble', loopify(ctx, await babble(9), 1));
    bed('roar', loopify(ctx, await roar(7), 1));
    ready = true;
    lastApply = 0;
  })().catch((e) => console.warn('crowd audio unavailable', e));

  function play(name, { gain = 1, rate = 1, delay = 0, offset = 0, pri = 0 } = {}) {
    const b = buf[name];
    if (!b || gain <= 0.01) return;
    const t = ctx.currentTime + delay;
    // A bigger moment swallows smaller ones still ringing, and we never stack more than a few.
    for (const a of active) if (a.pri < pri) a.g.gain.setTargetAtTime(0, t, 0.12);
    if (active.length >= 5) active[0].g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate * rand(0.95, 1.05);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start(t, offset);
    const entry = { g, pri };
    active.push(entry);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      const i = active.indexOf(entry);
      if (i >= 0) active.splice(i, 1);
    };
  }

  const bump = (v) => (exc = clamp01(exc + v));

  // How the stands answer each game event. `info` carries extra context from the game.
  function react(kind, info = {}) {
    if (!ready) return;
    const e = exc;
    switch (kind) {
      case 'serve':
        exc = 0.12;
        play('applause', { gain: 0.22, offset: 0.4, rate: 1.05 });
        break;
      case 'pass':
      case 'bump':
        bump(0.07);
        play('oh', { gain: 0.15 + 0.35 * e, rate: rand(0.95, 1.1) });
        break;
      case 'set': // anticipation: the attack is coming
        bump(0.08);
        play('ooh', { gain: 0.2 + 0.3 * e, rate: 1.08 });
        break;
      case 'spike':
        bump(0.15);
        play('ooh', { gain: 0.75 + 0.25 * e, rate: 0.95, pri: 1 });
        break;
      case 'tip':
        bump(0.08);
        play('oh', { gain: 0.45, rate: 1.15 });
        break;
      case 'block':
        bump(0.2);
        play('ooh', { gain: 0.8, rate: 1.05, pri: 1 });
        play('cheer', { gain: 0.6 + 0.3 * e, delay: 0.15, pri: 1 });
        play('applause', { gain: 0.35, delay: 0.3 });
        break;
      case 'dig':
        bump(0.15);
        if (info.prev === 'spike') { // they got a hand on a spike: huge
          play('oh', { gain: 0.9, rate: 0.95, pri: 1 });
          play('cheer', { gain: 0.7 + 0.3 * e, delay: 0.1, pri: 1 });
          play('applause', { gain: 0.4, delay: 0.35 });
        } else {
          play('oh', { gain: 0.5 + 0.3 * e });
          play('cheer', { gain: 0.25 + 0.3 * e, delay: 0.1 });
        }
        break;
      case 'cord': // net cord: everyone holds their breath
        bump(0.1);
        play('ooh', { gain: 0.8, pri: 1 });
        break;
      case 'net':
        play('aww', { gain: 0.6, pri: 1 });
        break;
      case 'whiff':
        play('aww', { gain: 0.3, rate: 1.1 });
        break;
      case 'point': {
        // The longer and wilder the rally, the bigger the eruption.
        const big = clamp01(0.45 + 0.55 * e + (info.special ? 0.25 : 0));
        if (info.reason === 'in') {
          play('cheer', { gain: big, pri: 2 });
          play('applause', { gain: 0.5 + 0.5 * big, delay: 0.25, pri: 2 });
          if (big > 0.8) play('cheer', { gain: 0.6, delay: 0.7, rate: 0.97, pri: 2 });
        } else { // out / too many touches: a groan from one side, applause from the other
          play('aww', { gain: 0.55 + 0.3 * e, pri: 2 });
          play('cheer', { gain: 0.35 + 0.3 * e, delay: 0.2, pri: 2 });
          play('applause', { gain: 0.6, delay: 0.35, pri: 2 });
        }
        exc = 0;
        break;
      }
      case 'start':
        play('cheer', { gain: 0.75, pri: 2 });
        play('applause', { gain: 0.9, delay: 0.1, pri: 2 });
        break;
      case 'sudden':
        play('ooh', { gain: 0.9, rate: 0.9, pri: 2 });
        exc = 0.6;
        break;
      case 'victory':
        play('cheer', { gain: 1, pri: 3 });
        play('applause', { gain: 1, delay: 0.2, pri: 3 });
        play('cheer', { gain: 0.85, delay: 1.4, rate: 0.96, pri: 3 });
        play('applause', { gain: 0.9, delay: 2.6, rate: 0.97, pri: 3 });
        play('cheer', { gain: 0.6, delay: 3.2, rate: 1.04, pri: 3 });
        break;
    }
  }

  // Called every frame: keeps the bed alive and lets the crowd lean in as the ball drops.
  function update({ phase: ph = 'menu', ballY = 5, ballVy = 0, ts = 1, dt = 0.016 } = {}) {
    phase = ph;
    const rally = phase === 'rally';
    const falling = rally && ballVy < 0 ? clamp01((4 - ballY) / 3.5) : 0;
    tension += (falling - tension) * (1 - Math.exp(-dt * 6));
    if (!rally) exc *= Math.exp(-dt * 0.4);
    if (!ready) return;
    const now = ctx.currentTime;
    if (now - lastApply < 0.06) return;
    lastApply = now;
    const k = 0.25;
    const babbleLevel = { menu: 0.22, lobby: 0.3, serve: 0.42, rally: 0.38 + 0.15 * exc, point: 0.45, over: 0.45 }[phase] ?? 0.35;
    const roarLevel = rally ? 0.05 + 0.5 * exc ** 1.4 + tension * (0.12 + 0.3 * exc) : phase === 'serve' ? 0.04 : 0;
    beds.babble.g.gain.setTargetAtTime(babbleLevel, now, k * 2);
    beds.roar.g.gain.setTargetAtTime(roarLevel, now, k);
    const slow = ts < 0.85;
    tone.frequency.setTargetAtTime(slow ? 900 : 12000, now, 0.12);
    const rate = slow ? 0.7 : 1;
    beds.babble.src.playbackRate.setTargetAtTime(rate, now, 0.15);
    beds.roar.src.playbackRate.setTargetAtTime(rate, now, 0.15);
  }

  return { react, update };
}
