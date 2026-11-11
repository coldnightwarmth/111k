// Getting about a menu with a gamepad: the d-pad (or left stick) moves a highlight from button to button as
// they're laid out on screen, A presses the highlighted one. Used by the game's own menus (src/main.js, through
// src/controls.js) and, on its own, by the look picker that comes up before the game (navigateWithPad).

const visible = root => [...root.querySelectorAll('button, input')].filter(b => b.offsetParent && !b.disabled && !b.closest('[hidden]'));

export function padFocus(el) {
  for (const o of document.querySelectorAll('.padsel')) o.classList.remove('padsel');
  if (!el) return;
  el.classList.add('padsel'); el.focus({preventScroll: true}); el.scrollIntoView({block: 'nearest', inline: 'nearest'});
}
export const padSelected = () => document.querySelector('.padsel');

// the nearest button that way from the highlighted one (or, to start, the chosen one or the first)
export function padMove(root, dir) {
  const list = visible(root).filter(b => b.tagName === 'BUTTON');
  const at = list.find(b => b.classList.contains('padsel'));
  if (!at) { padFocus(root.querySelector('button.chosen') || root.querySelector('button.card') || list[0]); return; }
  const c = r => ({x: r.left + r.width / 2, y: r.top + r.height / 2}), from = c(at.getBoundingClientRect());
  const [ux, uy] = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]}[dir];
  let best = null, bestScore = Infinity;
  for (const b of list) {
    if (b === at) continue;
    const p = c(b.getBoundingClientRect()), dx = p.x - from.x, dy = p.y - from.y, along = dx * ux + dy * uy;
    if (along < 4) continue;
    const score = along + Math.abs(dx * uy - dy * ux) * 2.5;   // straight that way first
    if (score < bestScore) { bestScore = score; best = b; }
  }
  // nothing further down: the button pinned to the bottom (the picker's "enter"), if it's a different one
  if (!best && dir === 'down') best = root.querySelector('[data-pad-end]:not([disabled])');
  if (best && best !== at) padFocus(best);
}
export function padPick(root) {
  const b = padSelected() || root.querySelector('button.chosen');
  if (b && root.contains(b)) b.click();
}

// a gamepad on a menu that stands on its own (no game running yet): polled until `done()` says it's over
export function navigateWithPad(root, done) {
  let was = [], repeat = 0;
  const tick = now => {
    if (done()) { padFocus(null); return; }
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected && g.buttons.length >= 16);
    if (gp) {
      const b = gp.buttons.map(x => x.pressed || x.value > .5), down = i => b[i] && !was[i];
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dir = b[12] ? 'up' : b[13] ? 'down' : b[14] ? 'left' : b[15] ? 'right'
        : Math.abs(ax) > .5 || Math.abs(ay) > .5 ? (Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up')) : null;
      const fresh = [12, 13, 14, 15].some(down) || (dir && !was.dir);
      if (dir && (fresh || now > repeat)) { repeat = now + (fresh ? 380 : 140); padMove(root, dir); }
      if (down(0)) padPick(root);
      if (down(9)) root.querySelector('[data-pad-end]:not([disabled])')?.click();   // Start: straight on
      was = b; was.dir = dir;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
