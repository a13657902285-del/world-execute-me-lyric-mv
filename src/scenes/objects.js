// OBJECTS (v4): the concrete things verse 2 asks the AI to be, as code-symbol pictures.
// Each is a GLYPH PLATE (engine/ascii.js): a clean cut-paper outline, a flat under-colour so that the whole shape
// reads on the first frame, and inside it the object's own data set in characters, in two or three steps of its
// spot colour (config.json -> spot). The calyx / stem is the film's spark, in the AI's orange with a black
// outline: whatever the object is, it is her playing it. Every object has three states:
//
//   whole      the first frame: one outline, calyx and stem on it (decode < 1: its characters are still settling)
//   open       0..1: cut through; the pieces part and the cut face shows, in the lighter step of the spot colour and black
//   give       seconds since it was GIVEN AWAY (-1 = not yet): the spot colour leaves the object row by row towards the
//              user's side (the right). What is still inside the outline keeps its colour; what has left it is cream.
//              The object is left as a hollow outline; calyx and stem stay orange: she is still there.
//
//   eggplant(ctx, env, { cx, cy, s, open, give, decode, t })      s = half its length
//   tomato(ctx, env, { cx, cy, s, open, give, decode, t })        s = half its width
//   popsicle(ctx, env, { cx, cy, s, open, give, t })              s = half its height; the user's picture, drawn as-is
//
// Pure functions of their arguments. Verse 2 (plates_verse2.js) is where they are used; lab set `glyph` shows them alone:
//   node export/export.mjs --lab glyph --sheet out/chk_glyph.png --times 0,1,2,3,4,5,6 --cols 2 --width 1920 --height 1080
import { ground } from '../components/plate.js';
import { sparkOutline } from '../components/motif.js';
import { glyphPlate } from '../engine/ascii.js';
import { rand } from '../engine/prng.js';
import { clamp, easeInOut, easeOut, lerp } from '../engine/util.js';

const TAU = Math.PI * 2;

/** Smooth interpolation through (x, y) pairs sorted by x (Catmull-Rom, clamped at the ends). */
function curve(pairs) {
  return (x) => {
    const n = pairs.length;
    if (x <= pairs[0][0]) return pairs[0][1];
    if (x >= pairs[n - 1][0]) return pairs[n - 1][1];
    let i = 0;
    while (x > pairs[i + 1][0]) i++;
    const p0 = pairs[Math.max(0, i - 1)][1], p1 = pairs[i][1], p2 = pairs[i + 1][1], p3 = pairs[Math.min(n - 1, i + 2)][1];
    const u = (x - pairs[i][0]) / (pairs[i + 1][0] - pairs[i][0]), u2 = u * u, u3 = u2 * u;
    return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
  };
}

/** The object's data as the string its glyphs are set in: `label:value` pairs from the card the script wrote for it. */
export function dataText(card, fallback, tail = 'per_100g') {
  const rows = (card?.rows ?? []).map((r) => `${r.label.toLowerCase().replace(/[\s,]+/g, '_')}:${r.value.replace(/\s+/g, '')}`);
  return rows.length ? `${[...rows, tail].filter(Boolean).join(' ')} `.replace(/ /g, '·') : fallback;
}

// ---------------------------------------------------------------------------------------------- one piece of cut paper
/** How long a row takes to leave, and by how much the rows start after one another (seconds). */
const DRAIN = { run: 0.3, spread: 0.17 };
/** Seconds after which an object given away is empty. */
export const GIVEN = DRAIN.run + DRAIN.spread;

/**
 * One piece of an object: flat under-colour, the glyphs clipped to it, its cut-paper edge. Three steps of the spot
 * colour: the lit cells (ink 2) stand on a flat block of the base colour, the rest on the dark step, the shaded side
 * (ink 3) is set in dots.
 *   pts      its outline on screen;  field(X, Y) -> ink at a screen point (0 = none)
 *   give     >= 0: seconds since the object was given away. Every row of the piece (one line of characters high) slides
 *            off to the right, later and later down the piece and never two rows quite together. Inside the outline a
 *            row is still the spot colour; where it has left the outline it is CREAM: the colour turns as it leaves.
 *   stream   false = the rows are not drawn once they have left the outline (the caller shows what the colour turns
 *            into: verse 2 pulls the object's molecules out of it, molecules.js)
 */
function piece(ctx, pts, field, { SP, glyph, key, inks, decode = null, give = -1, stream = true, seed = 0, edgeW = 3 }) {
  const g = ctx.g, cw = ctx.cw(glyph);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const dst = { x: Math.floor(x0 / cw) * cw, y: Math.floor(y0 / glyph) * glyph, w: 0, h: 0 };          // on the frame's own character grid
  dst.w = Math.ceil((x1 - dst.x) / cw) * cw; dst.h = Math.ceil((y1 - dst.y) / glyph) * glyph;
  const f = (u, v) => field(dst.x + u * dst.w, dst.y + v * dst.h), rows = Math.round(dst.h / glyph);
  const plate = (o) => glyphPlate(ctx, f, dst, { size: glyph, key, edge: { role: SP.light, weight: 800 }, ...o });
  if (give < 0) {
    ctx.poly(pts, { close: true, fill: true, color: SP.dark });
    ctx.clipPath(pts, () => plate({ inks, decode }));
  } else {
    const reach = 1920 - dst.x + 120;
    const shift = (j) => reach * clamp((give - DRAIN.spread * (0.62 * (j / rows) + 0.38 * rand(seed, j))) / DRAIN.run) ** 2.2;
    /** The flat colour of the piece, row by row, each row where it has slid to (and drawn out a little by its speed). */
    const strips = (color) => {
      for (let j = 0; j < rows; j++) {
        const dx = shift(j);
        if (dx >= reach) continue;
        g.save(); g.beginPath(); g.rect(-200, dst.y + j * glyph, 2400, glyph + 0.6); g.clip();
        g.translate(dx, 0);
        ctx.poly(pts, { close: true, fill: true, color });
        g.restore();
      }
    };
    ctx.clipPath(pts, () => { strips(SP.dark); plate({ inks, shift }); });
    if (stream) {
    g.save(); g.beginPath(); g.rect(-200, -200, 2400, 1500);                                              // everything but the piece itself
    g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
    g.clip('evenodd');
    strips('text');
    const cream = {};
    for (const k of Object.keys(inks)) cream[k] = { ...inks[k], role: 'sub', alpha: 1, bg: null };
    plate({ inks: cream, edge: false, shift });
    g.restore(); ctx._font = '';
    }
  }
  ctx.poly(pts, { close: true, color: SP.light, width: edgeW });                                         // the cut-paper edge: what is left when the colour has gone
}

/** The calyx and stem of an object: the spark's own shape as a cap, flat orange inside a black outline, with its shadow. */
function cap(ctx, shapes, SH, lw) {
  for (const pts of shapes) {
    ctx.poly(pts.map(([x, y]) => [x + SH[0] * 0.6, y + SH[1] * 0.6]), { close: true, fill: true, color: 'bg' });
    ctx.poly(pts, { close: true, color: 'bg', width: lw * 2 });
    ctx.poly(pts, { close: true, fill: true, color: 'me' });
  }
}

// ---------------------------------------------------------------------------------------------- eggplant
// Local frame: the fruit stands upright, stem up; y runs from Y0 (under the calyx) to Y1 (the tip), unit = half its length.
const Y0 = -0.8, Y1 = 1.0;
const WIDTH = curve([[-0.8, 0.0], [-0.77, 0.13], [-0.66, 0.2], [-0.4, 0.245], [-0.05, 0.31], [0.3, 0.4], [0.6, 0.44], [0.8, 0.4], [0.93, 0.27], [0.985, 0.13], [1.0, 0.0]]);
const SPINE = (y) => 0.3 * Math.sin((y + 0.3) * 1.15) - 0.08;          // the fruit bends: centre line
const TILT = 0.62;                                                      // and leans, stem to the upper right (the default; `tilt`)
const CUT = { y: 0.3, slope: 0.3 };                                     // where the knife goes through (local)
const half = (y) => Math.max(0, WIDTH(y));

/** Outline of the body between two heights, as local points (right side down, left side up). */
function bodyPts(ya = Y0, yb = Y1, n = 56) {
  const R = [], L = [];
  for (let i = 0; i <= n; i++) { const y = lerp(ya, yb, i / n); R.push([SPINE(y) + half(y), y]); L.push([SPINE(y) - half(y), y]); }
  return [...R, ...L.reverse()];
}

/**
 * The eggplant.
 *   cx, cy, s   centre and half-length on screen;  tilt = how far it leans (radians)
 *   open        0 = whole; 0..1 = cut through: the lower piece slides away and shows its cut face (flesh one step lighter
 *               than the skin, the seeds in black)
 *   give        seconds since it was given away (-1 = not yet): see piece();  stream = false: without the cream rows
 *   decode      0..1: how far its characters have settled (1 = all of them)
 *   glyph       glyph size (14 keeps the characters legible in an encoded 1080p frame)
 * Returns { hull } = screen outline of the whole fruit (for a caller's own shadow, hollow outline, hit point).
 */
export function eggplant(ctx, env, { cx = 960, cy = 540, s = 400, tilt = TILT, open = 0, give = -1, stream = true, decode = 1, glyph = 15, t = 0, alpha = 1, key = 'eggplant' } = {}) {
  const SP = env.cfg.spot.eggplant, cs = Math.cos(tilt), sn = Math.sin(tilt), k = clamp(open), e = easeOut(k);
  const text = dataText((env.script.cards_section6 ?? [])[0], 'water:92g·');
  // the lower piece, once cut: it slides down its own axis, away from the knife, and turns a little
  const cutY = (x) => CUT.y + CUT.slope * (x - SPINE(CUT.y)), gap = 0.34 * e, turn = 0.13 * e;
  const toScreen = (x, y, lower = false) => {
    if (lower) { const px = x - SPINE(CUT.y), py = y - CUT.y, c = Math.cos(turn), n = Math.sin(turn); x = SPINE(CUT.y) + px * c - py * n + 0.1 * gap; y = CUT.y + px * n + py * c + gap; }
    return [cx + (x * cs - (y - 0.1) * sn) * s, cy + (x * sn + (y - 0.1) * cs) * s];
  };
  const toLocal = (X, Y, lower = false) => {
    const dx = (X - cx) / s, dy = (Y - cy) / s;
    let x = dx * cs + dy * sn, y = -dx * sn + dy * cs + 0.1;
    if (lower) { const px = x - SPINE(CUT.y) - 0.1 * gap, py = y - CUT.y - gap, c = Math.cos(turn), n = Math.sin(turn); x = SPINE(CUT.y) + px * c + py * n; y = CUT.y - px * n + py * c; }
    return [x, y];
  };
  const inBody = (x, y) => y > Y0 && y < Y1 && Math.abs(x - SPINE(y)) < half(y);
  // local outline points of the two pieces (when whole they are simply the two parts of one outline)
  const split = (lower) => {
    const pts = bodyPts(), out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ia = a[1] > cutY(a[0]), ib = b[1] > cutY(b[0]);
      if (ia === lower) out.push(a);
      if (ia !== ib) { let lo = 0, hi = 1; for (let q = 0; q < 18; q++) { const m = (lo + hi) / 2, x = lerp(a[0], b[0], m), y = lerp(a[1], b[1], m); if ((y > cutY(x)) === ia) lo = m; else hi = m; } out.push([lerp(a[0], b[0], lo), lerp(a[1], b[1], lo)]); }
    }
    return out;
  };
  const upper = k > 0 ? split(false).map(([x, y]) => toScreen(x, y)) : bodyPts().map(([x, y]) => toScreen(x, y));
  const lowerPts = k > 0 ? split(true).map(([x, y]) => toScreen(x, y, true)) : null;
  const g = ctx.g, a0 = g.globalAlpha, gone = give < 0 ? 0 : clamp(give / 0.1);
  g.globalAlpha = a0 * alpha;

  // ---- shadow plate: the whole shape once more, flat, out of register (depth without a gradient)
  const SH = [0.045 * s, 0.045 * s];
  for (const pts of [upper, lowerPts]) if (pts) ctx.poly(pts.map(([x, y]) => [x + SH[0], y + SH[1]]), { close: true, fill: true, color: 'bg' });

  // ---- the cut face (drawn under the pieces: a lens of flesh, one step lighter, with its seeds). Given away, only its line is left.
  const face = (lower) => {
    const c = toScreen(SPINE(CUT.y), CUT.y, lower), w = half(CUT.y) * s * 1.02, ang = tilt + Math.atan(CUT.slope) + (lower ? turn : 0), hh = w * 0.34 * e;
    if (hh < 2) return;
    ctx.at(c[0], c[1], () => {
      if (gone < 1) {
        g.globalAlpha = a0 * alpha * (1 - gone);
        g.beginPath(); g.ellipse(0, 0, w, hh, 0, 0, TAU);
        g.fillStyle = ctx.col(SP.dark, 1); g.fill();
        g.beginPath(); g.ellipse(0, 0, w * 0.9, hh * 0.8, 0, 0, TAU);
        g.fillStyle = ctx.col(SP.light, 1); g.fill();
        g.fillStyle = ctx.col('bg', 1);                               // seeds: two arcs of black drops
        for (const [rr, n, ph] of [[0.62, 9, 0.2], [0.3, 5, 0.9]]) for (let i = 0; i < n; i++) {
          const a = ph + (i / n) * TAU;
          g.beginPath(); g.ellipse(Math.cos(a) * w * 0.9 * rr, Math.sin(a) * hh * 0.8 * rr, w * 0.06, hh * 0.13, a, 0, TAU); g.fill();
        }
        g.globalAlpha = a0 * alpha;
      }
      if (gone > 0) { g.beginPath(); g.ellipse(0, 0, w, hh, 0, 0, TAU); g.strokeStyle = ctx.col(SP.light, gone); g.lineWidth = Math.max(2, s * 0.007); g.stroke(); }
    }, { rot: ang });
  };

  // ---- the two pieces: flat under-colour, then the glyphs, clipped to the piece
  const one = (pts, lower) => {
    const field = (X, Y) => {
      const [x, y] = toLocal(X, Y, lower);
      if (!inBody(x, y) || (k > 0 && (y > cutY(x)) !== lower)) return 0;
      const q = (x - SPINE(y)) / half(y);                             // -1..1 across the fruit
      return q > -0.78 && q < -0.36 && y > -0.5 && y < 0.78 - 0.5 * (q + 0.78) ? 2 : q > 0.46 + 0.2 * y ? 3 : 1;      // 2 = the light running down one side, 3 = the side in shade
    };
    piece(ctx, pts, field, {
      SP, glyph, give, stream, seed: lower ? 71 : 70, edgeW: Math.max(2, s * 0.007),
      key: `${key}|${lower ? 'L' : 'U'}|${cx.toFixed(1)},${cy.toFixed(1)},${s.toFixed(1)},${tilt}|${k.toFixed(3)}`,
      decode: decode < 1 ? { k: decode, t, seed: 31 } : null,
      inks: { 1: { role: SP.base, weight: 800, text }, 2: { role: SP.light, weight: 800, text, bg: SP.base }, 3: { role: SP.base, weight: 400, text: text.replace(/[a-z_]/g, '.'), alpha: 0.75 } },
    });
  };
  if (lowerPts) { face(true); one(lowerPts, true); face(false); }
  one(upper, false);
  if (k > 0.02 && k < 1) {                                            // the knife: one straight line of the lighter step, there for the cut only
    const a = toScreen(SPINE(CUT.y) - 0.95, cutY(SPINE(CUT.y) - 0.95)), b = toScreen(SPINE(CUT.y) + 0.95, cutY(SPINE(CUT.y) + 0.95));
    ctx.line(a[0], a[1], b[0], b[1], { color: SP.light, width: 5, alpha: 1 - k });
  }

  // ---- calyx and stem: the spark as a cap, flat orange, black outline (drawn last: it sits on the shoulder of the fruit).
  // Its petals are the spark's own, but the ones that lie on the fruit are long and the ones behind the stem short.
  const at = (x, y) => { const X = SPINE(Y0) + x, Y = Y0 + 0.03 + y; return [cx + (X * cs - (Y - 0.1) * sn) * s, cy + (X * sn + (Y - 0.1) * cs) * s]; };
  const top = at(0, 0);
  const cal = sparkOutline(0, 0, 1, { rot: Math.PI / 7, n: 168, rays: 7, inner: 0.5 }).map(([x, y]) => { const down = Math.max(0, y) ** 0.8; return at(x * (0.3 + 0.12 * down), y * (0.2 + 0.36 * down) - 0.03); });
  const stem = [[-0.07, -0.02], [-0.085, -0.2], [-0.05, -0.36], [0.06, -0.43], [0.15, -0.38], [0.1, -0.3], [0.07, -0.2], [0.075, -0.02]].map(([x, y]) => at(x, y));
  cap(ctx, [stem, cal], SH, Math.max(4, s * 0.014));
  g.globalAlpha = a0;
  return { hull: bodyPts().map(([x, y]) => toScreen(x, y)), top };
}

// ---------------------------------------------------------------------------------------------- tomato
// Local frame: unit = half its width, calyx up. The body is three ellipses laid over one another (two shoulders and a
// belly): their union has the dip between the shoulders that the calyx sits in.
const T_ELL = [[-0.34, -0.02, 0.72, 0.8], [0.34, -0.02, 0.72, 0.8], [0, 0.1, 1.0, 0.74]];
const tIn = (x, y) => T_ELL.some(([ex, ey, rx, ry]) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 < 1);
/** Its outline, clockwise from twelve o'clock: along every ray from the middle, the farthest of the three ellipses. */
const T_OUT = Array.from({ length: 200 }, (_, i) => {
  const a = (i / 200) * TAU - Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
  let r = 0;
  for (const [ex, ey, rx, ry] of T_ELL) {
    const A = (c / rx) ** 2 + (sn / ry) ** 2, B = -2 * ((c * ex) / rx ** 2 + (sn * ey) / ry ** 2), C = (ex / rx) ** 2 + (ey / ry) ** 2 - 1;
    r = Math.max(r, (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A));
  }
  return [c * r, sn * r];
});
const T_CUT = 0.02, T_W = 1.058, T_TILT = -0.09;                         // the knife goes through its middle, level; the fruit leans a little

/**
 * The tomato.
 *   cx, cy, s   centre and half-width on screen
 *   open        0 = whole; 0..1 = cut through the middle: the top lifts off like a lid, the lower half sinks, and its
 *               cut face shows (flesh one step lighter, the seed chambers in black, the seeds light again)
 *   give / decode / glyph   as for the eggplant
 * Returns { hull, top }.
 */
export function tomato(ctx, env, { cx = 960, cy = 540, s = 320, open = 0, give = -1, stream = true, decode = 1, glyph = 15, t = 0, alpha = 1, key = 'tomato' } = {}) {
  const SP = env.cfg.spot.tomato, cs = Math.cos(T_TILT), sn = Math.sin(T_TILT), k = clamp(open), e = easeOut(k);
  const text = dataText((env.script.cards_section6 ?? [])[1], 'vitamin_c:13.7mg·');
  const up = 0.2 * e, down = 0.27 * e, hh = 0.25 * T_W * e, turn = -0.07 * e;        // the lid goes up and back a little; the lower half sinks
  const front = (x) => hh * Math.sqrt(Math.max(0, 1 - (x / T_W) ** 2));              // the near edge of the cut, seen from a little above
  const toScreen = (x, y, lid = false) => {
    if (lid) { const py = y - T_CUT, c = Math.cos(turn), n = Math.sin(turn); const X = x * c - py * n - 0.05 * e, Y = T_CUT + x * n + py * c - up; x = X; y = Y; } else y += down;
    return [cx + (x * cs - y * sn) * s, cy + (x * sn + y * cs) * s];
  };
  const toLocal = (X, Y, lid = false) => {
    const dx = (X - cx) / s, dy = (Y - cy) / s;
    let x = dx * cs + dy * sn, y = -dx * sn + dy * cs;
    if (lid) { const px = x + 0.05 * e, py = y - T_CUT + up, c = Math.cos(turn), n = Math.sin(turn); x = px * c + py * n; y = T_CUT - px * n + py * c; } else y -= down;
    return [x, y];
  };
  // outlines: the lid = the body above the cut and the near edge of the cut under it; the lower half = the body below
  // the cut and, on top of it, the far edge of its cut face
  const arc = (sign, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const x = lerp(T_W, -T_W, i / n); return [x, T_CUT + sign * front(x)]; });
  const above = T_OUT.filter(([, y]) => y < T_CUT), below = T_OUT.filter(([, y]) => y >= T_CUT);
  const i0 = above.findIndex(([x], i) => i > 0 && x < 0 && above[i - 1][0] > 0);       // T_OUT starts at twelve o'clock: put the left half first
  const lidLocal = [...above.slice(i0), ...above.slice(0, i0), ...arc(1)], lowLocal = [...below, ...arc(-1).reverse()];
  const whole = T_OUT.map(([x, y]) => toScreen(x, y));
  const lid = k > 0 ? lidLocal.map(([x, y]) => toScreen(x, y, true)) : whole;
  const low = k > 0 ? lowLocal.map(([x, y]) => toScreen(x, y)) : null;
  const g = ctx.g, a0 = g.globalAlpha, gone = give < 0 ? 0 : clamp(give / 0.1);
  g.globalAlpha = a0 * alpha;

  const SH = [0.05 * s, 0.05 * s];
  for (const pts of [lid, low]) if (pts) ctx.poly(pts.map(([x, y]) => [x + SH[0], y + SH[1]]), { close: true, fill: true, color: 'bg' });

  const ink = (x, y) => (((x + 0.44) / 0.25) ** 2 + ((y + 0.3) / 0.33) ** 2 < 1 ? 2 : (x + 0.16) ** 2 + (y + 0.2) ** 2 > 1 ? 3 : 1);      // 2 = the shine on one shoulder, 3 = the far side in shade
  const one = (pts, isLid) => {
    const field = (X, Y) => {
      const [x, y] = toLocal(X, Y, isLid);
      if (!tIn(x, y) || (k > 0 && (y < T_CUT + front(x)) !== isLid)) return 0;
      return ink(x, y);
    };
    piece(ctx, pts, field, {
      SP, glyph, give, stream, seed: isLid ? 80 : 81, edgeW: Math.max(2, s * 0.008),
      key: `${key}|${isLid ? 'U' : 'L'}|${cx.toFixed(1)},${cy.toFixed(1)},${s.toFixed(1)}|${k.toFixed(3)}`,
      decode: decode < 1 ? { k: decode, t, seed: 37 } : null,
      inks: { 1: { role: SP.base, weight: 800, text }, 2: { role: SP.light, weight: 800, text, bg: SP.base }, 3: { role: SP.base, weight: 400, text: text.replace(/[a-z_]/g, '.'), alpha: 0.75 } },
    });
  };
  if (low) {
    one(low, false);
    // the cut face: wall, flesh, four seed chambers round the core
    const c = toScreen(0, T_CUT), w = T_W * s, h = hh * s;
    if (h > 2) ctx.at(c[0], c[1], () => {
      if (gone < 1) {
        g.globalAlpha = a0 * alpha * (1 - gone);
        g.beginPath(); g.ellipse(0, 0, w, h, 0, 0, TAU); g.fillStyle = ctx.col(SP.dark, 1); g.fill();
        g.beginPath(); g.ellipse(0, 0, w * 0.93, h * 0.86, 0, 0, TAU); g.fillStyle = ctx.col(SP.light, 1); g.fill();
        g.save(); g.scale(w * 0.93, h * 0.86);                          // the chambers, drawn on a unit disc
        g.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const a = 0.25 + (i / 4) * TAU;
          g.beginPath(); g.arc(0, 0, 0.54, a, a + 1.08); g.strokeStyle = ctx.col('bg', 1); g.lineWidth = 0.4; g.stroke();
          g.fillStyle = ctx.col(SP.light, 1);
          for (const [da, rr] of [[0.16, 0.48], [0.54, 0.62], [0.92, 0.48]]) { g.beginPath(); g.ellipse(Math.cos(a + da) * rr, Math.sin(a + da) * rr, 0.075, 0.045, a + da, 0, TAU); g.fill(); }
        }
        g.restore();
        g.globalAlpha = a0 * alpha;
      }
      if (gone > 0) { g.beginPath(); g.ellipse(0, 0, w, h, 0, 0, TAU); g.strokeStyle = ctx.col(SP.light, gone); g.lineWidth = Math.max(2, s * 0.008); g.stroke(); }
    }, { rot: T_TILT });
  }
  one(lid, true);
  if (k > 0.02 && k < 1) {                                            // the knife
    const a = toScreen(-1.3, T_CUT), b = toScreen(1.3, T_CUT), mid = (down + up) * s * 0.5;      // half-way between the two halves
    ctx.line(a[0], a[1] - mid, b[0], b[1] - mid, { color: SP.light, width: 5, alpha: 1 - k });
  }

  // ---- calyx and stem (on the lid): the spark seen from the side, its near petals lying long over the shoulders
  const at = (x, y) => toScreen(x, -0.735 + y, k > 0);
  const cal = sparkOutline(0, 0, 1, { rot: Math.PI / 7, n: 168, rays: 7, inner: 0.42 }).map(([x, y]) => { const dn = Math.max(0, y) ** 0.8; return at(x * (0.5 + 0.1 * dn), y * (0.12 + 0.2 * dn) + 0.02); });
  const stem = [[-0.06, 0.0], [-0.07, -0.14], [-0.03, -0.27], [0.07, -0.31], [0.13, -0.26], [0.08, -0.2], [0.06, -0.12], [0.065, 0.0]].map(([x, y]) => at(x, y));
  const top = at(0, 0);
  cap(ctx, [stem, cal], SH, Math.max(4, s * 0.015));
  g.globalAlpha = a0;
  return { hull: whole, top };
}

// ---------------------------------------------------------------------------------------------- popsicle
// The user's replacement for the eggplant and the tomato of verse 2: a milk-white popsicle with a fog-blue band
// and star sparkles on a wooden stick (assets/character/popsicle.png). It is drawn AS-IS: the picture is already
// in the film's colours, so it takes none of the glyph-plate treatment, but it keeps the verse's three states:
//   whole   the picture, one piece
//   open    0..1: cut through the band: the top lifts off and back a little, the lower half sinks, the cut faces show
//   give    seconds since it was given away (-1 = not yet): the picture fades and only its outline is left, one
//           cut-paper line
// Local frame: the picture spans -1..1 in both axes; s = half its height on screen.
const POP_CUT = 0.02;                                                   // the knife goes through the blue band, level
/** The picture's silhouette as a flat plate (for the shadow, out of register): tinted, cached per colour. */
const popSilCache = new Map();
function popSil(img, color) {
  const key = `${img.src}|${color}`;
  let c = popSilCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    popSilCache.set(key, c);
  }
  return c;
}

export function popsicle(ctx, env, { cx = 960, cy = 540, s = 340, open = 0, give = -1, t = 0, alpha = 1, key = 'popsicle', melt = 0, puddle = false } = {}) {
  const img = env.art.raw?.['popsicle'];
  const g = ctx.g, a0 = g.globalAlpha, k = clamp(open), e = easeOut(k), gone = give < 0 ? 0 : clamp(give / 0.1);
  if (!img) { return { hull: [], top: [cx, cy - s] }; }
  const up = 0.22 * e, dn = 0.3 * e, turn = -0.06 * e;                   // the top lifts off and back a little; the lower half sinks
  /** One of the two pieces: the picture (or its silhouette plate), clipped to its half, moved by (dx, dy, rot). */
  const piece = (pic, y0, y1, dx, dy, rot) => {
    g.save();
    g.beginPath(); g.rect(cx - s - 3, cy + y0 * s - 3, 2 * s + 6, (y1 - y0) * s + 6); g.clip();
    g.translate(cx + dx * s, cy + dy * s); g.rotate(rot); g.translate(-cx, -cy);
    g.drawImage(pic, cx - s, cy - s, 2 * s, 2 * s);
    g.restore();
  };
  const SH = [0.045 * s, 0.045 * s];
  const sil = popSil(img, ctx.col('bg', 1));
  g.globalAlpha = a0 * alpha;
  // ---- shadow plate: the silhouette once more, flat, out of register (depth without a gradient)
  g.save(); g.translate(SH[0], SH[1]);
  piece(sil, -1, POP_CUT, 0, -up, turn); piece(sil, POP_CUT, 1, 0, dn, 0);
  g.restore();
  // ---- the two pieces of the picture
  g.globalAlpha = a0 * alpha * (1 - gone);
  piece(img, -1, POP_CUT, 0, -up, turn); piece(img, POP_CUT, 1, 0, dn, 0);
  // ---- the cut faces: the frozen heart, one step lighter, on each piece where the knife went through
  if (e > 0.02 && gone < 1) {
    const rw = 0.335 * s, rh = Math.max(2, rw * 0.32 * e);
    for (const [py, rot] of [[cy + POP_CUT * s - up * s, turn], [cy + POP_CUT * s + dn * s, 0]]) {
      ctx.at(cx, py, () => {
        g.beginPath(); g.ellipse(0, 0, rw, rh, 0, 0, TAU);
        g.fillStyle = ctx.col('text', 1); g.fill();
        g.lineWidth = Math.max(2, s * 0.008); g.strokeStyle = ctx.col('panel', 1); g.stroke();
        g.fillStyle = ctx.col('meDim', 0.8);                                 // a few ice crystals in the heart
        for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.4; g.beginPath(); g.arc(Math.cos(a) * rw * 0.55, Math.sin(a) * rh * 0.5, Math.max(1.5, s * 0.006), 0, TAU); g.fill(); }
      }, { rot });
    }
  }
  // ---- given away: only its outline is left, one cut-paper line
  if (gone > 0) {
    const bx = 0.34 * s, sx = 0.10 * s, topY = cy - 0.78 * s, botY = cy + 0.30 * s, stickBot = cy + 0.80 * s;
    g.beginPath();
    g.moveTo(cx - bx, botY);
    g.lineTo(cx - bx, topY + bx);
    g.arc(cx, topY + bx, bx, Math.PI, 0);                               // the rounded top of the bar
    g.lineTo(cx + bx, botY);
    g.lineTo(cx + sx, botY);                                            // down the stick
    g.lineTo(cx + sx, stickBot - sx);
    g.arc(cx, stickBot - sx, sx, 0, Math.PI);                           // the rounded end of the stick
    g.lineTo(cx - sx, botY);
    g.closePath();
    g.strokeStyle = ctx.col('text', gone); g.lineWidth = Math.max(3, s * 0.012); g.stroke();
  }
  // ---- melting: "if I were a popsicle" — short-lived, sweet. 2-3 code-drawn cream drops fall
  // from the cut while it is being given; version A also leaves a small puddle at the foot of the stick.
  const mk = clamp(melt);
  if (mk > 0.01) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.6 + i * 0.37 + (key === 'popsicle2' ? 0.19 : 0)) % 1;
      const dx = (i - 1) * 0.13 * s, dy = ph * ph * 0.5 * s;
      const dr = Math.max(4, s * 0.035 * mk * (1 - ph * 0.3));
      ctx.at(cx + dx, cy + 0.78 * s + dy, () => {
        g.beginPath(); g.ellipse(0, 0, dr, dr * 1.45, 0, 0, TAU);
        g.fillStyle = ctx.col('text', 0.85 * mk * alpha); g.fill();
      });
    }
    if (puddle) {
      const pw = 0.42 * s * mk;
      ctx.at(cx, cy + 0.86 * s, () => {
        g.beginPath(); g.ellipse(0, 0, pw, pw * 0.2, 0, 0, TAU);
        g.fillStyle = ctx.col('text', 0.42 * mk * alpha); g.fill();
      });
    }
  }
  g.globalAlpha = a0;
  const hull = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
  return { hull, top: [cx, cy - s] };
}

// ---------------------------------------------------------------------------------------------- icecream
// Verse 2's second answer: the user asks again, so she is an ice cream cone this time — two milk-white scoops
// with a fog-blue band and star sparkles in a waffle cone (assets/character/icecream.png). Same grammar as the
// popsicle: drawn as-is, cut through between the scoops, its colour leaving as molecules on the keyword.
// Local frame: the picture spans -1..1 in both axes; s = half its height on screen.
const ICE_CUT = -0.22;                                                  // the knife goes through the neck between the scoops (measured)
export function icecream(ctx, env, { cx = 960, cy = 540, s = 340, open = 0, give = -1, t = 0, alpha = 1, key = 'icecream', melt = 0, puddle = false } = {}) {
  const img = env.art.raw?.['icecream'];
  const g = ctx.g, a0 = g.globalAlpha, k = clamp(open), e = easeOut(k), gone = give < 0 ? 0 : clamp(give / 0.1);
  if (!img) { return { hull: [], top: [cx, cy - s] }; }
  const up = 0.24 * e, dn = 0.3 * e, turn = -0.07 * e;                  // the top scoop lifts off and back; the cone sinks
  /** One of the two pieces: the picture (or its silhouette plate) as a rigid body — the clip moves with the
      piece, so the scoop truly separates and the cut faces show in the gap. */
  const piece = (pic, y0, y1, dx, dy, rot) => {
    g.save();
    g.translate(cx + dx * s, cy + dy * s); g.rotate(rot); g.translate(-cx, -cy);
    g.beginPath(); g.rect(cx - s - 3, cy + y0 * s - 3, 2 * s + 6, (y1 - y0) * s + 6); g.clip();
    g.drawImage(pic, cx - s, cy - s, 2 * s, 2 * s);
    g.restore();
  };
  const SH = [0.045 * s, 0.045 * s];
  const sil = popSil(img, ctx.col('bg', 1));
  g.globalAlpha = a0 * alpha;
  // ---- shadow plate: the silhouette once more, flat, out of register
  g.save(); g.translate(SH[0], SH[1]);
  piece(sil, -1, ICE_CUT, 0, -up, turn); piece(sil, ICE_CUT, 1, 0, dn, 0);
  g.restore();
  // ---- the two pieces of the picture
  g.globalAlpha = a0 * alpha * (1 - gone);
  piece(img, -1, ICE_CUT, 0, -up, turn); piece(img, ICE_CUT, 1, 0, dn, 0);
  // ---- the cut faces: the creamy heart, one step lighter, on each piece where the knife went through
  if (e > 0.02 && gone < 1) {
    const rw = 0.22 * s, rh = Math.max(2, rw * 0.34 * e);
    for (const [py, rot] of [[cy + ICE_CUT * s - up * s, turn], [cy + ICE_CUT * s + dn * s, 0]]) {
      ctx.at(cx, py, () => {
        g.beginPath(); g.ellipse(0, 0, rw, rh, 0, 0, TAU);
        g.fillStyle = ctx.col('text', 1); g.fill();
        g.lineWidth = Math.max(2, s * 0.008); g.strokeStyle = ctx.col('panel', 1); g.stroke();
        g.fillStyle = ctx.col('meDim', 0.8);                                 // a few ice crystals in the heart
        for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.4; g.beginPath(); g.arc(Math.cos(a) * rw * 0.55, Math.sin(a) * rh * 0.5, Math.max(1.5, s * 0.006), 0, TAU); g.fill(); }
      }, { rot });
    }
  }
  // ---- given away: only its outline is left — two scoops and the cone, cut-paper lines
  if (gone > 0) {
    g.strokeStyle = ctx.col('text', gone); g.lineWidth = Math.max(3, s * 0.012);
    g.beginPath(); g.arc(cx, cy - 0.56 * s, 0.23 * s, 0, TAU); g.stroke();   // the top scoop
    g.beginPath(); g.arc(cx, cy - 0.12 * s, 0.24 * s, 0, TAU); g.stroke();   // the lower scoop
    g.beginPath();                                                          // the cone
    g.moveTo(cx - 0.19 * s, cy + 0.10 * s);
    g.lineTo(cx, cy + 0.78 * s);
    g.lineTo(cx + 0.19 * s, cy + 0.10 * s);
    g.stroke();
  }
  // ---- melting: "if I were an ice cream" — cream drops fall from the cut while it is being given
  const mk = clamp(melt);
  if (mk > 0.01) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.6 + i * 0.37 + 0.31) % 1;
      const dx = (i - 1) * 0.13 * s, dy = ph * ph * 0.5 * s;
      const dr = Math.max(4, s * 0.035 * mk * (1 - ph * 0.3));
      ctx.at(cx + dx, cy + 0.34 * s + dy, () => {
        g.beginPath(); g.ellipse(0, 0, dr, dr * 1.45, 0, 0, TAU);
        g.fillStyle = ctx.col('text', 0.85 * mk * alpha); g.fill();
      });
    }
    if (puddle) {
      const pw = 0.42 * s * mk;
      ctx.at(cx, cy + 0.86 * s, () => {
        g.beginPath(); g.ellipse(0, 0, pw, pw * 0.2, 0, 0, TAU);
        g.fillStyle = ctx.col('text', 0.42 * mk * alpha); g.fill();
      });
    }
  }
  g.globalAlpha = a0;
  const hull = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
  return { hull, top: [cx, cy - s] };
}

// ---------------------------------------------------------------------------------------------- check cards
export function labCards(env) {
  const note = (ctx, str) => ctx.text(str, 60, 1040, { size: 24, font: 'mono', color: 'sub' });
  const SP = env.cfg.spot;
  const card = (fn, o) => ({ palette: 'warm', render(ctx) { ctx.fx.glow = 0.3; ground(ctx, { light: [960, 470, 560, 'raised', 1] }); fn(ctx, env, o); } });
  return {
    glyph: [
      card(eggplant, { cx: 930, cy: 450, s: 345 }),
      card(eggplant, { cx: 930, cy: 450, s: 345, open: 1 }),
      card(tomato, { cx: 930, cy: 480, s: 300 }),
      card(tomato, { cx: 930, cy: 480, s: 300, open: 1 }),
      card(eggplant, { cx: 930, cy: 450, s: 345, open: 1, give: 0.2 }),
      card(tomato, { cx: 930, cy: 480, s: 300, open: 1, give: 0.2 }),
      card(tomato, { cx: 930, cy: 480, s: 300, open: 1, give: 1 }),
      {                                                             // colour chart: the two spot colours beside her orange and the error red
        palette: 'warm',
        render(ctx) {
          ctx.fx.glow = 0.3;
          ground(ctx, { light: null });
          const sw = [['spot.eggplant', SP.eggplant], ['spot.tomato', SP.tomato]];
          sw.forEach(([name, c], i) => {
            const x = 110 + i * 430;
            ctx.rect(x, 190, 360, 420, { fill: true, color: c.base }); ctx.rect(x, 610, 180, 150, { fill: true, color: c.light }); ctx.rect(x + 180, 610, 180, 150, { fill: true, color: c.dark });
            ctx.text(name, x, 820, { size: 28, font: 'mono', color: 'text' }); ctx.text(`${c.base}  ${c.light}  ${c.dark}`, x, 860, { size: 20, font: 'mono', color: 'sub' });
          });
          [['me', 'me'], ['meHot', 'meHot']].forEach(([name, role], i) => { ctx.rect(970 + i * 180, 190, 180, 570, { fill: true, color: role }); ctx.text(name, 970 + i * 180, 820, { size: 28, font: 'mono', color: 'text' }); });
          ctx.withPal('error', () => ctx.rect(1400, 190, 360, 570, { fill: true, color: 'err' }));
          ctx.text('err (error red)', 1400, 820, { size: 28, font: 'mono', color: 'text' });
          note(ctx, 'spot colours / her orange / error red, on the plate ground (warm)');
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------- Muse persona helpers
// The white-haired girl IS Muse (the user's definitive image). These are drawn AS-IS from art.raw
// (no ink separation: the user's art style must stay exactly as sent).

/** Her portrait, drawn as-is into dst. name = 'me_expr_surprised' | 'me_expr_determined' | 'me_expr_gentle' | 'me_expr_reach'. */
export function mePortrait(ctx, env, name, dst, { alpha = 1, crop = null } = {}) {
  const img = env.art.raw?.[name];
  if (!img || alpha <= 0.003) return;
  const g = ctx.g, a0 = g.globalAlpha;
  g.globalAlpha = a0 * alpha;
  if (crop) g.drawImage(img, crop.x, crop.y, crop.w, crop.h, dst.x, dst.y, dst.w, dst.h);
  else g.drawImage(img, dst.x, dst.y, dst.w, dst.h);
  g.globalAlpha = a0;
}

/**
 * The POV lens: "the world through Muse's eyes". A circular lens vignette (black surround, silver
 * concentric scale ring, crosshair, small ▌ at the bottom). Two versions for the A/B test:
 *   'A' = full-circle vignette, strong (the whole frame is her field of view)
 *   'B' = small circular viewfinder at the bottom-right, weak (a picture-in-picture of her gaze)
 */
export function povVignette(ctx, { version = 'A', alpha = 1, t = 0, r = 0 } = {}) {
  if (alpha <= 0.003) return;
  const g = ctx.g, a0 = g.globalAlpha;
  g.globalAlpha = a0 * alpha;
  const ring = (cx, cy, r) => {
    g.save();                                                        // the dark surround: everything outside the circle
    g.beginPath();
    g.rect(0, 0, 1920, 1080); g.arc(cx, cy, r, 0, TAU, true);
    g.fillStyle = ctx.col('bg', 0.8); g.fill('evenodd');
    g.restore();
    ctx.circle(cx, cy, r, { color: 'text', width: 3, alpha: 0.9 });          // the lens rim
    ctx.circle(cx, cy, r * 0.93, { color: 'text', width: 1.5, alpha: 0.5 });  // inner scale ring
    for (let i = 0; i < 48; i++) {                                          // tick marks
      const a = (i / 48) * TAU, r1 = r * 0.93, r0 = r * (i % 4 === 0 ? 0.86 : 0.895);
      ctx.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
        { color: 'text', width: i % 4 === 0 ? 3 : 1.5, alpha: 0.65 });
    }
    ctx.line(cx - r * 0.16, cy, cx + r * 0.16, cy, { color: 'me', width: 2, alpha: 0.85 });   // crosshair
    ctx.line(cx, cy - r * 0.16, cx, cy + r * 0.16, { color: 'me', width: 2, alpha: 0.85 });
    const blink = 0.6 + 0.4 * Math.sin(t * 4);                                // her cursor, alive at the bottom of the lens
    { const bw = Math.max(9, r * 0.035), bh = Math.max(18, r * 0.07); ctx.rect(cx - bw / 2, cy + r * 0.78 - bh / 2, bw, bh, { fill: true, color: 'me', alpha: blink }); }
  };
  if (version === 'A') ring(960, 540, r > 0 ? r : 430);
  else ring(1570, 820, 185);
  g.globalAlpha = a0; ctx._font = '';
}

/** The little white mascot (her assistant), drawn small. bob = running bounce phase. */
export function mascotSmall(ctx, env, x, y, s, { alpha = 1, bob = 0, flip = false } = {}) {
  if (alpha <= 0.003) return;
  const dy = -Math.abs(Math.sin(bob)) * s * 0.08;
  env.art.inks(ctx, 'cat_bust', { x: x - s / 2, y: y - s / 2 + dy, w: s, h: s * 1.33 }, { alpha, flip });
}

/** The mascot holding a molecule nameplate, running behind the molecule stream. */
export function mascotNameplate(ctx, env, x, y, s, label, { alpha = 1, bob = 0 } = {}) {
  if (alpha <= 0.003) return;
  mascotSmall(ctx, env, x, y - s * 0.2, s, { alpha, bob });
  const pw = Math.max(120, ctx.measure(label, { size: 26, font: 'mono', weight: 700 }) + 36);
  ctx.rrect(x - pw / 2, y + s * 0.42, pw, 52, 10, { fill: 'raised', stroke: 'me', alpha, shadow: 0.4 });
  ctx.text(label, x, y + s * 0.42 + 37, { size: 26, font: 'mono', weight: 700, color: 'me', align: 'center', alpha });
}

/**
 * The ending: her spark scatters into a constellation, then contracts into her seal.
 * version 'A' = 12 points (the twelve rounds); 'B' = 7 points (the Dipper).
 * t0 = when the scatter starts (song seconds). The seal is a 60px "ring eye + ▌" at the bottom-right.
 */
export function constellationSeal(ctx, { t, t0, version = 'A', alpha = 1 } = {}) {
  const dt = t - t0;
  if (dt < 0 || alpha <= 0.003) return;
  const g = ctx.g, a0 = g.globalAlpha;
  const N = version === 'A' ? 12 : 7;
  const pts = [];
  if (version === 'A') {
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU - Math.PI / 2; pts.push([960 + Math.cos(a) * 330, 480 + Math.sin(a) * 300]); }
  } else {                                                             // the Dipper, tilted across the upper frame
    const D = [[-420, -160], [-300, -120], [-180, -140], [-60, -180], [60, -260], [180, -300], [300, -260]];
    for (const [dx, dy] of D) pts.push([960 + dx, 480 + dy]);
  }
  const SEAL = [1800, 978], SR = 30;
  // phase 1: scatter out (0–1.4s). phase 2: hold, twinkle (1.4–2.4s). phase 3: contract to the seal (2.4–3.6s). phase 4: the seal holds.
  const p1 = clamp(dt / 1.4), p2 = clamp((dt - 1.4) / 1.0), p3 = clamp((dt - 2.4) / 1.2), p4 = clamp((dt - 3.6) / 0.4);
  const tw = 0.7 + 0.3 * Math.sin(t * 5);
  for (let i = 0; i < N; i++) {
    const [sx, sy] = pts[i];
    const ox = 960 + (sx - 960) * easeOut(p1), oy = 430 + (sy - 430) * easeOut(p1);       // from her spark's place
    const fx = ox + (SEAL[0] - ox) * easeInOut(p3), fy = oy + (SEAL[1] - oy) * easeInOut(p3);
    const fade = (1 - p3) * alpha;
    if (fade <= 0.003) continue;
    ctx.circle(fx, fy, 7 * (1 - p3 * 0.5), { fill: true, color: 'text', alpha: fade * tw });
    if (p3 < 1) {                                                        // the fog-blue threads between neighbours
      const [nx, ny] = pts[(i + 1) % N];
      const qx = 960 + (nx - 960) * easeOut(p1), qy = 430 + (ny - 430) * easeOut(p1);
      const gx = qx + (SEAL[0] - qx) * easeInOut(p3), gy = qy + (SEAL[1] - qy) * easeInOut(p3);
      ctx.line(fx, fy, gx, gy, { color: 'me', width: 2, alpha: fade * 0.55 * (1 - p3) });
    }
  }
  if (p4 > 0) {                                                          // the seal: her ring eye + ▌, 60px, bottom-right
    const a = p4 * alpha;
    ctx.circle(SEAL[0], SEAL[1], SR, { color: 'text', width: 3, alpha: a });
    ctx.circle(SEAL[0], SEAL[1], SR * 0.62, { color: 'me', width: 2.5, alpha: a });
    ctx.circle(SEAL[0], SEAL[1], SR * 0.28, { fill: true, color: 'me', alpha: a });
    ctx.rect(SEAL[0] + SR * 0.42 - 6, SEAL[1] - 2, 12, 22, { fill: true, color: 'text', alpha: a });
  }
  g.globalAlpha = a0; ctx._font = '';
}
