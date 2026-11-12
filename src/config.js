// Where the multiplayer server lives. On localhost the dev server handles it on
// the same port; everywhere else the Cloudflare Worker does. `?server=` overrides.
const PRODUCTION = 'wss://111k-room.meinong.workers.dev/connect';

export function serverUrl() {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return `ws://${location.host}/connect`;
  return PRODUCTION;
}

export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches;
export const lowPower = isTouch || (navigator.hardwareConcurrency || 8) <= 4;

// the emote settings (GET to read, POST from /anim): the same server, over http
export function reviewUrl() {
  const u = new URL(serverUrl().replace(/^ws/, 'http'));
  u.pathname = '/graffiti'; u.search = '';
  return u.href;
}

export function emotesUrl() {
  const u = new URL(serverUrl().replace(/^ws/, 'http'));
  u.pathname = '/emotes'; u.search = '';
  return u.href;
}

// the radio log (GET: every link put on the radio, newest first; the page at /radio shows it)
export function radioLogUrl() {
  const u = new URL(serverUrl().replace(/^ws/, 'http'));
  u.pathname = '/radio-log'; u.search = '';
  return u.href;
}

// the chat log (GET: everything said, newest first; the page at /chat shows it)
export function chatLogUrl() {
  const u = new URL(serverUrl().replace(/^ws/, 'http'));
  u.pathname = '/chat-log'; u.search = '';
  return u.href;
}
