// In front of the site's files on Cloudflare (wrangler.site.jsonc; it only runs for the paths listed there):
//  - /anim and /graffiti (tools for working on the space) aren't here at all: they're only on the GitHub copy.
//  - until the launch (11/11/2026 11:11 am Eastern), the pages show "111k - soon" instead of the game, in the
//    look of the "going down…" screen; at the launch they open by themselves, nothing to deploy. (The copy on
//    GitHub Pages isn't behind this, so it stays open for testing.)
//  - Cloudflare doesn't compress .glb models by itself (gzip takes the level from 8.6 MB to 4.4 MB on the way),
//    and the files under /assets get the same cache headers as _site/_headers gives everything else.
export const LAUNCH = Date.UTC(2026, 10, 11, 16, 11);      // 11:11 EST (UTC-5) on 11 November 2026

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, left = LAUNCH - Date.now();
    // the emote previewer and the graffiti review are tools for working on the space: only on the GitHub copy
    if (/^\/(anim|graffiti)(\/|$)/.test(path)) return new Response('Not found', {status: 404, headers: {'Cache-Control': 'no-store'}});
    if (left > 0 && (request.method === 'GET' || request.method === 'HEAD') && !path.startsWith('/assets/'))
      return new Response(request.method === 'HEAD' ? null : soon(left),
        {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
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
