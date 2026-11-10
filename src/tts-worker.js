// The text-to-speech model, in a worker so the frames keep coming while it thinks. KittenTTS nano 0.8 (int8,
// 23 MB) on ONNX Runtime Web; the text side is src/tts-text.js. Asked {id, text, voice}, it answers with the
// speech a sentence at a time as {id, pcm} (Float32Array, mono, 24 kHz), then {id, done}; or {id, error}.
import * as ort from '../vendor/onnxruntime/ort.wasm.min.mjs';
import {phonemize} from '../vendor/phonemizer/phonemizer.js';
import {cleanForSpeech, chunks, tokens} from './tts-text.js';

ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime/', import.meta.url).href;
ort.env.wasm.numThreads = 1;                     // (more needs the page cross-origin isolated)

// assets/tts/voices.bin: [which, speed prior] (the model's own speed_priors)
const VOICES = {hugo: [0, .9], bruno: [1, .8], kiki: [2, .8], rosie: [3, .8]};
const ROWS = 400, WIDTH = 256;

let ready = null;
function load() {
  return ready ||= Promise.all([
    ort.InferenceSession.create(new URL('../assets/tts/kitten-nano-0.8.onnx', import.meta.url).href, {executionProviders: ['wasm']}),
    fetch(new URL('../assets/tts/voices.bin', import.meta.url)).then(r => { if (!r.ok) throw new Error(`voices ${r.status}`); return r.arrayBuffer(); })
      .then(b => new Float32Array(b)),
  ]).catch(e => { ready = null; throw e; });
}

let busy = Promise.resolve();
onmessage = ({data}) => {
  busy = busy.then(() => speak(data));             // one message at a time, in order
};

async function speak({id, text, voice}) {
  try {
    const [session, styles] = await load();
    if (!text) { postMessage({id, done: true}); return; }      // (just getting ready)
    const [which, prior] = VOICES[voice] || VOICES.bruno;
    for (const chunk of chunks(cleanForSpeech(text))) {
      const ids = await tokens(chunk, phonemize);
      const row = Math.min(chunk.length, ROWS - 1);              // the voice's style for a line this long
      const at = (which * ROWS + row) * WIDTH;
      const out = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        style: new ort.Tensor('float32', styles.slice(at, at + WIDTH), [1, WIDTH]),
        speed: new ort.Tensor('float32', new Float32Array([prior]), [1]),
      });
      const wave = out[session.outputNames[0]].data;
      const pcm = wave.slice(0, Math.max(0, wave.length - 5000));   // (the model's own trim of its tail)
      postMessage({id, pcm}, [pcm.buffer]);
    }
    postMessage({id, done: true});
  } catch (e) {
    postMessage({id, error: String(e?.message || e)});
  }
}
