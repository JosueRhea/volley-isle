const HIT_KEYS = new Set(['KeyJ', 'KeyE', 'Enter']);
const TIP_KEYS = new Set(['KeyK', 'ShiftLeft', 'ShiftRight']);
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
// Standard gamepad layout: 0 = bottom (A), 1 = right (B), 2 = left (X)
const PAD = { jump: 0, tip: 1, hit: 2 };

// Keyboard + mouse + gamepad + touch. Actions are counted presses so quick taps are never lost.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = { jump: 0, hit: 0, tip: 0 };
    this.padPrev = [];
    this.touchMove = { x: 0, y: 0 };
    this.device = 'keyboard'; // 'keyboard' | 'gamepad' | 'touch' — drives which button prompts we show
    this.enabled = true; // off while a menu is open

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.device = 'keyboard';
      if (!e.repeat) {
        if (e.code === 'Space') this.pressed.jump++;
        if (HIT_KEYS.has(e.code)) this.pressed.hit++;
        if (TIP_KEYS.has(e.code)) this.pressed.tip++;
      }
      this.keys.add(e.code);
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.device = 'keyboard';
      if (e.button === 0) this.pressed.hit++;
      if (e.button === 2) this.pressed.jump++;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  press(action) {
    this.pressed[action]++;
  }

  clear() {
    this.keys.clear();
    for (const k in this.pressed) this.pressed[k] = 0;
  }

  consume(name) {
    const hit = this.enabled && this.pressed[name] > 0;
    this.pressed[name] = 0;
    return hit;
  }

  // Returns { x: right, y: forward (toward the net) }, length <= 1.
  move() {
    const k = (...codes) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    let x = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let y = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');

    if (this.device === 'touch') {
      x = this.touchMove.x;
      y = this.touchMove.y;
    }

    const pad = navigator.getGamepads?.().find(Boolean);
    if (pad) {
      const [ax, ay] = pad.axes;
      if (Math.hypot(ax, ay) > 0.2) {
        x = ax;
        y = -ay;
        this.device = 'gamepad';
      }
      for (const [action, i] of Object.entries(PAD)) {
        const down = !!pad.buttons[i]?.pressed;
        if (down && !this.padPrev[i]) {
          this.pressed[action]++;
          this.device = 'gamepad';
        }
      }
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

    if (!this.enabled) return { x: 0, y: 0 };
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }
}
