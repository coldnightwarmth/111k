// In front of the site's files on Cloudflare (wrangler.site.jsonc; it only runs for the paths listed there):
//  - /anim, /graffiti and /sfx (tools for working on the space) aren't here at all: they're only on the GitHub copy.
//  - until the launch (11/11/2026 11:11 am Eastern), the pages show "111k - soon" instead of the game, in the
//    look of the "going down…" screen; at the launch they open by themselves, nothing to deploy. (The copy on
//    GitHub Pages isn't behind this, so it stays open for testing.)
//  - /playtest is the game itself, open before the launch too, on the real server: for playtesters, while
//    PLAYTEST is on. It's the same page as /, with <base href="/"> so everything it loads still comes from the
//    site's root. Closed (and after the launch) it just goes to /.
//  - Cloudflare doesn't compress .glb models by itself (gzip takes the level from 8.6 MB to 4.4 MB on the way),
//    and the files under /assets get the same cache headers as _site/_headers gives everything else.
const PLAYTEST = false;      // /playtest open? (closed after the 9 Nov 2026 playtest)
const LAUNCH = Date.UTC(2026, 10, 11, 16, 11);      // 11:11 EST (UTC-5) on 11 November 2026

const cacheFor = path => (path.startsWith('/assets/env/') ? 'public, max-age=604800, immutable'
  : 'public, max-age=86400, stale-while-revalidate=604800');

// the page, with how long is left (from the server's clock, not the visitor's: it reloads itself at the launch)
const soon = left => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#050506">
<title>111k</title>
<meta name="description" content="an abandoned room off the loop. soon.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  html, body { margin: 0; height: 100%; background: #050506; color: rgba(233, 230, 220, .55); color-scheme: dark;
    font: 13px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
  body { display: grid; place-items: center; }
  p { margin: 0; letter-spacing: .2em; opacity: 0; animation: in .6s forwards; }
  span { animation: blink 1.6s steps(2) infinite; }
  @keyframes blink { 50% { opacity: .2; } }
  @keyframes in { to { opacity: 1; } }
</style>
</head>
<body>
<p><span>111k - soon</span></p>
<script>
  // open the moment it goes live (a few seconds' spread so everyone waiting doesn't arrive at once)
  const at = Date.now() + ${Math.max(0, left)} + Math.random() * 8000;
  const check = () => { if (Date.now() >= at) location.reload(); };
  setInterval(check, 5000);
  addEventListener('visibilitychange', check);
</script>
</body>
</html>`;

async function film(request, env, url, path) {
  const res = await env.ASSETS.fetch(new Request(url, {method: 'GET'}));
  if (res.status !== 200) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const headers = new Headers({'Content-Type': res.headers.get('Content-Type') || 'video/mp4', 'Accept-Ranges': 'bytes',
    'Cache-Control': cacheFor(path), 'X-Content-Type-Options': 'nosniff'});
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('Range') || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    headers.set('Content-Length', String(size));
    return new Response(request.method === 'HEAD' ? null : buf, {status: 200, headers});
  }
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) { headers.set('Content-Range', `bytes */${size}`); return new Response(null, {status: 416, headers}); }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`); headers.set('Content-Length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : buf.slice(start, end + 1), {status: 206, headers});
}

// "lost in the tunnels" (404.html), as for any other address that isn't on the site
async function lost(request, env) {
  const page = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
  return new Response(request.method === 'HEAD' ? null : page.body, {status: 404, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, left = LAUNCH - Date.now();
    // the emote previewer, the graffiti review and the sounds are tools for working on the space: only on the GitHub copy
    if (/^\/(anim|graffiti|sfx)(\/|$)/.test(path)) return lost(request, env);
    if (/^\/playtest(\/|\/index\.html)?$/.test(path)) {
      if (!PLAYTEST || left <= 0) return Response.redirect(new URL('/', url), 302);
      const page = await env.ASSETS.fetch(new Request(new URL('/', url)));
      if (page.status !== 200) return page;
      const html = (await page.text()).replace(/<head>/i, '<head>\n  <base href="/">');
      return new Response(request.method === 'HEAD' ? null : html,
        {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex'}});
    }
    if (left > 0 && (request.method === 'GET' || request.method === 'HEAD') && !path.startsWith('/assets/'))
      return new Response(request.method === 'HEAD' ? null : soon(left),
        {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
    // the films (B-04's projector): served in pieces as the player asks (the static files don't do ranges, and
    // Safari won't play a film without them, nor will any browser jump into the middle of one)
    if (path.startsWith('/assets/cinema/') && (request.method === 'GET' || request.method === 'HEAD')) return film(request, env, url, path);
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 200 || !path.startsWith('/assets/')) return res;
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', cacheFor(path));
    if (path.endsWith('.glb')) {
      headers.set('Content-Encoding', 'gzip');      // the Workers runtime compresses the body to match
      headers.delete('Content-Length');
    }
    return new Response(res.body, {status: 200, headers});
  },
};
