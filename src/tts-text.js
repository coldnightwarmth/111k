// A chat message to what the text-to-speech model (KittenTTS nano 0.8) reads: the model's own text pipeline
// (kittenml/kittentts_legacy/onnx_model.py and preprocess.py, github.com/KittenML/KittenTTS) in JavaScript,
// with espeak-ng (phonemizer.js) for the phonemes. Pure: the worker (src/tts-worker.js) and the tests use it.

// tidy a message up for reading aloud: links and emails go, and it's lowercased like the model's own
// preprocessing (else espeak spells "LOL" out letter by letter); numbers, contractions and the like espeak
// reads well enough itself
export function cleanForSpeech(text) {
  return String(text).normalize('NFKC')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')     // emoji: nothing to say
    .toLowerCase()
    .replace(/\s+/g, ' ').trim();
}

// the model's sentence chunks (chunk_text), each ending on punctuation it pauses on (ensure_punctuation)
const NOT_SENTENCE_END = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'fig', 'figs', 'pp', 'p', 'ch', 'sec',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'al']);
function ensurePunctuation(t) {
  t = t.trim();
  return t && !'.!?,;:'.includes(t.at(-1)) ? t + ',' : t;
}
function sentenceEnd(text, i) {
  const c = text[i];
  if (!'.!?'.includes(c)) return false;
  if (c === '.') {
    if (i > 0 && i < text.length - 1 && /\d/.test(text[i - 1]) && /\d/.test(text[i + 1])) return false;
    const word = (/([A-Za-z]+)$/.exec(text.slice(0, i))?.[1] || '').toLowerCase();
    if (NOT_SENTENCE_END.has(word)) return false;
    if ((word === 'a' || word === 'p') && text[i + 1]?.toLowerCase() === 'm') return false;     // a.m. / p.m.
    if (word === 'm' && /\b[ap]\.m$/i.test(text.slice(0, i))) { const n = text.slice(i + 1).trim(); return !n || n[0] !== n[0].toLowerCase(); }
  }
  const next = text.slice(i + 1);
  return !next || /^\s/.test(next);
}
export function chunks(text, maxLen = 400) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) if (sentenceEnd(text, i)) { sentences.push(text.slice(start, i + 1)); start = i + 1; }
  if (start < text.length) sentences.push(text.slice(start));
  const out = [];
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;
    if (s.length <= maxLen) { out.push(ensurePunctuation(s)); continue; }
    let cur = '';
    for (const w of s.split(/\s+/)) {
      if (cur.length + w.length + 1 <= maxLen) cur = cur ? `${cur} ${w}` : w;
      else { if (cur) out.push(ensurePunctuation(cur)); cur = w; }
    }
    if (cur) out.push(ensurePunctuation(cur));
  }
  return out;
}

// The model's symbols (TextCleaner): anything else is dropped.
const SYMBOLS = ['$', ...';:,.!?¡¿—…"«»“” ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ...'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ'];
const INDEX = new Map(SYMBOLS.map((s, i) => [s, i]));
// espeak's punctuation, kept as it is (phonemizer's preserve_punctuation): the model pauses on it
const MARKS = /([;:,.!?¡¿—…"«»“”(){}[\]]+)/;

// One chunk to the model's input ids, given phonemize (phonemizer.js: text -> lines of IPA, punctuation dropped).
export async function tokens(chunk, phonemize) {
  const parts = [];
  for (const piece of chunk.split(MARKS)) {
    if (!piece.trim()) continue;
    if (MARKS.test(piece)) { parts.push(...piece.replace(/\s+/g, '')); continue; }
    parts.push(...(await phonemize(piece.trim(), 'en-us')));
  }
  // basic_english_tokenize: words and single marks, spaced
  const text = (parts.join(' ').match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || []).join(' ');
  const ids = [0];
  for (const ch of text) if (INDEX.has(ch)) ids.push(INDEX.get(ch));
  ids.push(10, 0);                                  // (the model's end: '…', then pad)
  return ids;
}
