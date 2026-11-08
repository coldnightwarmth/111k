// In front of the site's files on Cloudflare (wrangler.site.jsonc), for /assets only: Cloudflare doesn't
// compress .glb models by itself (gzip takes the level from 8.6 MB to 4.4 MB on the way), and these responses
// get the same cache headers as _site/_headers gives everything else. The rest of the site is served straight
// from the static assets without this running.
const cacheFor = path => (path.startsWith('/assets/env/') ? 'public, max-age=604800, immutable'
  : 'public, max-age=86400, stale-while-revalidate=604800');

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 200) return res;
    const path = new URL(request.url).pathname, headers = new Headers(res.headers);
    headers.set('Cache-Control', cacheFor(path));
    if (path.endsWith('.glb')) {
      headers.set('Content-Encoding', 'gzip');      // the Workers runtime compresses the body to match
      headers.delete('Content-Length');
    }
    return new Response(res.body, {status: 200, headers});
  },
};
