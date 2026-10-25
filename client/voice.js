// Voice chat: peer-to-peer WebRTC audio between the humans in a room. Rooms hold at most 4 people,
// so everyone connects straight to everyone else (a full mesh) and the game server only relays the
// offer/answer that sets each connection up. You can listen without a microphone; the mic is opt-in
// (the mic button), either always open or push-to-talk (hold V, or hold the mic button).
import { settings, onSettings, setSetting } from './settings.js';

const SPEAK_LEVEL = 0.015; // RMS above this counts as talking
const SPEAK_HOLD_MS = 350; // keep the indicator on through short pauses between words
const ICE_WAIT_MS = 2500; // send the offer/answer once candidates are gathered, or after this long
const ICE_SETTLE_MS = 250; // …or this soon after the first public (STUN/TURN) candidate shows up
const RETRY_MS = 3000;
const MAX_RETRIES = 3;
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

export class Voice {
  // onChange: something the HUD shows changed (who's talking, mutes, mic state).
  constructor(net, { onChange, toast }) {
    this.net = net;
    this.onChange = onChange;
    this.toast = toast;
    this.myId = null;
    this.room = null; // { tutorial, isPublic } while we're in a room
    this.players = [];
    this.peers = new Map(); // id → { pc, audio, analyser, speakUntil }
    this.retries = new Map(); // id → failed attempts
    this.muted = new Set(); // players you've muted
    this.mic = null; // MediaStream while the mic is on
    this.micAnalyser = null;
    this.asking = false;
    this.denied = false;
    this.holding = 0; // push-to-talk: key and/or button held
    this.selfSpeakUntil = 0;
    this.speaking = new Set();
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

    let prev = null;
    onSettings((st) => {
      for (const p of this.peers.values()) this.applyVolume(p);
      if (prev && (st.voiceOn !== prev.voiceOn || st.micMode !== prev.micMode)) {
        this.holding = 0;
        this.announce();
        this.reconcile();
        if (!this.active) this.stopMic();
        else if (st.voiceOn !== prev.voiceOn && st.micOn) this.enableMic();
        this.applyMic();
      }
      prev = { voiceOn: st.voiceOn, micMode: st.micMode };
    });
  }

  // In a room with other people, and voice chat is switched on.
  get active() {
    return !!this.room && !this.room.tutorial && settings.voiceOn;
  }

  get transmitting() {
    return !!this.mic && (settings.micMode === 'open' || this.holding > 0);
  }

  // What the mic button shows: off | asking | denied | open | ptt | talking
  get micState() {
    if (this.asking) return 'asking';
    if (!this.mic) return this.denied ? 'denied' : 'off';
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
    this.onChange();
  }

  leave() {
    if (this.active) this.net.send({ t: 'voice', on: false });
    this.room = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stopMic();
  }

  announce() {
    if (this.room) this.net.send({ t: 'voice', on: this.active });
  }

  roster(players) {
    this.players = players;
    this.reconcile();
    this.onChange();
  }

  // Connect to everyone else in voice; hang up on anyone who left it. The lower id always makes the
  // offer, so two players never call each other at the same time.
  reconcile() {
    const want = new Set();
    if (this.active) {
      for (const p of this.players) if (!p.bot && p.vc && p.id !== this.myId) want.add(p.id);
    }
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.closePeer(id);
    for (const id of [...this.retries.keys()]) if (!want.has(id)) this.retries.delete(id);
    for (const id of want) {
      if (!this.peers.has(id) && this.myId < id && (this.retries.get(id) ?? 0) < MAX_RETRIES) this.call(id);
    }
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
    const peer = { pc, audio, analyser: null, speakUntil: 0, offerer: this.myId < id };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {});
      peer.analyser = this.analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      if (pc.connectionState === 'connected') this.retries.delete(id);
      if (pc.connectionState !== 'failed') return;
      this.closePeer(id);
      // The offerer calls again a few times; the other side just waits for the new offer.
      if (peer.offerer) {
        this.retries.set(id, (this.retries.get(id) ?? 0) + 1);
        setTimeout(() => this.reconcile(), RETRY_MS);
      }
    };
    this.peers.set(id, peer);
    this.applyVolume(peer, id);
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

  async enableMic() {
    if (this.mic || this.asking) return;
    if (!navigator.mediaDevices?.getUserMedia) return this.toast('voice.unsupported');
    this.asking = true;
    this.onChange();
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: MIC });
      this.denied = false;
      setSetting('micOn', true);
    } catch {
      this.denied = true;
      this.toast('voice.denied');
    }
    this.asking = false;
    if (this.mic && !this.active) return this.stopMic(); // left the room or turned voice off meanwhile
    if (this.mic) {
      this.micAnalyser = this.analyse(this.mic);
      for (const p of this.peers.values()) this.syncTrack(p);
    }
    this.applyMic();
    this.onChange();
  }

  // Turning the mic off releases it completely (the browser's recording light goes out).
  disableMic() {
    this.stopMic();
    setSetting('micOn', false);
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

  // The mic button: first press asks for the mic; after that it mutes/unmutes (open mic)
  // or talks while held (push-to-talk, handled by press/release).
  toggleMic() {
    if (!this.mic) this.enableMic();
    else if (settings.micMode === 'open') this.disableMic();
  }

  // ----- Listening -----

  toggleMute(id) {
    if (this.muted.has(id)) this.muted.delete(id);
    else this.muted.add(id);
    const peer = this.peers.get(id);
    if (peer?.audio) this.applyVolume(peer, id);
    this.onChange();
  }

  applyVolume(peer, id) {
    if (!peer.audio) return;
    id ??= [...this.peers].find(([, p]) => p === peer)?.[0];
    peer.audio.volume = Math.max(0, Math.min(1, settings.voiceVol * settings.master));
    peer.audio.muted = this.muted.has(id);
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

  // For the roster: null (not in voice) | 'talk' | 'muted' | 'on'
  badge(p) {
    if (!this.active || p.bot || !p.vc) return null;
    if (p.id !== this.myId && this.muted.has(p.id)) return 'muted';
    return this.speaking.has(p.id) ? 'talk' : 'on';
  }
}
