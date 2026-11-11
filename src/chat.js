// Chat: a message log + input, and speech bubbles projected above heads.
import {CHAT_MAX} from './protocol.js';

export function createBubble(text, {typing = false} = {}) {
  const el = document.createElement('div');
  el.className = 'bubble' + (typing ? ' typing' : '');
  if (typing) { el.setAttribute('aria-label', 'Typing'); for (let i = 0; i < 3; i++) el.append(document.createElement('i')); }
  else el.textContent = text;
  el.hidden = true;
  document.getElementById('bubbles').append(el);
  let w = 0, h = 0, measuredFor = '';
  return {
    // edge: -1 / 1 when its player is out of view to the left / right (x, y then a spot on that side of the screen)
    update(x, y, visible, edge = 0) {
      if (el.hidden === visible) el.hidden = !visible;
      if (!visible) return y;
      const key = innerWidth + 'x' + innerHeight;
      if (measuredFor !== key) { w = el.offsetWidth; h = el.offsetHeight; measuredFor = key; }
      if (edge !== (el._edge || 0)) { el.classList.toggle('edge-l', edge < 0); el.classList.toggle('edge-r', edge > 0); el._edge = edge; }
      if (edge) {
        el.style.transform = `translate(${Math.round(edge < 0 ? 14 : innerWidth - w - 14)}px, ${Math.round(Math.max(8, y - h / 2))}px)`;
        return y - h / 2 - 6;
      }
      el.style.transform = `translate(${Math.round(Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)))}px, ${Math.round(Math.max(8, y - h - 10))}px)`;
      return y - h - 6;
    },
    dispose() { el.remove(); },
  };
}

export function createChatUI({onSend, onOpenChange}) {
  const root = document.getElementById('chat');
  const log = root.querySelector('.log');
  const form = root.querySelector('form');
  const input = form.querySelector('input');
  input.maxLength = CHAT_MAX;
  let open = false;
  for (const type of ['keydown', 'keyup', 'pointerdown']) form.addEventListener(type, e => e.stopPropagation());
  function setOpen(value) {
    if (open === value) return;
    open = value; root.classList.toggle('open', open); form.hidden = !open;
    if (open) { input.focus({preventScroll: true}); log.scrollTop = log.scrollHeight; }
    else { input.blur(); }
    onOpenChange?.(open);
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && onSend(text) !== false) input.value = '';
    setOpen(false);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); setOpen(false); } });
  return {
    get open() { return open; },
    get typing() { return open && input.value.trim().length > 0; },
    setOpen,
    record(text, {own = false, system = false, hue = 0, name = null} = {}) {
      const line = document.createElement('div');
      line.className = 'line' + (own ? ' own' : '') + (system ? ' system' : '');
      if (name !== null) {
        const who = document.createElement('b'); who.className = 'who';
        who.textContent = (name || 'anon') + ':';
        line.append(who, ' ' + text);
      } else line.textContent = text;
      line.style.setProperty('--hue', hue);
      log.append(line);
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
      // lines fade out after a while unless the chat is open
      setTimeout(() => line.classList.add('old'), 14000);
    },
  };
}
