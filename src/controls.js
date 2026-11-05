// Keyboard + mouse (pointer lock) and touch (joystick + drag to look) input.
export function createControls({canvas, isTouch, onToggleView, onJump, onChat, onEmotes, onCrouchToggle, onLockChange}) {
  const keys = new Set();
  const state = {yaw: 0, pitch: 0, moveX: 0, moveZ: 0, run: false, crouch: false, locked: false, touch: isTouch};
  const PITCH = 1.35;
  let touchCrouch = false;

  // ------------------------------------------------------------- keyboard
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Enter') { e.preventDefault(); onChat(); return; }
    if (e.code === 'KeyV' && !e.repeat) onToggleView();
    if (e.code === 'KeyE' && !e.repeat) onEmotes();
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) onJump(); }
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // ------------------------------------------------------- mouse look
  canvas.addEventListener('click', () => { if (!state.touch && !state.locked) canvas.requestPointerLock?.()?.catch?.(() => {}); });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) keys.clear();
    onLockChange?.(state.locked);
  });
  document.addEventListener('mousemove', e => {
    if (!state.locked) return;
    look(e.movementX * .0022, e.movementY * .0022);
  });
  function look(dx, dy) {
    state.yaw -= dx;
    state.pitch = Math.max(-PITCH, Math.min(PITCH, state.pitch - dy));
  }

  // ------------------------------------------------------------- touch
  const stick = document.getElementById('stick'), thumb = stick.querySelector('i');
  let stickId = null, lookId = null, lastX = 0, lastY = 0;
  const stickMove = {x: 0, y: 0};
  function stickAt(e) {
    const r = stick.getBoundingClientRect(), radius = r.width / 2;
    let dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + radius);
    const d = Math.hypot(dx, dy), max = radius * .8;
    if (d > max) { dx *= max / d; dy *= max / d; }
    stickMove.x = dx / max; stickMove.y = dy / max;
    thumb.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function stickEnd() { stickId = null; stickMove.x = stickMove.y = 0; thumb.style.transform = ''; stick.classList.remove('active'); }
  stick.addEventListener('pointerdown', e => {
    e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stick.classList.add('active'); stickAt(e);
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickAt(e); });
  stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    state.touch = true; document.body.classList.add('touch');
    if (lookId !== null) return;
    lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId) return;
    look((e.clientX - lastX) * .0055, (e.clientY - lastY) * .0055);
    lastX = e.clientX; lastY = e.clientY;
  });
  const endLook = e => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
  const tap = (id, fn) => document.getElementById(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
  tap('btnJump', onJump);
  tap('btnCrouch', () => { touchCrouch = !touchCrouch; document.getElementById('btnCrouch').classList.toggle('on', touchCrouch); onCrouchToggle?.(touchCrouch); });
  tap('btnChat', onChat);
  tap('btnEmote', onEmotes);
  tap('btnView', onToggleView);

  return {
    state,
    look,
    release() { if (document.pointerLockElement) document.exitPointerLock(); },
    update() {
      const k = c => keys.has(c);
      let x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
      let z = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
      if (stickId !== null) { x = stickMove.x; z = stickMove.y; }
      const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
      state.moveX = x; state.moveZ = z;
      state.run = k('ShiftLeft') || k('ShiftRight') || (stickId !== null && Math.hypot(stickMove.x, stickMove.y) > .92);
      state.crouch = k('KeyC') || k('ControlLeft') || touchCrouch;
      return state;
    },
  };
}
