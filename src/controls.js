// Keyboard + mouse (pointer lock), touch (joystick + drag to look) and gamepad input.
// Gamepads (any the browser reads as the standard layout: Xbox, PlayStation, Switch Pro and most others):
//   left stick move (click it, or hold LB, to run) · right stick look · A jump · B crouch (hold) · X use ·
//   Y switch view · RT punch / grab / fire (held: keeps firing) · LT drop · RB emotes · View/Select tags or paint ·
//   Menu/Start chat · d-pad: in a menu, moves between its buttons (A picks, B shuts it); otherwise onDpad
//   (main.js: with a can, the next or previous tag, and its size; LB and left or right turns it)
export function createControls({canvas, isTouch, onToggleView, onJump, onChat, onEmotes, onCrouchToggle, onLockChange, onPrimary, onSecondary, onUse, onGallery,
  menuOpen = () => false, onMenuMove, onMenuPick, onMenuBack, onDpad, onPadChange}) {
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

  // ------------------------------------------------------------- gamepad
  const DEAD = .16, LOOK_YAW = 3.1, LOOK_PITCH = 2.1;   // radians a second at full tilt
  let padWas = [], padRun = false, padAt = 0, padRepeat = 0, padActive = false, pad = {moveX: 0, moveZ: 0, run: false, crouch: false};
  const stickOf = (x, y) => {   // a radial dead zone, then a gentle curve: fine aim near the middle
    const m = Math.hypot(x, y);
    if (m < DEAD) return [0, 0];
    const k = Math.min(1, (m - DEAD) / (1 - DEAD)), c = k * k * .6 + k * .4;
    return [x / m * c, y / m * c];
  };
  function setPadActive(on) {
    if (padActive === on) return;
    padActive = on; state.pad = on; document.body.classList.toggle('pad', on); onPadChange?.(on);
  }
  // any key or mouse move hands control back to the keyboard and mouse
  addEventListener('keydown', () => setPadActive(false));
  document.addEventListener('mousemove', e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) setPadActive(false); });
  function readPad(now) {
    const dt = Math.min(.1, (now - (padAt || now)) / 1000); padAt = now;
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected && g.buttons.length >= 16);
    if (!gp) { pad = {moveX: 0, moveZ: 0, run: false, crouch: false}; if (state.firing && padWas[7]) state.firing = false; padWas = []; return; }
    const b = gp.buttons.map(x => x.pressed || x.value > .5), was = padWas;
    const down = i => b[i] && !was[i];
    padWas = b;
    const [mx, mz] = stickOf(gp.axes[0] || 0, gp.axes[1] || 0), [lx, ly] = stickOf(gp.axes[2] || 0, gp.axes[3] || 0);
    if (b.some(Boolean) || mx || mz || lx || ly) setPadActive(true);
    if (!padActive) return;
    const menu = menuOpen();
    // the d-pad: menus, or the held thing's own steps (repeating while held)
    const dirs = [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']].filter(([i]) => b[i]).map(([, d]) => d);
    if (dirs.length) {
      const fresh = [12, 13, 14, 15].some(down);
      if (fresh || now > padRepeat) {
        padRepeat = now + (fresh ? 380 : 120);
        if (menu) onMenuMove?.(dirs[0]); else onDpad?.(dirs[0], b[4]);
      }
    } else if (menu && (Math.abs(mx) > .5 || Math.abs(mz) > .5)) {   // the left stick moves about a menu too
      if (now > padRepeat) { padRepeat = now + 220; onMenuMove?.(Math.abs(mx) > Math.abs(mz) ? (mx > 0 ? 'right' : 'left') : (mz > 0 ? 'down' : 'up')); }
    } else if (!dirs.length && Math.abs(mx) <= .5 && Math.abs(mz) <= .5) padRepeat = 0;
    if (menu) {
      if (down(0)) onMenuPick?.();
      if (down(1)) onMenuBack?.();
      if (down(5)) onEmotes();                       // RB shuts the emote menu again
      if (down(8)) onGallery?.();
      if (down(9)) onMenuBack?.();
      pad = {moveX: 0, moveZ: 0, run: false, crouch: false};
      return;
    }
    if (lx || ly) look(lx * LOOK_YAW * dt, ly * LOOK_PITCH * dt);
    if (down(10)) padRun = !padRun;
    if (!mx && !mz) padRun = false;                  // stopping ends a run
    pad = {moveX: mx, moveZ: mz, run: padRun || b[4], crouch: b[1]};
    if (down(0)) onJump();
    if (down(2)) onUse?.();
    if (down(3)) onToggleView();
    if (down(5)) onEmotes();
    if (down(8)) onGallery?.();
    if (down(9)) onChat();
    if (down(6)) onSecondary?.();
    if (down(7)) { state.firing = true; onPrimary?.(); }
    if (!b[7] && was[7]) state.firing = false;
  }

  return {
    state,
    look,
    release() { if (document.pointerLockElement) document.exitPointerLock(); },
    update() {
      readPad(performance.now());
      const k = c => keys.has(c);
      let x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
      let z = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
      if (stickId !== null) { x = stickMove.x; z = stickMove.y; }
      if (pad.moveX || pad.moveZ) { x = pad.moveX; z = pad.moveZ; }
      const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
      state.moveX = x; state.moveZ = z;
      state.run = k('ShiftLeft') || k('ShiftRight') || (stickId !== null && Math.hypot(stickMove.x, stickMove.y) > .92) || pad.run;
      state.crouch = k('KeyC') || touchCrouch || pad.crouch;
      return state;
    },
  };
}
