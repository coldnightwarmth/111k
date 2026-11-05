// Where the multiplayer server lives. On localhost the dev server handles it on
// the same port; everywhere else the Cloudflare Worker does. `?server=` overrides.
const PRODUCTION = 'wss://111k-room.kururuga-online-leaderboard.workers.dev/connect';

export function serverUrl() {
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return `ws://${location.host}/connect`;
  return PRODUCTION;
}

export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches;
export const lowPower = isTouch || (navigator.hardwareConcurrency || 8) <= 4;
