// Voice chat: peer-to-peer WebRTC audio between the humans in a room. Rooms hold at most 4 people,
// so everyone connects straight to everyone else (a full mesh) and the game server only relays the
// offer/answer that sets each connection up. You can listen without a microphone; the mic is opt-in
// (the mic button), either always open or push-to-talk (hold V, or hold the mic button).
// Everything that can go wrong (mic blocked or missing, a player we can't reach, the browser pausing
// audio) is tracked here so the voice panel can show it and offer a fix.
import { settings, onSettings, setSetting } from './settings.js';

const SPEAK_LEVEL = 0.015; // RMS above this counts as talking
const SPEAK_HOLD_MS = 350; // keep the indicator on through short pauses between words
const ICE_WAIT_MS = 2500; // send the offer/answer once candidates are gathered, or after this long
const ICE_SETTLE_MS = 250; // …or this soon after the first public (STUN/TURN) candidate shows up
const RETRY_MS = 3000;
const MAX_RETRIES = 3;
const WAIT_FAIL_MS = 15000; // waiting this long for the other side to call us counts as failed
const PTT_KEY = 'KeyV';
const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

let iceConfig = null;
async function iceServers() {
  iceConfig ??= fetch('/api/ice', { method: 'POST' })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => j.iceServers)
    .catch(() => [{ urls: 'stun:stun.cloudflare.com:3478' }]);
  return iceConfig;
}

// Send the description once ICE gathering is done (one message per side instead of a trickle).
// Gathering can take seconds to formally finish, but once a public address is known the rest
// rarely matters, so don't wait much longer than that.
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ICE_WAIT_MS);
    const done = () => (clearTimeout(timer), resolve());
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && done());
    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate?.type === 'srflx' || e.candidate?.type === 'relay') setTimeout(done, ICE_SETTLE_MS);
    });
  });
}

// getUserMedia failures → what we tell the player.
function micErrorCode(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'notfound';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'other';
  }
}

const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export class Voice {
  // onChange: something the HUD shows changed (who's talking, mutes, mic state).
  constructor(net, { onChange }) {
    this.net = net;
    this.onChange = onChange;
    this.myId = null;
    this.room = null; // { tutorial, isPublic } while we're in a room
    this.players = [];
    this.peers = new Map(); // id → { pc, audio, analyser, speakUntil, offerer }
    this.retries = new Map(); // id → failed attempts (we call them)
    this.waitSince = new Map(); // id → when we started waiting for them to call us
    this.muted = new Set(); // players you've muted
    this.gains = new Map(); // id → per-player volume 0..1
    this.mic = null; // MediaStream while the mic is on
    this.micAnalyser = null;
    this.micError = null; // null | denied | notfound | busy | lost | insecure | unsupported | other
    this.asking = false;
    this.playBlocked = false; // the browser refused to start voice audio without a click
    this.holding = 0; // push-to-talk: key and/or button held
    this.selfSpeakUntil = 0;
    this.speaking = new Set();
    this.inputs = []; // [{ id, label }]
    this.outputs = [];
    this.canPickOutput = canPickOutput;
    this.ctx = null;
    this.buf = new Float32Array(512);

    net.on('rtc', (m) => this.signal(m.from, m.d));

    addEventListener('keydown', (e) => {
      if (e.code !== PTT_KEY || e.repeat || e.target instanceof HTMLInputElement || !this.active) return;
      if (settings.micMode === 'ptt' && !this.mic) this.enableMic();
      this.hold(+1);
    });
    addEventListener('keyup', (e) => e.code === PTT_KEY && this.holding && this.hold(-1));
    addEventListener('blur', () => this.holding && ((this.holding = 0), this.applyMic()));
    // Any click or key is a chance to start audio the browser held back.
    for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => this.playBlocked && this.unlockAudio(), true);

    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
    // Unblocking the mic in the browser's site settings picks it up again without a reload.
    navigator.permissions
      ?.query({ name: 'microphone' })
      .then((status) => {
        status.onchange = () => {
          if (status.state === 'granted' && this.micError === 'denied' && this.active) this.enableMic();
          if (status.state === 'denied' && this.mic) this.micLost('denied');
        };
      })
      .catch(() => {}); // not every browser can be asked about the mic

    let prev = null;
    onSettings((st) => {
      for (const id of this.peers.keys()) this.applyVolume(id);
      if (prev && (st.voiceOn !== prev.voiceOn || st.micMode !== prev.micMode)) {
        this.holding = 0;
        if (!this.active) this.stopMic();
        this.announce();
        this.reconcile();
        if (this.active && st.voiceOn !== prev.voiceOn && st.micOn) this.enableMic();
        this.applyMic();
      }
      prev = { voiceOn: st.voiceOn, micMode: st.micMode };
    });
  }

  // In a room with other people, and voice chat is switched on.
  get active() {
    return !!this.room && !this.room.tutorial && settings.voiceOn;
  }

  // In a room where voice chat exists at all (it may be switched off).
  get available() {
    return !!this.room && !this.room.tutorial;
  }

  get transmitting() {
    return !!this.mic && (settings.micMode === 'open' || this.holding > 0);
  }

  // What the mic button shows: disabled | off | asking | error | open | ptt | talking
  get micState() {
    if (!settings.voiceOn) return 'disabled';
    if (this.asking) return 'asking';
    if (!this.mic) return this.micError ? 'error' : 'off';
    if (settings.micMode === 'ptt') return this.holding ? 'talking' : 'ptt';
    return 'open';
  }

  // Called on every welcome (first join and reconnects).
  join(myId, room) {
    this.myId = myId;
    this.room = room;
    if (this.active) iceServers(); // fetch ahead, so the first call doesn't wait for it
    this.announce();
    if (this.active && settings.micOn && !this.mic) this.enableMic();
    this.refreshDevices();
    this.onChange();
  }

  leave() {
    if (this.active) this.net.send({ t: 'voice', on: false });
    this.room = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stopMic();
  }

  announce() {
    if (this.room) this.net.send({ t: 'voice', on: this.active, mic: !!this.mic });
  }

  roster(players) {
    this.players = players;
    this.reconcile();
    this.onChange();
  }

  // Everyone else in the room who's in voice, and whether we call them (lower id calls).
  wanted() {
    if (!this.active) return [];
    return this.players.filter((p) => !p.bot && p.vc && p.id !== this.myId);
  }

  // Connect to everyone else in voice; hang up on anyone who left it. The lower id always makes the
  // offer, so two players never call each other at the same time.
  reconcile() {
    const want = new Set(this.wanted().map((p) => p.id));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.closePeer(id);
    for (const m of [this.retries, this.waitSince]) for (const id of [...m.keys()]) if (!want.has(id)) m.delete(id);
    const now = performance.now();
    for (const id of want) {
      if (this.peers.has(id)) continue;
      if (this.myId < id) {
        if ((this.retries.get(id) ?? 0) < MAX_RETRIES) this.call(id);
      } else if (!this.waitSince.has(id)) this.waitSince.set(id, now);
    }
  }

  // ok | connecting | unstable | failed | off (not in voice)
  peerState(p) {
    if (!p.vc) return 'off';
    const peer = this.peers.get(p.id);
    if (peer?.pc) {
      const s = peer.pc.connectionState;
      if (s === 'connected') return 'ok';
      if (s === 'disconnected') return 'unstable';
      if (s === 'failed' || s === 'closed') return 'failed';
      return 'connecting';
    }
    if (peer) return 'connecting';
    if (this.myId < p.id) return (this.retries.get(p.id) ?? 0) >= MAX_RETRIES ? 'failed' : 'connecting';
    const since = this.waitSince.get(p.id);
    return since != null && performance.now() - since > WAIT_FAIL_MS ? 'failed' : 'connecting';
  }

  // The one-line summary for the voice panel and the HUD alert. level: off | ok | wait | bad
  health() {
    if (!this.available) return { level: 'off', code: 'none' };
    if (!settings.voiceOn) return { level: 'off', code: 'disabled' };
    if (this.micError) return { level: 'bad', code: `mic.${this.micError}` };
    if (this.playBlocked) return { level: 'bad', code: 'blocked' };
    const others = this.players.filter((p) => !p.bot && p.id !== this.myId);
    const inVoice = others.filter((p) => p.vc);
    const states = inVoice.map((p) => [p, this.peerState(p)]);
    const failed = states.filter(([, s]) => s === 'failed').map(([p]) => p);
    if (failed.length) return { level: 'bad', code: 'failed', players: failed };
    if (!others.length) return { level: 'ok', code: 'alone' };
    if (!inVoice.length) return { level: 'ok', code: 'nobody' };
    const waiting = states.filter(([, s]) => s !== 'ok').length;
    if (waiting) return { level: 'wait', code: 'connecting', n: waiting };
    return { level: 'ok', code: 'connected', n: inVoice.length };
  }

  async newPeer(id) {
    const servers = await iceServers();
    // In public rooms, go through the TURN relay when there is one, so strangers don't see your IP.
    const relay = this.room?.isPublic && servers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
    const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: relay ? 'relay' : 'all' });
    const audio = new Audio();
    audio.autoplay = true;
    audio.hidden = true;
    document.body.appendChild(audio);
    if (canPickOutput && settings.voiceOut) audio.setSinkId(settings.voiceOut).catch(() => {});
    const peer = { pc, audio, analyser: null, speakUntil: 0, offerer: this.myId < id };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      this.play(audio);
      peer.analyser = this.analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      if (pc.connectionState === 'connected') this.retries.delete(id), this.waitSince.delete(id);
      if (pc.connectionState === 'failed') {
        this.closePeer(id);
        // The caller tries again a few times; the other side waits for the new call.
        if (peer.offerer) {
          this.retries.set(id, (this.retries.get(id) ?? 0) + 1);
          setTimeout(() => this.reconcile(), RETRY_MS);
        } else this.waitSince.set(id, performance.now());
      }
      this.onChange();
    };
    this.peers.set(id, peer);
    this.waitSince.delete(id);
    this.applyVolume(id);
    return peer;
  }

  async call(id) {
    this.peers.set(id, {}); // claim the slot while the ICE servers load
    try {
      const peer = await this.newPeer(id);
      if (this.peers.get(id) !== peer) return peer.pc.close();
      peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.syncTrack(peer);
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await gathered(peer.pc);
      if (this.peers.get(id) !== peer) return;
      this.net.send({ t: 'rtc', to: id, d: { type: 'offer', sdp: peer.pc.localDescription.sdp } });
      this.syncTrack(peer); // the mic may have come on while we were setting up
    } catch {
      this.closePeer(id);
      this.retries.set(id, (this.retries.get(id) ?? 0) + 1);
    }
  }

  async signal(from, d) {
    if (!this.active || !d) return;
    try {
      if (d.type === 'offer') {
        this.closePeer(from); // a new offer replaces any old connection (e.g. after a failure)
        this.peers.set(from, {});
        const peer = await this.newPeer(from);
        if (this.peers.get(from) !== peer) return peer.pc.close();
        await peer.pc.setRemoteDescription(d);
        const tr = peer.pc.getTransceivers()[0];
        if (tr) tr.direction = 'sendrecv';
        this.syncTrack(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await gathered(peer.pc);
        if (this.peers.get(from) !== peer) return;
        this.net.send({ t: 'rtc', to: from, d: { type: 'answer', sdp: peer.pc.localDescription.sdp } });
        this.syncTrack(peer);
      } else if (d.type === 'answer') {
        const peer = this.peers.get(from);
        if (peer?.pc?.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription(d);
      } else if (d.type === 'restart' && this.myId < from) {
        // They asked for a fresh connection: call them again.
        this.retries.delete(from);
        this.closePeer(from);
        this.reconcile();
      }
    } catch {
      this.closePeer(from);
    }
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc?.close();
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    peer.analyser?.source.disconnect();
  }

  // Start over with one player (or everyone): whoever calls, calls again.
  reconnect(id) {
    this.retries.delete(id);
    this.closePeer(id);
    if (this.myId < id) this.reconcile();
    else {
      this.waitSince.set(id, performance.now());
      this.net.send({ t: 'rtc', to: id, d: { type: 'restart' } });
    }
    this.onChange();
  }

  reconnectAll() {
    for (const p of this.wanted()) this.reconnect(p.id);
    if (this.playBlocked) this.unlockAudio();
  }

  // ----- Microphone -----

  micTrack() {
    return this.mic?.getAudioTracks()[0] ?? null;
  }

  // Send the mic (or nothing) on a connection. No renegotiation needed: the audio line is always there.
  syncTrack(peer) {
    const sender = peer.pc?.getTransceivers()[0]?.sender;
    const track = this.micTrack();
    if (sender && sender.track !== track) sender.replaceTrack(track).catch(() => {});
  }

  // The chosen mic, falling back to the default one if it's gone.
  async openMic() {
    const id = settings.micDevice;
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: id ? { ...MIC, deviceId: { exact: id } } : MIC });
    } catch (e) {
      if (!id || micErrorCode(e) !== 'notfound') throw e;
      setSetting('micDevice', '');
      return navigator.mediaDevices.getUserMedia({ audio: MIC });
    }
  }

  async enableMic() {
    if (this.mic || this.asking) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.micError = window.isSecureContext ? 'unsupported' : 'insecure';
      return this.onChange();
    }
    this.asking = true;
    this.onChange();
    let stream = null;
    try {
      stream = await this.openMic();
      this.micError = null;
    } catch (e) {
      this.micError = micErrorCode(e);
    }
    this.asking = false;
    if (stream && !this.active) {
      for (const tr of stream.getTracks()) tr.stop(); // left the room or turned voice off meanwhile
      return this.onChange();
    }
    if (stream) {
      setSetting('micOn', true);
      this.useMic(stream);
      this.refreshDevices(); // device names only show up once the mic is allowed
    }
    this.announce();
    this.applyMic();
  }

  useMic(stream) {
    const old = this.mic;
    this.micAnalyser?.source.disconnect();
    this.mic = stream;
    this.micAnalyser = this.analyse(stream);
    const track = this.micTrack();
    if (track) track.onended = () => this.mic === stream && this.micLost('lost');
    for (const p of this.peers.values()) this.syncTrack(p);
    if (old && old !== stream) for (const tr of old.getTracks()) tr.stop();
  }

  // The mic went away under us (unplugged, or permission revoked): fall back to the default mic.
  micLost(code) {
    this.stopMic();
    this.micError = code;
    this.announce();
    this.onChange();
    if (code === 'lost' && settings.micDevice) {
      setSetting('micDevice', '');
      setTimeout(() => this.enableMic(), 300);
    }
  }

  async setMicDevice(id) {
    setSetting('micDevice', id);
    if (!this.mic) return this.onChange();
    try {
      this.useMic(await this.openMic());
      this.micError = null;
    } catch (e) {
      this.micError = micErrorCode(e);
    }
    this.applyMic();
  }

  // Turning the mic off releases it completely (the browser's recording light goes out).
  disableMic() {
    this.stopMic();
    this.micError = null;
    setSetting('micOn', false);
    this.announce();
    this.onChange();
  }

  stopMic() {
    if (!this.mic) return;
    for (const tr of this.mic.getTracks()) tr.stop();
    this.micAnalyser?.source.disconnect();
    this.mic = this.micAnalyser = null;
    for (const p of this.peers.values()) this.syncTrack(p);
    this.holding = 0;
  }

  applyMic() {
    const track = this.micTrack();
    if (track) track.enabled = this.transmitting;
    this.onChange();
  }

  // Push-to-talk press (+1) / release (-1); the key and the button can overlap.
  hold(d) {
    this.holding = Math.max(0, this.holding + d);
    this.applyMic();
  }

  // The mic button: turns voice chat on if it's off, asks for (or retries) the mic, then
  // mutes/unmutes (open mic) or talks while held (push-to-talk, handled by press/release).
  toggleMic() {
    if (!settings.voiceOn) {
      setSetting('voiceOn', true);
      if (!settings.micOn) this.enableMic();
    } else if (!this.mic) this.enableMic();
    else if (settings.micMode === 'open') this.disableMic();
  }

  async refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind) => list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, label: d.label }));
      this.inputs = pick('audioinput');
      this.outputs = canPickOutput ? pick('audiooutput') : [];
    } catch {
      this.inputs = this.outputs = [];
    }
    this.onChange();
  }

  // ----- Listening -----

  play(audio) {
    audio.play().then(
      () => {},
      (e) => {
        if (e?.name !== 'NotAllowedError') return;
        this.playBlocked = true;
        this.onChange();
      },
    );
  }

  // Must run inside a click/keypress: browsers only start held-back audio on a user gesture.
  unlockAudio() {
    this.playBlocked = false;
    this.ctx?.resume();
    for (const p of this.peers.values()) if (p.audio?.srcObject) this.play(p.audio);
    this.onChange();
  }

  setOutput(id) {
    setSetting('voiceOut', id);
    for (const p of this.peers.values()) p.audio?.setSinkId?.(id).catch(() => {});
  }

  toggleMute(id) {
    if (this.muted.has(id)) this.muted.delete(id);
    else this.muted.add(id);
    this.applyVolume(id);
    this.onChange();
  }

  setGain(id, v) {
    this.gains.set(id, v);
    this.applyVolume(id);
  }

  applyVolume(id) {
    const audio = this.peers.get(id)?.audio;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, settings.voiceVol * settings.master * (this.gains.get(id) ?? 1)));
    audio.muted = this.muted.has(id);
  }

  analyse(stream) {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const source = this.ctx.createMediaStreamSource(stream);
      const node = this.ctx.createAnalyser();
      node.fftSize = 512;
      source.connect(node); // measuring only; playback goes through the <audio> element
      return { source, node };
    } catch {
      return null;
    }
  }

  level(a) {
    if (!a) return 0;
    a.node.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  // How loud your mic is right now (0..1), even when push-to-talk isn't held: for the test meter.
  micLevel() {
    return Math.min(1, this.level(this.micAnalyser) * 8);
  }

  // Once a frame: work out who's talking for the HUD indicators.
  update() {
    const now = performance.now();
    const speaking = new Set();
    if (this.transmitting && this.level(this.micAnalyser) > SPEAK_LEVEL) this.selfSpeakUntil = now + SPEAK_HOLD_MS;
    if (this.transmitting && now < this.selfSpeakUntil) speaking.add(this.myId);
    for (const [id, p] of this.peers) {
      if (!p.pc || this.muted.has(id)) continue;
      if (this.level(p.analyser) > SPEAK_LEVEL) p.speakUntil = now + SPEAK_HOLD_MS;
      if (now < p.speakUntil) speaking.add(id);
    }
    const changed = speaking.size !== this.speaking.size || [...speaking].some((id) => !this.speaking.has(id));
    this.speaking = speaking;
    if (changed) this.onChange();
  }

  // For the roster: null (not in voice) | 'talk' | 'muted' | 'bad' | 'on'
  badge(p) {
    if (!this.active || p.bot || !p.vc) return null;
    if (p.id !== this.myId && this.muted.has(p.id)) return 'muted';
    if (this.speaking.has(p.id)) return 'talk';
    if (p.id !== this.myId && this.peerState(p) === 'failed') return 'bad';
    return 'on';
  }
}
