// The graffiti review made at /graffiti: what each piece needs. Shared by the page, the game and the
// server, which keeps one copy and tells everyone which pieces are removed (those leave the spray cans
// and the walls; everything else stays).
//   {pieces: {name: {s: 'good' | 'remove' | 'redo' | 'kern', note: '...'}}, updated: ms}
export const REVIEW_STATUSES = ['good', 'remove', 'redo', 'kern'];
export const REVIEW_NOTE_MAX = 2000;
const MAX_PIECES = 2000;

export function cleanReview(doc) {
  const out = {pieces: {}, updated: 0};
  if (!doc || typeof doc !== 'object') return out;
  const src = doc.pieces && typeof doc.pieces === 'object' ? doc.pieces : {};
  let n = 0;
  for (const [name, v] of Object.entries(src)) {
    if (n >= MAX_PIECES) break;
    if (!/^[a-zA-Z0-9_.-]{1,48}$/.test(name) || !v || typeof v !== 'object') continue;
    const e = {};
    if (REVIEW_STATUSES.includes(v.s)) e.s = v.s;
    if (typeof v.note === 'string' && v.note.trim()) e.note = v.note.slice(0, REVIEW_NOTE_MAX);
    if (e.s || e.note) { out.pieces[name] = e; n++; }
  }
  if (Number.isFinite(doc.updated)) out.updated = Math.max(0, Math.floor(doc.updated));
  return out;
}

// the pieces taken out of the game
export function hiddenPieces(doc) {
  return Object.entries(doc?.pieces || {}).filter(([, v]) => v.s === 'remove').map(([k]) => k).sort();
}
