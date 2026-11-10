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
      if (data.pcm && job && !job.cancelled) onSpeech(loud(data.pcm), job);
      if (data.done) jobs.delete(data.id);
    };
    worker.onerror = e => { console.warn('tts worker', e.message || e); worker?.terminate(); worker = null; jobs.clear(); set('error'); };
    return worker;
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
