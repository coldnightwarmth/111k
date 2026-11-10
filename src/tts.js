// Text-to-speech for chat: the model runs in src/tts-worker.js, loaded the first time it's wanted (it's
// ~35 MB, so only for players who turn it on). say() queues a message; the speech comes back a sentence at a
// time and onSpeech gets each piece as soon as it's ready, so long messages start talking straight away.
export const RATE = 24000;

export function createTTS({onSpeech, onState}) {
  let worker = null, state = 'idle', n = 0;
  const jobs = new Map();      // id -> {send}
  const set = s => { if (s !== state) { state = s; onState?.(s); } };
  function get() {
    if (worker) return worker;
    if (typeof Worker === 'undefined') { set('error'); return null; }
    set('loading');
    try {
      worker = new Worker(new URL(`./tts-worker.js${new URL(import.meta.url).search}`, import.meta.url), {type: 'module'});
    } catch (e) { console.warn('tts', e); set('error'); return null; }
    worker.onmessage = ({data}) => {
      const job = jobs.get(data.id);
      if (data.error) {
        console.warn('tts', data.error); jobs.delete(data.id);
        worker.terminate(); worker = null; set('error');       // (asking again starts it afresh)
        return;
      }
      set('ready');
      if (data.pcm && job && !job.cancelled) onSpeech(loud(trim(data.pcm)), job);
      if (data.done) jobs.delete(data.id);
    };
    worker.onerror = e => { console.warn('tts worker', e.message || e); worker?.terminate(); worker = null; jobs.clear(); set('error'); };
    return worker;
  }
  // Every sentence the model says starts with ~.35 s of silence and a breath in, then a moment's quiet before
  // the words: start just after that quiet (taking a soft first sound like the h of "hey" along), and end
  // 150 ms after the last of the voice.
  function trim(pcm) {
    const W = 240, n = Math.floor(pcm.length / W);             // 10 ms frames
    if (n < 10) return pcm;
    const db = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let s = 0; for (let i = f * W; i < (f + 1) * W; i++) s += pcm[i] * pcm[i];
      db[f] = 10 * Math.log10(s / W + 1e-18);
    }
    const top = Math.max(...db);
    const onset = db.findIndex(v => v >= top - 25);           // the words
    let gap = onset;
    while (gap > 0 && db[gap - 1] > top - 52) gap--;           // back through anything soft they start with
    // (no quiet between breath and words: start just before the words)
    const start = (onset - gap > 25 ? Math.max(0, onset - 6) : Math.max(0, gap - 1)) * W;
    let last = n - 1; while (last > onset && db[last] < top - 50) last--;
    const end = Math.min(pcm.length, (last + 15) * W);
    const out = pcm.slice(start, end);
    for (let i = 0; i < Math.min(240, out.length); i++) out[i] *= i / 240;   // (no click as it starts)
    return out;
  }
  // every voice comes out at about the same loudness
  function loud(pcm) {
    let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    const k = peak > 0 ? Math.min(4, .8 / peak) : 1;
    if (k !== 1) for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
    return pcm;
  }
  return {
    get state() { return state; },
    warm() { const w = get(); if (w && state !== 'ready') { const id = ++n; jobs.set(id, {}); w.postMessage({id, text: ''}); } },
    // send: whether it goes out to the players around you (false: just for you, like the preview)
    say(text, voice, {send = true} = {}) {
      const w = get(); if (!w || !text?.trim()) return null;
      const id = ++n, job = {send, cancelled: false};
      jobs.set(id, job); w.postMessage({id, text, voice});
      return job;
    },
    // stop what's not been spoken yet (of the previews)
    cancel(pred = () => true) { for (const job of jobs.values()) if (pred(job)) job.cancelled = true; },
  };
}
