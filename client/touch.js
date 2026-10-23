// On-screen controls for phones/tablets: a floating stick that appears wherever your left thumb
// lands, plus round A / B / X buttons on the right.
export function setupTouch(input) {
  if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
  const root = document.getElementById('touch');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  root.classList.remove('hidden');
  document.body.classList.add('touch'); // moves the sound button out of the thumb zone
  const R = 56;
  let stickId = null;
  let ox = 0;
  let oy = 0;

  addEventListener('touchstart', () => (input.device = 'touch'), { passive: true });

  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.tbtn');
    if (btn) {
      input.device = 'touch';
      input.press(btn.dataset.action);
      btn.classList.add('down');
      setTimeout(() => btn.classList.remove('down'), 120);
      return;
    }
    if (e.clientX > innerWidth * 0.5 || stickId !== null) return;
    stickId = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    stick.style.left = `${ox}px`;
    stick.style.top = `${oy}px`;
    stick.classList.add('active');
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.touchMove = { x: dx / R, y: -dy / R };
  });
  const end = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    stick.classList.remove('active');
    knob.style.transform = '';
    input.touchMove = { x: 0, y: 0 };
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}
