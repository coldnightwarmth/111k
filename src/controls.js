// Keyboard + mouse (pointer lock) and touch (joystick + drag to look) input.
export function createControls({canvas, isTouch, onToggleView, onJump, onChat, onEmotes, onCrouchToggle, onLockChange, onPrimary, onSecondary, onUse, onGallery}) {
  const keys = new Set();
  const state = {yaw: 0, pitch: 0, moveX: 0, moveZ: 0, run: false, crouch: false, locked: false, touch: isTouch, firing: false};
  const PITCH = 1.35;
  let touchCrouch = false;

  // ------------------------------------------------------------- keyboard
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Enter') { e.preventDefault(); onChat(); return; }
    // Tab stands in for Esc: it lets go of the mouse (which opens the tags or paint list with a can or
    // the paintball gun in hand) and, with the mouse free, shuts menus (main.js), rather than moving focus about
    if (e.code === 'Tab') { e.preventDefault(); if (state.locked) document.exitPointerLock?.(); return; }
    if (e.code === 'KeyV' && !e.repeat) onToggleView();
    if (e.code === 'KeyE' && !e.repeat) onEmotes();
    if (e.code === 'KeyF' && !e.repeat) onUse?.();
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) onJump(); }
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // ------------------------------------------------------- mouse look
  canvas.addEventListener('click', () => { if (!state.touch && !state.locked) canvas.requestPointerLock?.()?.catch?.(() => {}); });
  // while the mouse is captured: left click acts (punch / grab / torch on-off), right click drops
  document.addEventListener('mousedown', e => {
    if (!state.locked) return;
    if (e.button === 0) { state.firing = true; onPrimary?.(); }
    else if (e.button === 2) onSecondary?.();
  });
  document.addEventListener('mouseup', e => { if (e.button === 0) state.firing = false; });
  document.addEventListener('contextmenu', e => { if (state.locked || e.target === canvas) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) { lockedAt = performance.now(); last = 0; held = null; }
    if (!state.locked) { keys.clear(); state.firing = false; }
    onLockChange?.(state.locked);
  });
  // Now and then the mouse's movement comes in as one huge jump that never happened: a long-standing Chrome
  // bug when it re-centres the hidden cursor (worse when the page is busy: more players, lower frame rate),
  // and the first move after the mouse is captured can carry the cursor's whole trip to the middle. Taken
  // as it comes, that's a sudden half-turn (about 1400 px is 180 degrees here). Such a jump stands alone,
  // where a real flick builds up and carries on: so a move far bigger than the one before is held back
  // for one event, and only goes through if the next one carries on the same way. A big move straight
  // after capturing the mouse is dropped.
  const SPIKE_PX = 250, SPIKE_RATIO = 8, SETTLE_MS = 150;
  let last = 0, lastMoveAt = 0, lockedAt = 0, held = null;
  document.addEventListener('mousemove', e => {
    if (!state.locked) return;
    const dx = e.movementX || 0, dy = e.movementY || 0, m = Math.hypot(dx, dy), t = performance.now();
    last *= Math.exp(-(t - lastMoveAt) / 300);           // the move before, fading as it stops
    lastMoveAt = t;
    if (t - lockedAt < SETTLE_MS && m > 60) { held = null; return; }
    let goesOn = false;
    if (held) {                                           // a big jump just now: real if this carries on from it
      goesOn = dx * held.dx + dy * held.dy > 0 && m * 4 >= held.m;
      if (goesOn) look(held.dx * .0022, held.dy * .0022);
      held = null;
    }
    if (!goesOn && m > SPIKE_PX && m > SPIKE_RATIO * Math.max(last, 30)) { held = {dx, dy, m}; return; }
    last = m;
    look(dx * .0022, dy * .0022);
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
    // (a finger whose lift went missing, its id since reused: start again from where this one is, not jump)
    if (lookId !== null && e.pointerId !== lookId) return;
    lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId);
  });
  // looking: the finger can be anywhere once it's down (so a thumb that pressed jump or punch
  // can keep sliding to steer), so moves and lifts are watched on the whole document
  document.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId) return;
    look((e.clientX - lastX) * .0055, (e.clientY - lastY) * .0055);
    lastX = e.clientX; lastY = e.clientY;
  });
  let fireId = null;
  const endPointer = e => {
    if (e.pointerId === lookId) lookId = null;
    if (e.pointerId === fireId) { fireId = null; state.firing = false; }
  };
  document.addEventListener('pointerup', endPointer); document.addEventListener('pointercancel', endPointer);
  const tap = (id, fn, steer = false) => document.getElementById(id).addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); fn(e);
    if (steer && lookId === null) { lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; }
  });
  tap('btnJump', onJump, true);
  tap('btnCrouch', () => { touchCrouch = !touchCrouch; document.getElementById('btnCrouch').classList.toggle('on', touchCrouch); onCrouchToggle?.(touchCrouch); }, true);
  tap('btnChat', onChat);
  tap('btnEmote', onEmotes);
  tap('btnView', onToggleView, true);
  tap('btnAct', e => { state.firing = true; fireId = e.pointerId; onPrimary?.(); }, true);
  tap('btnGallery', () => onGallery?.());
  tap('btnDrop', () => onSecondary?.());

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
      state.crouch = k('KeyC') || touchCrouch;
      return state;
    },
  };
}
