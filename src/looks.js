// Random Drifella and Drilady looks, and which trait files a look needs.
// Rolls follow the cards.art drifmaker rarity weights (traits the editor
// excludes stay excluded); the portrait-only layers and "extra" floaters are off.
import {DEFAULT_RARITY} from './cards/drifmaker-rarity-defaults.mjs';
import {BODY_COLORS, BODY_STYLES, CATEGORIES, DRILADY_CATEGORIES, characterHair, normalizeAppearance,
  usesBaseHead} from './cards/drifmaker-config.mjs';

export const CHARACTERS = ['drifella', 'drilady'];

function pick(options, weights, random) {
  const w = options.map(o => { const v = weights?.[o.id]; return Number.isInteger(v) && v >= 0 ? v : 100; });
  const total = w.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let t = Math.min(1 - Number.EPSILON, random()) * total;
  for (let i = 0; i < options.length; i++) { t -= w[i]; if (w[i] > 0 && t < 0) return options[i]; }
  return options.findLast((_, i) => w[i] > 0);
}

export function randomLook(character, random = Math.random) {
  const lady = character === 'drilady';
  const cats = lady ? DRILADY_CATEGORIES : CATEGORIES;
  const look = lady ? {character: 'drilady'} : {};
  look.bodyStyle = pick(BODY_STYLES, DEFAULT_RARITY.bodyStyle, random)?.id ?? 'solid';
  for (const [category, options] of Object.entries(cats)) {
    const weights = lady ? DEFAULT_RARITY['drilady.' + category] : DEFAULT_RARITY[category];
    const option = pick(options, weights, random);
    if (option) look[category] = option.id;
  }
  look.bodyColor = pick(BODY_COLORS, DEFAULT_RARITY.bodyColor, random)?.hex;
  look.extra = 'none';
  return normalizeAppearance(look);
}

// Every trait file is named Drif_<Category>_<id>[...]. Loading a few extra
// parts is harmless (the appearance code hides what doesn't apply).
export function partsFor(look, index) {
  const a = normalizeAppearance(look);
  const want = new Set();
  for (const [k, v] of Object.entries(a)) if (typeof v === 'string') want.add(`${k}:${v}`.toLowerCase());
  want.add('head:original');
  want.add('hair:' + characterHair(a));
  if (!usesBaseHead(a)) want.add('hair:none');
  const out = [];
  for (const name of Object.keys(index.parts)) {
    const m = /^Drif_([A-Za-z]+)_([A-Za-z0-9]+)/.exec(name);
    if (!m) continue;
    const cat = m[1].toLowerCase(), id = m[2].toLowerCase();
    if (cat === 'ghost' ? a.bodyStyle === 'ghost' : want.has(`${cat}:${id}`)) out.push(name);
  }
  return out;
}

// Only small, validated values cross the network.
export function cleanLook(value) {
  try { return normalizeAppearance(value); } catch { return null; }
}
