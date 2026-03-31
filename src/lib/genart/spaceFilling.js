/**
 * genart/spaceFilling.js
 * Space-filling curves for pen-plotter G-code generation.
 *
 * Supported curves:
 *   Hilbert  — classic recursive space-filling quadrant curve
 *   Moore    — closed variant of Hilbert via L-system
 *   Gosper   — hexagonal "flowsnake" via L-system (60° turns)
 *   Peano    — original Peano curve via L-system (90° turns, 3-branch)
 */

export const id    = 'spaceFilling';
export const label = 'Space-Filling Curves';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'curve', label: 'Curve', type: 'select', default: 'hilbert',
    options: [
      { value: 'hilbert', label: 'Hilbert' },
      { value: 'moore',   label: 'Moore'   },
      { value: 'gosper',  label: 'Gosper'  },
      { value: 'peano',   label: 'Peano'   },
    ],
  },
  { id: 'order', label: 'Order', type: 'range', min: 1, max: 6, step: 1, default: 4 },
];

// ─── Hilbert ──────────────────────────────────────────────────────────────────

function d2xy(n, d) {
  let rx, ry, s, t = d;
  let x = 0, y = 0;
  for (s = 1; s < n; s *= 2) {
    rx = 1 & (t / 2);
    ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return { x, y };
}

function hilbertPoints(order) {
  const n    = 1 << order;           // 2^order
  const total = n * n;               // 4^order
  const pts  = new Array(total);
  for (let d = 0; d < total; d++) {
    pts[d] = d2xy(n, d);
  }
  return pts;
}

// ─── L-system helpers ─────────────────────────────────────────────────────────

const L_CAP = 300_000;

function lsExpand(axiom, rules, iterations) {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of s) {
      next += rules[ch] ?? ch;
      if (next.length >= L_CAP) { next = next.slice(0, L_CAP); break; }
    }
    s = next;
  }
  return s;
}

function turtleWalk(str, moveChars, angleDeg) {
  const pts   = [];
  let x = 0, y = 0, angle = 0;
  const step  = 1;
  const rad   = (angleDeg * Math.PI) / 180;

  for (const ch of str) {
    if (moveChars.includes(ch)) {
      x += step * Math.cos(angle);
      y += step * Math.sin(angle);
      pts.push({ x, y });
    } else if (ch === '+') {
      angle -= rad;
    } else if (ch === '-') {
      angle += rad;
    }
  }
  return pts;
}

// ─── Moore ────────────────────────────────────────────────────────────────────

function moorePoints(order) {
  const iterations = Math.max(0, order - 1);
  const axiom = 'AFA+F+AFA';
  const rules = {
    A: '-BF+AFA+FB-',
    B: '+AF-BFB-FA+',
  };
  const str = lsExpand(axiom, rules, iterations);
  return turtleWalk(str, ['F'], 90);
}

// ─── Gosper ───────────────────────────────────────────────────────────────────

function gosperPoints(order) {
  const axiom = 'A';
  const rules = {
    A: 'A-B--B+A++AA+B-',
    B: '+A-BB--B-A++A+B',
  };
  const str = lsExpand(axiom, rules, order);
  return turtleWalk(str, ['A', 'B'], 60);
}

// ─── Peano ────────────────────────────────────────────────────────────────────

function peanoPoints(order) {
  const axiom = 'F';
  const rules = { F: 'F+F-F-F-F+F+F+F-F' };
  const str   = lsExpand(axiom, rules, order);
  return turtleWalk(str, ['F'], 90);
}

// ─── Normalise raw {x,y} points → NDC [{nx,ny}] ──────────────────────────────

function normalise(pts, margin = 0.95) {
  if (!pts || pts.length === 0) return [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const { x, y } of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const range  = Math.max(rangeX, rangeY);
  if (range < 1e-12) return [];
  const scale  = (2 * margin) / range;
  const cx     = (minX + maxX) / 2;
  const cy     = (minY + maxY) / 2;
  return pts.map(({ x, y }) => ({
    nx: (x - cx) * scale,
    ny: (y - cy) * scale,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const order = Math.min(6, Math.max(1, p.order | 0));
  const curve = p.curve ?? 'hilbert';

  let raw;
  switch (curve) {
    case 'hilbert': raw = hilbertPoints(order); break;
    case 'moore':   raw = moorePoints(order);   break;
    case 'gosper':  raw = gosperPoints(order);  break;
    case 'peano':   raw = peanoPoints(order);   break;
    default:        raw = hilbertPoints(order); break;
  }

  const path = normalise(raw);
  if (path.length < 2) return [];
  return [path];
}
