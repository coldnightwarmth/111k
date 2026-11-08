// Errors in visitors' browsers, sent to the room so they can be looked at later (GET /errors on the server: the
// latest kinds, how often each, which browser). A few per visit at most, each kind once; held until the room's
// connected. Nothing about the person: the message, where in the code, the browser, the page.
const MAX = 10;
const seen = new Set(), queue = [];
let sender = null, sent = 0;

function flush() {
  while (queue.length && sender) {
    if (!sender(queue[0])) return;      // not connected yet: try again on the next one (or connect)
    queue.shift();
  }
}
export function reportError(err, where = '') {
  try {
    const msg = String(err?.message || err || 'error').slice(0, 300);
    const stack = String(err?.stack || where || '').slice(0, 1200);
    if (/ResizeObserver loop|^Script error\.?$/.test(msg)) return;      // browser noise, and other sites' scripts
    const key = `${msg}|${stack.split('\n')[1] || ''}`;
    if (seen.has(key) || sent >= MAX) return;
    seen.add(key); sent++;
    queue.push({type: 'clientError', msg, where: stack, ua: navigator.userAgent.slice(0, 200), page: location.pathname.slice(0, 40)});
    flush();
  } catch {}
}
// send(msg) -> whether it went (src/net.js send); called again whenever there might be a connection now
export function errorsGoVia(send) { sender = send; flush(); }

addEventListener('error', e => {
  if (e.filename && !e.filename.startsWith(location.origin)) return;   // (browser extensions)
  reportError(e.error || e.message, `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`);
});
addEventListener('unhandledrejection', e => reportError(e.reason, 'unhandled rejection'));
