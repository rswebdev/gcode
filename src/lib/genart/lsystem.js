/**
 * genart/lsystem.js
 * L-System generative art algorithm.
 * Produces turtle-graphics paths from Lindenmayer-system axioms and rewrite rules.
 */

// ---------------------------------------------------------------------------
// Plugin metadata
// ---------------------------------------------------------------------------

export const id    = 'lsystem';
export const label = 'L-System';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'plant',
    options: [
      { value: 'plant',      label: 'Plant'         },
      { value: 'dragon',     label: 'Dragon Curve'  },
      { value: 'snowflake',  label: 'Koch Snowflake' },
      { value: 'sierpinski', label: 'Sierpinski'    },
    ],
  },
  { id: 'iterations', label: 'Iterations', type: 'range', min: 1, max: 7, step: 1, default: 4 },
  { id: 'angle',   label: 'Angle °',   type: 'range', min: 5,    max: 90,   step: 1,     default: 25    },
  { id: 'segLen',  label: 'Seg Len',   type: 'range', min: 0.002, max: 0.08, step: 0.001, default: 0.015 },
];

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

const PRESETS = {
  plant: {
    axiom: 'X',
    rules: { X: 'F[+X]F[-X]+X', F: 'FF' },
    startY: -0.85,    // stem starts near bottom
    startDir: Math.PI / 2,
  },
  dragon: {
    axiom: 'FX',
    rules: { X: 'X+YF+', Y: '-FX-Y' },
    startY: 0,
    startDir: 0,
  },
  snowflake: {
    axiom: 'F--F--F',
    rules: { F: 'F+F--F+F' },
    startY: 0.5,
    startDir: 0,
  },
  sierpinski: {
    axiom: 'F-G-G',
    rules: { F: 'F-G+F+G-F', G: 'GG' },
    startY: -0.6,
    startDir: 0,
  },
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function expand(axiom, rules, n) {
  let s = axiom;
  for (let i = 0; i < n; i++) {
    let next = '';
    for (const ch of s) next += rules[ch] ?? ch;
    s = next;
    if (s.length > 800_000) break; // safety cap
  }
  return s;
}

/**
 * Generate L-System paths in NDC [-1, +1] coordinates.
 * @param {Record<string,any>} p  param values (keyed by param id)
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const preset = PRESETS[p.preset] || PRESETS.plant;
  const angle  = (p.angle ?? 25) * Math.PI / 180;
  const segLen = p.segLen ?? 0.015;
  const iters  = Math.min(7, Math.max(1, p.iterations | 0));

  const str = expand(preset.axiom, preset.rules, iters);

  // Turtle state
  let x = 0, y = preset.startY ?? 0;
  let dir = preset.startDir ?? Math.PI / 2;
  const stack = [];

  const allPaths = [];
  let current = [{ x, y }];

  for (const ch of str) {
    if (ch === 'F' || ch === 'G') {
      const x2 = x + Math.cos(dir) * segLen;
      const y2 = y + Math.sin(dir) * segLen;
      current.push({ x: x2, y: y2 });
      x = x2; y = y2;
    } else if (ch === '+') {
      if (current.length > 1) allPaths.push(current);
      current = [{ x, y }];
      dir += angle;
    } else if (ch === '-') {
      if (current.length > 1) allPaths.push(current);
      current = [{ x, y }];
      dir -= angle;
    } else if (ch === '[') {
      if (current.length > 1) allPaths.push(current);
      current = [{ x, y }];
      stack.push({ x, y, dir });
    } else if (ch === ']') {
      if (current.length > 1) allPaths.push(current);
      const saved = stack.pop();
      x = saved.x; y = saved.y; dir = saved.dir;
      current = [{ x, y }];
    }
  }
  if (current.length > 1) allPaths.push(current);

  if (allPaths.length === 0) return [];

  // Fit to [-0.93, +0.93] while preserving aspect
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const path of allPaths) {
    for (const pt of path) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const cx    = (minX + maxX) / 2;
  const cy    = (minY + maxY) / 2;
  const range = Math.max(maxX - minX, maxY - minY, 0.001);
  const scale = 1.86 / range;

  return allPaths.map(path =>
    path.map(pt => ({
      nx:  (pt.x - cx) * scale,
      ny:  (pt.y - cy) * scale,
    }))
  );
}
