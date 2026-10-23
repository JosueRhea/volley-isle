import * as THREE from 'three';
import { glyph } from './hud.js';
import { sideSign } from '../shared/physics.js';
import { t as tr } from './i18n.js';

const $ = (id) => document.getElementById(id);

// Each step: enter() sets it up, tick() watches the player, event() reacts to server events.
// Call t.success() to move on, t.retry() to explain a miss and set the drill up again.
const STEPS = [
  {
    key: 'run',
    enter(t) {
      t.showMarker(t.side * 4, -2.5);
    },
    tick(t) {
      if (t.nearMarker(0.9)) t.success(tr('tut.run.ok'));
    },
  },
  {
    key: 'jump',
    enter(t) {
      t.jumps = 0;
      t.wasAir = false;
    },
    tick(t) {
      const air = t.me.y > 0.3;
      if (air && !t.wasAir && ++t.jumps >= 2) t.success(tr('tut.jump.ok'));
      t.wasAir = air;
    },
  },
  {
    key: 'pass',
    enter(t) {
      t.later(0.9, () => t.drill('pass'));
    },
    event(t, ev) {
      if (ev.k === 'hit' && ev.id === t.myId) {
        if (ev.kind === 'pass') t.success(tr('tut.pass.ok'));
        else t.retry(tr('tut.pass.over'), () => t.drill('pass'));
      } else if (ev.k === 'drill') t.retry(tr('tut.pass.miss'), () => t.drill('pass'));
    },
  },
  {
    key: 'spike',
    enter(t) {
      t.showMarker(t.side * 2.4, 0);
      t.fed = false;
    },
    tick(t) {
      if (!t.fed && t.nearMarker(1.1)) {
        t.fed = true;
        t.later(0.4, () => t.drill('set'));
      }
    },
    event(t, ev) {
      if (ev.k === 'hit' && ev.id === t.myId) {
        if (ev.kind === 'spike') t.success(tr('tut.spike.ok'));
        else t.retry(tr('tut.spike.ground'), () => (t.fed = false));
      } else if (ev.k === 'drill') t.retry(tr('tut.spike.miss'), () => (t.fed = false));
    },
  },
  {
    key: 'tip',
    enter(t) {
      t.showMarker(t.side * 2.4, 0);
      t.fed = false;
    },
    tick(t) {
      if (!t.fed && t.nearMarker(1.1)) {
        t.fed = true;
        t.later(0.4, () => t.drill('set'));
      }
    },
    event(t, ev) {
      if (ev.k === 'hit' && ev.id === t.myId) {
        if (ev.kind === 'tip') t.success(tr('tut.tip.ok'));
        else t.retry(tr('tut.tip.wrong'), () => (t.fed = false));
      } else if (ev.k === 'drill') t.retry(tr('tut.tip.miss'), () => (t.fed = false));
    },
  },
  {
    key: 'dive',
    enter(t) {
      t.showMarker(t.side * 5, 0);
      t.fed = false;
    },
    tick(t) {
      if (!t.fed && t.nearMarker(0.9)) {
        t.fed = true;
        t.later(0.6, () => t.drill('dive'));
      }
    },
    event(t, ev) {
      if (ev.k === 'hit' && ev.id === t.myId) {
        if (ev.kind === 'dig') t.success(tr('tut.dive.ok'));
        else t.success(tr('tut.dive.ran'));
      } else if (ev.k === 'drill') t.retry(tr('tut.dive.miss'), () => (t.fed = false));
    },
  },
  {
    key: 'serve',
    enter(t) {
      t.hideMarker();
      t.later(0.6, () => t.drill('serve'));
    },
    event(t, ev) {
      if (ev.k === 'hit' && ev.id === t.myId && ev.kind === 'serve') {
        if (ev.zone === 'perfect') t.success(tr('tut.serve.perfect'));
        else if (ev.zone === 'good') t.success(tr('tut.serve.good'));
        else t.pendingMiss = ev.zone;
      } else if (ev.k === 'drill' && t.pendingMiss) {
        const tip = tr(t.pendingMiss === 'short' ? 'tut.serve.weak' : 'tut.serve.strong');
        t.pendingMiss = null;
        t.retry(tip, () => t.drill('serve'));
      }
    },
  },
  {
    key: 'done',
    final: true,
    enter(t) {
      t.hideMarker();
      localStorage.setItem('volley:tutorialDone', '1');
    },
  },
];

export class Tutorial {
  constructor({ scene, net, sfx, state, me, input }) {
    Object.assign(this, { scene, net, sfx, state, me, input });
    this.i = -1;
    this.timers = [];
    this.t = 0;

    // Glowing target ring with a soft light column.
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 2.4, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 1.2;
    this.marker.add(ring, beam);
    this.marker.visible = false;
    scene.add(this.marker);

    $('tut-skip').onclick = () => this.go(this.i + 1);
  }

  get myId() {
    return this.state.myId;
  }

  get side() {
    return sideSign(this.state.myTeam);
  }

  start() {
    document.body.classList.add('tutorial');
    $('tutorial').classList.remove('hidden');
    this.go(0);
  }

  go(i) {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.i = Math.min(i, STEPS.length - 1);
    this.step = STEPS[this.i];
    this.done = false;
    this.pendingMiss = null;
    this.render('');
    this.step.enter?.(this);
  }

  render(note = this.note ?? '') {
    if (!this.step) return;
    this.note = note;
    const g = (a) => glyph(this.input.device, a);
    const k = this.step.key;
    $('tut-step').textContent = this.step.final ? tr('tut.complete') : tr('tut.step', { n: this.i + 1, total: STEPS.length - 1 });
    $('tut-title').textContent = tr(`tut.${k}.title`);
    $('tut-text').innerHTML = tr(`tut.${k}.text`, { move: g('move'), jump: g('jump'), hit: g('hit'), tip: g('tip') });
    $('tut-note').textContent = note;
    $('tut-note').className = note ? 'show' : '';
    $('tut-dots').innerHTML = STEPS.slice(0, -1)
      .map((_, k) => `<i class="${k < this.i || this.step.final ? 'done' : k === this.i ? 'now' : ''}"></i>`)
      .join('');
    $('tut-skip').classList.toggle('hidden', !!this.step.final);
    $('tut-final').classList.toggle('hidden', !this.step.final);
  }

  later(seconds, fn) {
    this.timers.push(setTimeout(fn, seconds * 1000));
  }

  drill(kind) {
    this.net.send({ t: 'drill', kind });
  }

  showMarker(x, z) {
    this.marker.position.set(x, 0, z);
    this.marker.visible = true;
  }

  hideMarker() {
    this.marker.visible = false;
  }

  nearMarker(r) {
    return this.marker.visible && Math.hypot(this.me.x - this.marker.position.x, this.me.z - this.marker.position.z) < r;
  }

  success(message) {
    if (this.done) return;
    this.done = true;
    this.hideMarker();
    this.sfx.serveResult('perfect');
    $('tutorial').classList.remove('cheer');
    void $('tutorial').offsetWidth;
    $('tutorial').classList.add('cheer');
    this.render(message);
    this.later(1.8, () => this.go(this.i + 1));
  }

  retry(message, again) {
    if (this.done) return;
    this.render(message);
    this.later(1.2, again);
  }

  onEvent(ev) {
    if (!this.done) this.step?.event?.(this, ev);
  }

  update(dt) {
    this.t += dt;
    if (this.marker.visible) {
      const pulse = 1 + Math.sin(this.t * 5) * 0.08;
      this.marker.children[0].scale.setScalar(pulse);
    }
    if (!this.done) this.step?.tick?.(this, dt);
  }
}
