// The game's sound effects, made from scratch: no recordings, just noise, filters and ringing tones, a fresh
// take each time (so footsteps don't sound like one sample on repeat). Each sound has a few versions to choose
// from (the /sfx page plays them all; PICKS in src/sfx.js says which the game uses).
// A recipe takes a random number source and returns mono samples at RATE.
export const RATE = 48000;
const TAU = Math.PI * 2;

// --------------------------------------------------------------- building blocks
const buf = s => new Float32Array(Math.max(1, Math.round(s * RATE)));
const white = (s, r) => { const x = buf(s); for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1; return x; };
function brown(s, r) {          // deep rumble
  const x = buf(s); let y = 0;
  for (let i = 0; i < x.length; i++) { y = (y + (r() * 2 - 1) * .02) * .998; x[i] = y * 3.5; }
  return x;
}
function pink(s, r) {           // Paul Kellet's
  const x = buf(s); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = r() * 2 - 1;
    b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
    b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
  }
  return x;
}
// RBJ biquads, in place. f may be a number or a function of time (swept, updated every 16 samples).
function filter(x, type, f, q = .707, db = 0) {
  let b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = freq => {
    const w = TAU * Math.max(20, Math.min(freq, RATE * .45)) / RATE, cs = Math.cos(w), al = Math.sin(w) / (2 * q), A = 10 ** (db / 40);
    let n0, n1, n2, d0, d1, d2;
    if (type === 'lp') { n0 = (1 - cs) / 2; n1 = 1 - cs; n2 = n0; d0 = 1 + al; d1 = -2 * cs; d2 = 1 - al; }
    else if (type === 'hp') { n0 = (1 + cs) / 2; n1 = -(1 + cs); n2 = n0; d0 = 1 + al; d1 = -2 * cs; d2 = 1 - al; }
    else if (type === 'bp') { n0 = al; n1 = 0; n2 = -al; d0 = 1 + al; d1 = -2 * cs; d2 = 1 - al; }
    else { n0 = 1 + al * A; n1 = -2 * cs; n2 = 1 - al * A; d0 = 1 + al / A; d1 = -2 * cs; d2 = 1 - al / A; }   // peak
    b0 = n0 / d0; b1 = n1 / d0; b2 = n2 / d0; a1 = d1 / d0; a2 = d2 / d0;
  };
  const sweep = typeof f === 'function';
  set(sweep ? f(0) : f);
  for (let i = 0; i < x.length; i++) {
    if (sweep && i % 16 === 0) set(f(i / RATE));
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}
// a quick rise then an exponential fall (attack a, decay time constant d), starting at `at`
function env(x, a, d, at = 0, hold = 0) {
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE - at;
    x[i] *= t < 0 ? 0 : t < a ? t / a : t < a + hold ? 1 : Math.exp(-(t - a - hold) / d);
  }
  return x;
}
// a decaying sine (something that rings: a click, a knock, metal), added in
function ring(out, f, d, amp, at = 0, r = Math.random, bend = 0) {
  const s0 = Math.round(at * RATE), ph = r() * TAU;
  let p = ph;
  for (let i = 0; s0 + i < out.length; i++) {
    const t = i / RATE, e = Math.exp(-t / d);
    if (e < 1e-4) break;
    p += TAU * f * (1 + bend * Math.exp(-t / (d * .5))) / RATE;
    out[s0 + i] += amp * e * Math.sin(p) * Math.min(1, i / 24);
  }
  return out;
}
function add(out, x, at = 0, g = 1) {
  const s0 = Math.round(at * RATE);
  for (let i = 0; i < x.length && s0 + i < out.length; i++) if (s0 + i >= 0) out[s0 + i] += x[i] * g;
  return out;
}
const gain = (x, g) => { for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
function norm(x, peak = .8) {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  return m > 0 ? gain(x, peak / m) : x;
}
// a burst of noise, shaped: [filter type, freq, q] then attack / decay
const burst = (s, r, type, f, q, a, d, at = 0) => env(filter(white(s, r), type, f, q), a, d, at);
// tiny grains of grit (crunch underfoot, spatter)
function crackle(s, r, density, f, d) {
  const x = buf(s);
  for (let i = 0; i < x.length; i++) if (r() < density / RATE) x[i] = (r() * 2 - 1) * (.4 + r() * .6);
  filter(x, 'bp', f, .9);
  return env(x, .002, d);
}
const soft = x => { for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 1.6) / Math.tanh(1.6); return x; };
const v = (r, k) => 1 + (r() * 2 - 1) * k;   // ±k

// fade the tail out so nothing ends on a click
function tail(x, s = .02) {
  const n = Math.min(x.length, Math.round(s * RATE));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}
const done = (x, peak) => tail(norm(x, peak));

// a note: some harmonics (amp per harmonic), an attack and a ring time
function note(out, f, at, d, harm = [1], r = Math.random, a = .004) {
  const s0 = Math.round(at * RATE), n = Math.round(Math.min(d * 7, 3) * RATE);
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / RATE, e = (t < a ? t / a : Math.exp(-(t - a) / d));
    let s = 0; harm.forEach((h, k) => { if (h) s += h * Math.sin(TAU * f * (k + 1) * t); });
    out[s0 + i] += s * e;
  }
  return out;
}
// a bell (FM: a sine bent by another at a ratio that isn't a whole number)
function bell(out, f, at, d, amp = 1, ratio = 3.5, index = 2) {
  const s0 = Math.round(at * RATE), n = Math.round(Math.min(d * 6, 3) * RATE);
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / RATE, e = Math.exp(-t / d) * Math.min(1, t / .002), ie = index * Math.exp(-t / (d * .4));
    out[s0 + i] += amp * e * Math.sin(TAU * f * t + ie * Math.sin(TAU * f * ratio * t));
  }
  return out;
}
// a square-ish chip tone
function chip(out, f, at, len, amp = .5) {
  const s0 = Math.round(at * RATE), n = Math.round(len * RATE);
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / RATE, e = Math.min(1, i / 40) * Math.min(1, (n - i) / 200);
    out[s0 + i] += amp * e * (Math.sin(TAU * f * t) + Math.sin(TAU * f * 3 * t) / 3 + Math.sin(TAU * f * 5 * t) / 5);
  }
  return out;
}
// a brassy note: a saw through a lowpass that opens as it's blown
function brass(out, f, at, len, amp = .5) {
  const x = buf(len + .2);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE, vib = 1 + .004 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / .2);
    ph = (ph + f * vib / RATE) % 1;
    x[i] = (ph * 2 - 1) * (t < .03 ? t / .03 : t < len ? 1 - .2 * (t - .03) / len : Math.max(0, .8 - (t - len) * 6));
  }
  filter(x, 'lp', t => f * (1.5 + 5 * Math.min(1, t / .08) * Math.exp(-t / .6)), .9);
  return add(out, x, at, amp);
}

// ------------------------------------------------------------------ the sounds
// Each: {label, versions: {a: {label, make(r)}, ...}}; `kind` groups them on the /sfx page.
const S = {};
function sound(name, kind, label, versions) { S[name] = {name, kind, label, versions}; }

// ---- feet (concrete floor)
function step(r, {click = 0, grit = 0, sole = 900}) {
  const x = buf(.18), gap = .035 + r() * .03;
  add(x, burst(.08, r, 'lp', sole * v(r, .2), .8, .002, .022), 0, .7);       // heel
  ring(x, 90 * v(r, .15), .03, .55, 0, r);                                      // its weight
  add(x, burst(.06, r, 'bp', 1800 * v(r, .25), 1.1, .0015, .016), gap, .35);    // toe
  add(x, burst(.05, r, 'hp', 4200, .7, .001, .008), gap * .9, .06 + r() * .04); // scuff
  if (click) { ring(x, 1150 * v(r, .1), .012, .35 * click, 0, r); ring(x, 2400 * v(r, .1), .007, .22 * click, 0, r); add(x, burst(.03, r, 'bp', 2600, 1.5, .0005, .004), 0, .3 * click); }
  if (grit) add(x, crackle(.1, r, 1800, 3200, .03), .004, .5 * grit);
  return done(x, .8);
}
sound('step', 'feet', 'footstep', {
  a: {label: 'sneakers', make: r => step(r, {})},
  b: {label: 'boots', make: r => step(r, {click: 1, sole: 1300})},
  c: {label: 'gritty', make: r => step(r, {grit: 1, sole: 1000})},
});
sound('jump', 'feet', 'jump (push off)', {
  a: {label: 'scuff', make: r => { const x = buf(.2); add(x, burst(.15, r, 'bp', t => 500 + 9000 * t, 1.2, .01, .035), 0, .6); ring(x, 80, .03, .4, 0, r); return done(x, .6); }},
  b: {label: 'scuff + whoosh', make: r => { const x = buf(.3); add(x, burst(.15, r, 'bp', t => 500 + 9000 * t, 1.2, .01, .035), 0, .5); add(x, burst(.28, r, 'bp', t => 500 + 3500 * t, 1.4, .05, .07), .02, .45); ring(x, 80, .03, .35, 0, r); return done(x, .6); }},
  c: {label: 'squeak', make: r => {
    const x = buf(.2); add(x, burst(.12, r, 'bp', 1500, 1, .005, .02), 0, .4);
    const f0 = 1600 * v(r, .1); let p = 0;
    for (let i = 0; i < .07 * RATE; i++) { const t = i / RATE; p += TAU * (f0 + 6000 * t + 60 * Math.sin(TAU * 90 * t)) / RATE; x[i + 400] += .35 * Math.sin(p) * Math.sin(Math.PI * t / .07); }
    return done(x, .55);
  }},
});
function land(r, {heavy = 1, grit = 0, stagger = .018}) {
  const x = buf(.35);
  for (const [at, g] of [[0, 1], [stagger * v(r, .4), .65]]) {
    add(x, burst(.15, r, 'lp', 700 * v(r, .2), .8, .002, .03 + .02 * heavy), at, .8 * g);
    ring(x, 62 * v(r, .1), .06 + .04 * heavy, .9 * g, at, r);
    add(x, burst(.08, r, 'bp', 2000, 1, .001, .012), at + .01, .2 * g);
  }
  if (grit) add(x, crackle(.15, r, 2500, 3000, .045), 0, .6 * grit);
  return done(x, .9);
}
sound('land', 'feet', 'landing', {
  a: {label: 'thud', make: r => land(r, {})},
  b: {label: 'heavy', make: r => land(r, {heavy: 2, stagger: .01})},
  c: {label: 'gritty', make: r => land(r, {grit: 1})},
});
sound('hop', 'feet', 'bunny hop (clean)', {
  a: {label: 'fwip', make: r => { const x = buf(.25); add(x, land(r, {}), 0, .45); add(x, burst(.2, r, 'bp', t => 900 + 16000 * t, 2, .01, .04), .005, .55); return done(x, .8); }},
  b: {label: 'springy', make: r => { const x = buf(.3); add(x, land(r, {}), 0, .5); ring(x, 300, .08, .35, .005, r, .6); return done(x, .8); }},
  c: {label: 'tap', make: r => { const x = buf(.2); add(x, land(r, {stagger: .006}), 0, .7); add(x, burst(.05, r, 'hp', 3000, .8, .001, .006), 0, .3); return done(x, .75); }},
});

// ---- fists
function whoosh(r, {f0 = 350, f1 = 1500, q = 1.6, len = .24}) {
  const x = buf(len + .05), up = len * .45;
  add(x, env(filter(white(len + .05, r), 'bp', t => t < up ? f0 + (f1 - f0) * t / up : f1 - (f1 - f0 * 1.4) * Math.min(1, (t - up) / (len - up)), q), len * .4, len * .18), 0, 1);
  return done(x, .7);
}
sound('swing', 'fists', 'punch swing', {
  a: {label: 'air', make: r => whoosh(r, {f0: 350 * v(r, .15), f1: 1500 * v(r, .15)})},
  b: {label: 'sharp', make: r => whoosh(r, {f0: 600, f1: 2600 * v(r, .1), q: 3, len: .16})},
  c: {label: 'heavy', make: r => whoosh(r, {f0: 220, f1: 900 * v(r, .1), q: 1.2, len: .3})},
});
sound('hit', 'fists', 'punch lands', {
  a: {label: 'thud', make: r => {
    const x = buf(.35);
    ring(x, 85 * v(r, .1), .09, 1, 0, r, .4); ring(x, 140 * v(r, .1), .06, .5, 0, r);
    add(x, burst(.1, r, 'lp', 1200, .8, .001, .04), 0, .7); add(x, burst(.02, r, 'hp', 3000, .7, .0005, .004), 0, .35);
    return done(soft(x), .95);
  }},
  b: {label: 'smack', make: r => {
    const x = buf(.3);
    add(x, burst(.12, r, 'bp', 1100 * v(r, .15), .8, .0008, .05), 0, 1.1); ring(x, 110, .06, .7, 0, r, .3);
    add(x, burst(.02, r, 'hp', 4000, .7, .0003, .003), 0, .5);
    return done(soft(x), .95);
  }},
  c: {label: 'pow', make: r => {
    const x = buf(.35); let p = 0;
    for (let i = 0; i < x.length; i++) { const t = i / RATE; p += TAU * (60 + 140 * Math.exp(-t / .03)) / RATE; x[i] += Math.sin(p) * Math.exp(-t / .1); }
    add(x, burst(.06, r, 'bp', 2200, .7, .0005, .012), 0, .8);
    return done(soft(gain(x, 1.5)), .95);
  }},
});

// ---- paint
function rattle(r, {shakes = 2, f = 3400, gap = .1}) {
  const x = buf(shakes * gap + .1);
  for (let s = 0; s < shakes; s++) {
    const at = s * gap * v(r, .15), hits = 2 + Math.floor(r() * 2);
    for (let h = 0; h < hits; h++) {
      const t = at + h * (.004 + r() * .006), k = h ? .5 : 1;
      ring(x, f * v(r, .06), .006, .6 * k, t, r); ring(x, f * 1.55 * v(r, .05), .004, .35 * k, t, r); ring(x, f * 2.3, .003, .2 * k, t, r);
      add(x, burst(.01, r, 'hp', 5000, .7, .0003, .0015), t, .2 * k);
    }
  }
  return done(x, .6);
}
sound('rattle', 'paint', 'spray can shake', {
  a: {label: 'bright', make: r => rattle(r, {})},
  b: {label: 'dull', make: r => rattle(r, {f: 2400})},
  c: {label: 'longer', make: r => rattle(r, {shakes: 4, gap: .085})},
});
function hiss(r, {lo = 2500, peak = 6500, len = .55, sputter = 0}) {
  const x = white(len + .1, r);
  filter(x, 'hp', lo, .7); filter(x, 'peak', peak, 1.2, 9);
  const rate = 15 + r() * 10, ph = r() * TAU;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const e = t < .012 ? t / .012 : t < len ? 1 : Math.max(0, 1 - (t - len) / .08);
    const spit = 1 + .6 * Math.exp(-t / .03);                                  // the first burst
    const flutter = 1 + .12 * Math.sin(TAU * rate * t + ph) + .06 * Math.sin(TAU * 7.3 * t);
    const gate = sputter && t > len * .6 ? (Math.sin(TAU * 23 * t + Math.sin(TAU * 9 * t) * 3) > -.2 ? 1 : .15) : 1;
    x[i] *= e * spit * flutter * gate;
  }
  return done(x, .55);
}
sound('spray', 'paint', 'spraying a tag', {
  a: {label: 'pssht', make: r => hiss(r, {})},
  b: {label: 'airy', make: r => hiss(r, {lo: 1500, peak: 4500, len: .6})},
  c: {label: 'sputter', make: r => hiss(r, {len: .65, sputter: 1})},
});
sound('fire', 'paint', 'paintball gun', {
  a: {label: 'pneumatic', make: r => {
    const x = buf(.3);
    ring(x, 2500 * v(r, .05), .005, .4, 0, r);
    add(x, burst(.08, r, 'bp', 1500 * v(r, .1), .7, .0005, .025), .004, 1); ring(x, 180, .03, .6, .004, r); ring(x, 95, .05, .45, .004, r);
    add(x, burst(.2, r, 'hp', 3000, .7, .005, .06), .01, .25);
    return done(soft(x), .9);
  }},
  b: {label: 'thwomp', make: r => {
    const x = buf(.3);
    add(x, burst(.15, r, 'bp', 600 * v(r, .1), 3, .002, .06), 0, 1.3); ring(x, 120, .06, .7, 0, r, .5);
    add(x, burst(.15, r, 'hp', 2500, .7, .005, .04), .01, .2);
    return done(soft(x), .9);
  }},
  c: {label: 'crack', make: r => {
    const x = buf(.35);
    add(x, burst(.05, r, 'hp', 1500, .7, .0002, .008), 0, 1.2); ring(x, 1900, .01, .5, 0, r); ring(x, 160, .04, .6, 0, r);
    add(x, burst(.3, r, 'bp', 2500, .8, .01, .08), .01, .2);
    return done(soft(x), .9);
  }},
});
function splat(r, {wet = 1, drops = 4, low = 700}) {
  const x = buf(.35);
  add(x, burst(.15, r, 'lp', 2000, .7, .0008, .03 + .02 * wet), 0, .7);
  add(x, burst(.2, r, 'bp', low * v(r, .2), 1, .002, .05 * wet), 0, .8);
  for (let k = 0; k < drops; k++) {                 // droplets: a little rising blip each
    const at = .02 + r() * .12, f0 = 900 + r() * 1100; let p = 0;
    const s0 = Math.round(at * RATE);
    for (let i = 0; i < .018 * RATE && s0 + i < x.length; i++) { const t = i / RATE; p += TAU * f0 * (1 + 25 * t) / RATE; x[s0 + i] += .18 * Math.sin(p) * Math.exp(-t / .006); }
  }
  return done(x, .8);
}
sound('splat', 'paint', 'paintball splat', {
  a: {label: 'wet', make: r => splat(r, {})},
  b: {label: 'squelch', make: r => { const x = splat(r, {wet: 2, drops: 2, low: 450}); return done(filter(x, 'lp', t => 3000 - 12000 * t, .9), .8); }},
  c: {label: 'spatter', make: r => { const x = splat(r, {drops: 2}); add(x, crackle(.2, r, 3000, 2500, .05), .005, .9); return done(x, .8); }},
});
sound('splatBody', 'paint', 'paintball hits someone', {
  a: {label: 'thwack', make: r => { const x = splat(r, {}); ring(x, 120 * v(r, .1), .05, .8, 0, r, .3); return done(soft(x), .85); }},
  b: {label: 'plain splat', make: r => splat(r, {wet: 1.5})},
});
sound('scrub', 'paint', 'sponge scrubbing', {
  a: {label: 'wet', make: r => {
    const len = .5, x = white(len, r);
    filter(x, 'bp', t => 1100 + 500 * Math.sin(TAU * 4 * t), 1);
    for (let i = 0; i < x.length; i++) { const t = i / RATE; x[i] *= Math.sin(Math.PI * Math.min(1, t / len)) * (.55 + .45 * Math.sin(TAU * 4 * t - 1.2) ** 2); }
    add(x, crackle(len, r, 900, 700, .3), 0, .5);
    return done(x, .5);
  }},
  b: {label: 'squeaky', make: r => {
    const len = .5, x = white(len, r);
    filter(x, 'bp', 1500, 1.2);
    for (let i = 0; i < x.length; i++) { const t = i / RATE; x[i] *= Math.sin(Math.PI * Math.min(1, t / len)) * (.4 + .6 * Math.max(0, Math.sin(TAU * 4 * t))); }
    let p = 0; for (let i = 0; i < x.length; i++) { const t = i / RATE; p += TAU * (2100 + 300 * Math.sin(TAU * 8 * t)) / RATE; x[i] += .08 * Math.sin(p) * Math.max(0, Math.sin(TAU * 4 * t + .6)) ** 4; }
    return done(x, .5);
  }},
});

// ---- things
function click(r, {f = 2900, second = .03, f2 = .85, d = .004, thock = 0}) {
  const x = buf(.12);
  for (const [at, k] of [[0, 1], [second * v(r, .2), .7]]) {
    ring(x, f * (at ? f2 : 1) * v(r, .04), d, .6 * k, at, r); ring(x, f * 1.86 * (at ? f2 : 1), d * .7, .3 * k, at, r);
    add(x, burst(.01, r, 'hp', 3000, .7, .0002, .001), at, .25 * k);
    if (thock) ring(x, 420, .015, .5 * thock * k, at, r);
  }
  return done(x, .5);
}
sound('flashlight', 'things', 'flashlight on / off', {
  a: {label: 'clicky', make: r => click(r, {})},
  b: {label: 'tactile', make: r => click(r, {f: 1800, thock: 1, second: .045})},
  c: {label: 'metal', make: r => click(r, {f: 4100, d: .03, second: .025})},
});
sound('grab', 'things', 'picking something up', {
  a: {label: 'rustle', make: r => { const x = buf(.15); add(x, burst(.12, r, 'bp', 2500 * v(r, .2), .6, .01, .03), 0, .7); ring(x, 1200, .008, .2, .015, r); return done(x, .45); }},
  b: {label: 'tick', make: r => { const x = buf(.12); add(x, burst(.08, r, 'bp', 1800, .8, .004, .02), 0, .5); ring(x, 700 * v(r, .1), .02, .4, .01, r); return done(x, .45); }},
});
// something landing on the floor: what it's made of rings at its own pitches
function knock(r, modes, {noise = 400, nd = .02, hard = .5}) {
  const x = buf(Math.min(1.5, Math.max(...modes.map(m => m[1])) * 6 + .05));
  for (const [f, d, a] of modes) ring(x, f * v(r, .05), d * v(r, .1), a, 0, r);
  add(x, burst(.1, r, 'lp', noise, .7, .0005, nd), 0, .6);
  add(x, burst(.02, r, 'hp', 2500, .7, .0002, .002), 0, hard * .4);
  return done(x, .8);
}
sound('thunkWood', 'things', 'painting lands', {
  a: {label: 'frame', make: r => { const x = knock(r, [[140, .08, .8], [330, .05, .5], [760, .03, .3], [1500, .012, .15]], {noise: 450, nd: .04}); return x; }},
  b: {label: 'flat slap', make: r => { const x = knock(r, [[110, .06, .7], [260, .04, .4]], {noise: 900, nd: .05, hard: .2}); add(x, burst(.08, r, 'bp', 1200, .6, .001, .025), 0, .5); return done(x, .8); }},
});
sound('thunkMetal', 'things', 'crown lands', {
  a: {label: 'gold', make: r => knock(r, [[1900, .25, .5], [2870, .18, .35], [4300, .12, .2], [6100, .06, .1]], {noise: 3000, nd: .006, hard: 1})},
  b: {label: 'dull gold', make: r => knock(r, [[1250, .15, .5], [1900, .1, .3], [3100, .05, .15]], {noise: 2000, nd: .008})},
});
sound('thunkCan', 'things', 'spray can lands', {
  a: {label: 'tin', make: r => { const x = knock(r, [[900, .05, .6], [2100, .04, .4], [3300, .03, .25]], {noise: 1500, nd: .01, hard: .8}); add(x, rattle(r, {shakes: 1}), .01, .3); return done(x, .8); }},
});
sound('thunkPlastic', 'things', 'gun, flashlight or bucket lands', {
  a: {label: 'plastic', make: r => knock(r, [[220, .05, .7], [640, .03, .4], [1700, .012, .2]], {noise: 700})},
  b: {label: 'hollow', make: r => knock(r, [[300, .08, .7], [520, .06, .4], [1100, .02, .2]], {noise: 500, nd: .03})},
});
sound('place', 'things', 'putting something down', {
  a: {label: 'soft knock', make: r => knock(r, [[260, .04, .6], [700, .02, .3]], {noise: 600, hard: .1})},
  b: {label: 'tap', make: r => knock(r, [[400, .03, .5], [1100, .01, .2]], {noise: 1200, hard: .3})},
});
function creak(r, {lo = 620, len = .7}) {
  const x = buf(len + .1);
  let t = .02;
  while (t < len) {                       // stick-slip: little catches at a wandering rate
    const rate = 35 + 30 * Math.sin(Math.PI * t / len) + (r() - .5) * 12;
    const k = Math.sin(Math.PI * t / len) * (.6 + .4 * r());
    ring(x, lo * v(r, .02), .02, .3 * k, t, r); ring(x, lo * 1.48, .015, .2 * k, t, r); ring(x, lo * 2.35, .01, .12 * k, t, r);
    t += 1 / rate;
  }
  ring(x, 1900, .006, .3, 0, r);          // the latch letting go
  return done(x, .45);
}
sound('doorOpen', 'things', 'door swinging open', {
  a: {label: 'creak', make: r => creak(r, {lo: 620 * v(r, .1)})},
  b: {label: 'heavy creak', make: r => creak(r, {lo: 380 * v(r, .1), len: .9})},
  c: {label: 'latch + air', make: r => { const x = buf(.5); ring(x, 1900, .006, .4, 0, r); ring(x, 2700, .004, .2, .012, r); add(x, burst(.45, r, 'bp', t => 300 + 900 * t, .8, .1, .12), .02, .35); return done(x, .45); }},
});
sound('doorBump', 'things', 'door hits its stop', {
  a: {label: 'wood', make: r => knock(r, [[180, .06, 1], [410, .04, .6], [820, .02, .3]], {noise: 500, nd: .02})},
});
sound('doorShut', 'things', 'door shuts', {
  a: {label: 'latch', make: r => { const x = buf(.4); add(x, knock(r, [[120, .08, 1], [300, .05, .5]], {noise: 400, nd: .03}), 0, .9); ring(x, 2200, .006, .35, .002, r); ring(x, 3000, .005, .25, .03, r); return done(x, .85); }},
  b: {label: 'soft', make: r => { const x = buf(.4); add(x, knock(r, [[100, .07, 1], [240, .04, .4]], {noise: 300, nd: .03, hard: 0}), 0, 1); ring(x, 1800, .008, .2, .025, r); return done(x, .7); }},
});
sound('button', 'things', 'lap timer button', {
  a: {label: 'clack', make: r => { const x = buf(.2); ring(x, 160, .05, .8, 0, r); ring(x, 1200, .01, .4, 0, r); add(x, burst(.03, r, 'bp', 2000, .8, .0005, .005), 0, .5); ring(x, 1400, .008, .3, .07, r); return done(x, .8); }},
  b: {label: 'arcade', make: r => { const x = buf(.2); ring(x, 240, .03, .7, 0, r); ring(x, 2600, .006, .4, 0, r); ring(x, 2100, .006, .3, .06, r); return done(x, .75); }},
});

// ---- the lap timer and the crown (a family each: the same letter is the same instrument)
const E6 = 1318.5, A6 = 1760, C6 = 1046.5, G6 = 1568, C7 = 2093, E5 = 659.3, G5 = 784, C5 = 523.3, A5 = 880;
const timer = {
  a: (x, f, at, len) => note(x, f, at, len * .45, [1, 0, .08]),
  b: (x, f, at, len) => chip(x, f, at, len, .35),
  c: (x, f, at, len) => bell(x, f, at, len * .9, .8, 4, 1.2),
};
const tune = notes => Object.fromEntries(Object.entries(timer).map(([k, play]) => [k, {label: {a: 'beeps', b: 'chiptune', c: 'bells'}[k], make: () => {
  const x = buf(notes.at(-1)[1] + notes.at(-1)[2] * 3 + .1);
  for (const [f, at, len] of notes) play(x, f, at, len);
  return done(x, .7);
}}]));
sound('raceStart', 'machine', 'loop run starts', tune([[A5, 0, .12], [A5, .2, .12], [A6, .4, .35]]));
sound('lap', 'machine', 'lap', tune([[E6, 0, .1], [A6, .09, .35]]));
sound('finish', 'machine', 'loop run finished', tune([[C6, 0, .12], [E6, .11, .12], [G6, .22, .12], [C7, .33, .7]]));
sound('raceCancel', 'machine', 'loop run called off', tune([[E5, 0, .15], [C5, .16, .4]]));
const crownTunes = {
  a: (x, notes) => { for (const [f, at, len] of notes) bell(x, f, at, len, .7, 3.5, 2.2); },
  b: (x, notes) => { for (const [f, at, len] of notes) brass(x, f / 2, at, len, .5); },
};
const fanfare = notes => ({
  a: {label: 'bells', make: () => { const x = buf(notes.at(-1)[1] + notes.at(-1)[2] * 3); crownTunes.a(x, notes); return done(x, .7); }},
  b: {label: 'brass', make: () => { const x = buf(notes.at(-1)[1] + notes.at(-1)[2] + .4); crownTunes.b(x, notes); return done(x, .7); }},
});
sound('crownStart', 'crown', 'king of the hill starts', fanfare([[G5, 0, .18], [C6, .2, .5]]));
sound('crownTake', 'crown', 'someone takes the crown', fanfare([[C6, 0, .12], [E6, .08, .12], [G6, .16, .4]]));
sound('crownLost', 'crown', 'the crown is lost', fanfare([[G5, 0, .18], [E5, .18, .45]]));
sound('crownWin', 'crown', 'king of the hill won', fanfare([[G5, 0, .14], [C6, .14, .14], [E6, .28, .14], [G6, .42, .25], [E6, .7, .12], [G6, .82, .9]]));

// ---- chat
sound('chat', 'chat', 'someone says something', {
  a: {label: 'blip', make: () => { const x = buf(.1); let p = 0; for (let i = 0; i < x.length; i++) { const t = i / RATE; p += TAU * (1250 - 2000 * t) / RATE; x[i] = (Math.sin(p) + .15 * Math.sin(2 * p)) * Math.min(1, t / .002) * Math.exp(-t / .025); } return done(x, .4); }},
  b: {label: 'bubble', make: () => { const x = buf(.08); let p = 0; for (let i = 0; i < x.length; i++) { const t = i / RATE; p += TAU * (450 + 12000 * t) / RATE; x[i] = Math.sin(p) * Math.sin(Math.PI * Math.min(1, t / .05)); } return done(x, .35); }},
  c: {label: 'tick', make: r => knock(r, [[1800, .012, .6], [3100, .006, .3]], {noise: 3000, hard: .2})},
});

// ---- the tunnel, always there (looped; the end fades into the start)
function loop(make, len = 8) {
  const fade = 1, x = make(len + fade), out = buf(len), n = out.length, f = Math.round(fade * RATE);
  for (let i = 0; i < n; i++) out[i] = x[i];
  for (let i = 0; i < f; i++) { const k = i / f; out[i] = x[i] * k + x[n + i] * (1 - k); }
  return out;
}
sound('hum', 'ambience', 'the tunnel (in the background)', {
  a: {label: 'electric hum', make: r => loop(s => {
    const x = gain(filter(brown(s, r), 'lp', 140, .7), .5);
    add(x, filter(pink(s, r), 'lp', 700, .7), 0, .12);
    for (const [f, a] of [[60, .25], [120, .18], [180, .08], [240, .04]]) ring(x, f, 1e9, a, 0, r);
    for (let i = 0; i < x.length; i++) x[i] *= 1 + .05 * Math.sin(TAU * .13 * i / RATE);
    return norm(x, .5);
  })},
  b: {label: 'draught', make: r => loop(s => {
    const x = filter(pink(s, r), 'bp', 380, .5);
    for (let i = 0; i < x.length; i++) { const t = i / RATE; x[i] *= .6 + .4 * Math.sin(TAU * .11 * t) * Math.sin(TAU * .07 * t + 1); }
    add(x, gain(filter(brown(s, r), 'lp', 120, .7), .5), 0, 1);
    return norm(x, .5);
  })},
  c: {label: 'deep rumble', make: r => loop(s => {
    const x = filter(brown(s, r), 'lp', 90, .7);
    for (const [f, a] of [[41, .2], [55, .1]]) ring(x, f, 1e9, a, 0, r);
    return norm(x, .5);
  })},
});

export const SOUNDS = S;
// render one take of a sound's version
export function make(name, version, r = Math.random) {
  const s = S[name], ver = s?.versions[version] || Object.values(s?.versions || {})[0];
  return ver ? ver.make(r) : null;
}
