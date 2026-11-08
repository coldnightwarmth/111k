// A quick look round the site in a headless browser before it's deployed (.github/workflows/pages.yml): the
// space has to load, connect to the (local) room, draw, let you walk, pick something up and put it down, with
// no errors on the page. Exits non-zero if any of that doesn't happen, which stops the deploy.
//   npm i --no-save puppeteer-core@23.11.1 && node tools/smoke.mjs [chrome path]
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME = process.argv[2] || process.env.CHROME || '/usr/bin/google-chrome';
const PORT = 8123, BASE = `http://localhost:${PORT}/`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const server = spawn(process.execPath, ['server/dev.mjs'], {env: {...process.env, PORT: String(PORT)}, stdio: 'inherit'});
let failed = false;
const fail = msg => { console.error('SMOKE FAIL:', msg); failed = true; };
const browser = await puppeteer.launch({executablePath: CHROME, headless: 'new', protocolTimeout: 300000,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']});
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await wait(250); }
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.setViewport({width: 640, height: 400});
  const t0 = Date.now();
  await page.goto(`${BASE}?pick=auto&name=smoke&fixedres`, {waitUntil: 'load'});
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) { ready = await page.evaluate(() => document.body.classList.contains('ready') && !!window.__111k?.network?.online); if (!ready) await wait(500); }
  if (!ready) fail('the space never finished loading and connecting');
  else {
    console.log(`loaded and connected in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await wait(2000);
    const r = await page.evaluate(async () => {
      const g = window.__111k, out = {};
      const frame = () => new Promise(res => requestAnimationFrame(res));
      g.renderer.info.autoReset = true; await frame(); await frame();
      out.calls = g.renderer.info.render.calls;
      // walk: hold forward for a moment
      const x0 = g.player.x, z0 = g.player.z;
      dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW', key: 'w'}));
      for (let i = 0; i < 20; i++) await frame();
      dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW', key: 'w'}));
      out.walked = Math.hypot(g.player.x - x0, g.player.z - z0);
      // pick up the torch on the desk in the start room, then drop it
      const fl = g.items.items.get('fl1')?.state;
      if (fl && !fl.holder) {
        for (let i = 0; i < 10; i++) {          // stand still beside it, looking at it
          g.player.x = fl.x + .9; g.player.z = fl.z; g.player.vx = g.player.vz = g.player.kx = g.player.kz = 0; g.setView(false);
          g.controls.state.yaw = Math.PI / 2; g.controls.state.pitch = -Math.atan2(1.45 - fl.y - .03, .9);
          await frame();
        }
        g.primary();
        out.held = g.items.heldBy(g.network.id)?.state.id || null;
        for (let i = 0; i < 30; i++) await frame();
        out.confirmed = g.items.items.get('fl1').state.holder === g.network.id && !g.items.items.get('fl1').pending;
        g.secondary();
        for (let i = 0; i < 30; i++) await frame();
        out.dropped = !g.items.items.get('fl1').state.holder;
      } else out.held = 'skipped';
      return out;
    });
    console.log('smoke:', JSON.stringify(r));
    if (!(r.calls > 20)) fail(`hardly anything drawn (${r.calls} draw calls)`);
    if (!(r.walked > .2)) fail('walking forward didn\'t move');
    if (r.held !== 'skipped') {
      if (r.held !== 'fl1') fail('picking up the torch didn\'t put it in hand');
      if (!r.confirmed) fail('the room never confirmed the pickup');
      if (!r.dropped) fail('dropping it didn\'t');
    }
  }
  await wait(1000);
  for (const e of errors) fail(e);
  // the other pages load too
  for (const path of ['anim/', 'graffiti/']) {
    const p = await browser.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + path, {waitUntil: 'load'}); await wait(3000);
    for (const e of errs) fail(`/${path}: ${e}`);
    await p.close();
  }
} catch (e) {
  fail(e.stack || e);
} finally {
  await browser.close(); server.kill();
}
console.log(failed ? 'smoke test FAILED' : 'smoke test passed');
process.exit(failed ? 1 : 0);
