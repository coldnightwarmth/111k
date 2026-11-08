// The paintings' physics, off the page's own thread (src/settle.js sends the jobs): a few seconds of Rapier
// can take a good fraction of a second, and here it never holds up a frame.
import {simulate} from './settle-sim.js';

let rapier = null;
const load = () => rapier ||= import('../vendor/rapier/rapier.es.js').then(async m => { await m.default.init(); return m.default; });

self.onmessage = async e => {
  const {n, job} = e.data || {};
  try {
    const R = await load();
    self.postMessage({n, out: job ? simulate(R, job) : null});
  } catch (err) {
    self.postMessage({n, error: String(err?.message || err)});
  }
};
