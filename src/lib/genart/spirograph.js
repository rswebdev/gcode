/**
 * genart/spirograph.js
 * Hypotrochoid and Epitrochoid curves — the mathematical basis of the
 * classic Spirograph toy.
 *
 *   Hypotrochoid: x = (R-r)·cos(t) + d·cos((R-r)/r · t)
 *                 y = (R-r)·sin(t) − d·sin((R-r)/r · t)
 *
 *   Epitrochoid:  x = (R+r)·cos(t) − d·cos((R+r)/r · t)
 *                 y = (R+r)·sin(t) − d·sin((R+r)/r · t)
 *
 * Multiple concentric layers vary the pen distance d to build up
 * rich overlapping patterns.  The stretchX/stretchY params distort the
 * circular rolling tracks into ellipses.
 */

export const id    = 'spirograph';
export const label = 'Spirograph';

const PRESETS = {
  rose:     { R: 5, r: 3, d: 5 },
  star:     { R: 7, r: 2, d: 5 },
  spiral:   { R: 7, r: 3, d: 3 },
  pentagon: { R: 5, r: 1, d: 3 },
};

// Exported so GenArt.svelte can seed slider values when the user picks a preset.
export const presets = PRESETS;

export const params = [
  {
    id: 'type', label: 'Type', type: 'select', default: 'hypo',
    options: [
      { value: 'hypo', label: 'Hypotrochoid' },
      { value: 'epi',  label: 'Epitrochoid'  },
    ],
  },
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'rose',
    options: [
      { value: 'rose',     label: 'Rose'      },
      { value: 'star',     label: 'Star'      },
      { value: 'spiral',   label: 'Spiral'    },
      { value: 'pentagon', label: 'Pentagon'  },
      { value: 'custom',   label: 'Custom'    },
    ],
  },
  { id: 'R',       label: 'Outer radius (R)',  type: 'range', min: 2,   max: 20,   step: 1,    default: 5    },
  { id: 'r',       label: 'Inner radius (r)',  type: 'range', min: 1,   max: 10,   step: 1,    default: 3    },
  { id: 'd',       label: 'Pen distance (d)',  type: 'range', min: 0.5, max: 15,   step: 0.5,  default: 5    },
  { id: 'layers',  label: 'Layers',            type: 'range', min: 1,   max: 8,    step: 1,    default: 3    },
  { id: 'steps',   label: 'Steps/revolution',  type: 'range', min: 200, max: 4000, step: 100,  default: 1000 },
  { id: 'stretchX', label: 'X stretch',        type: 'range', min: 0.3, max: 2.0,  step: 0.05, default: 1.0  },
  { id: 'stretchY', label: 'Y stretch',        type: 'range', min: 0.3, max: 2.0,  step: 0.05, default: 1.0  },
];

function gcd(a, b) {
  a = Math.round(Math.abs(a));
  b = Math.round(Math.abs(b));
  while (b > 0) { const t = b; b = a % b; a = t; }
  return a;
}

/** Returns a point-function (t, d) → {x, y} for the chosen curve type. */
function _makePointFn(R, r, type) {
  if (type === 'hypo') {
    const k = (R - r) / r;
    return (t, d) => ({
      x: (R - r) * Math.cos(t) + d * Math.cos(k * t),
      y: (R - r) * Math.sin(t) - d * Math.sin(k * t),
    });
  }
  const k = (R + r) / r;
  return (t, d) => ({
    x: (R + r) * Math.cos(t) - d * Math.cos(k * t),
    y: (R + r) * Math.sin(t) - d * Math.sin(k * t),
  });
}

/**
 * Resolve the d-values for each layer.
 * Exported so guide() can use the same distribution as generate().
 */
function _dValues(d, layers) {
  if (layers === 1) return [d];
  return Array.from({ length: layers }, (_, i) => d * (0.7 + 0.6 * i / (layers - 1)));
}

/**
 * Analytically exact normalisation scale after stretching.
 * rawMax is the maximum pen radius before stretching:
 *   hypo → |R − r| + dMax  (abs handles r > R / extended cycloids)
 *   epi  → R + r + dMax
 * dMax is the largest d value across all layers (from _dValues).
 */
function _normScale(R, r, dMax, type, sx, sy) {
  const rawMax = type === 'hypo' ? Math.abs(R - r) + dMax : (R + r + dMax);
  const stretchedMax = rawMax * Math.max(sx, sy);
  return stretchedMax < 1e-9 ? 1 : 0.95 / stretchedMax;
}

export function generate(p) {
  const type = p.type === 'epi' ? 'epi' : 'hypo';

  // Always use slider values — presets seed the sliders via GenArt.svelte's
  // setParam hook, so generate() never needs to override them directly.
  let R = +p.R || 5;
  let r = +p.r || 3;
  const d  = +p.d  || 5;
  const sx = isFinite(+p.stretchX) ? +p.stretchX : 1;
  const sy = isFinite(+p.stretchY) ? +p.stretchY : 1;

  R = Math.max(2, R);
  r = Math.max(1, r);

  const layers      = Math.max(1, p.layers | 0);
  const stepsPerRev = Math.min(4000, Math.max(200, p.steps | 0));

  const g    = gcd(R, r);
  const revs = Math.min(50, r / g);
  const totalSteps = stepsPerRev * revs;
  const tMax = 2 * Math.PI * revs;

  const ptFn  = _makePointFn(R, r, type);
  const dvs   = _dValues(d, layers);
  const dMax  = Math.max(...dvs);
  const scale = _normScale(R, r, dMax, type, sx, sy);

  return dvs.map(dVal => {
    const path = [];
    for (let i = 0; i <= totalSteps; i++) {
      const t = (tMax * i) / totalSteps;
      const { x, y } = ptFn(t, dVal);
      path.push({ nx: x * sx * scale, ny: y * sy * scale });
    }
    return path;
  });
}

// ─── Guide (background helper overlay) ────────────────────────────────────────

/** Generate a closed ellipse path in NDC. */
function _ellipsePath(cx, cy, rx, ry, nPts = 120) {
  return Array.from({ length: nPts + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / nPts;
    return { nx: cx + rx * Math.cos(t), ny: cy + ry * Math.sin(t) };
  });
}

/** Small cross marker at (cx, cy) in NDC, arm length armLen. */
function _cross(cx, cy, armLen = 0.025) {
  return [
    [{ nx: cx - armLen, ny: cy }, { nx: cx + armLen, ny: cy }],
    [{ nx: cx, ny: cy - armLen }, { nx: cx, ny: cy + armLen }],
  ];
}

/**
 * Returns background guide paths showing the rolling-circle geometry:
 *   • outer ellipse (the fixed track)
 *   • inner ellipse at t = 0 (the rolling circle in its start position)
 *   • cross at inner centre
 *   • pen arm + pen dot for each layer
 *
 * Paths are in NDC coordinates at the same scale as generate() so they
 * overlay correctly on the canvas.
 */
export function guide(p) {
  const type = p.type === 'epi' ? 'epi' : 'hypo';

  let R = Math.max(2, +p.R || 5);
  let r = Math.max(1, +p.r || 3);
  const d  = +p.d  || 5;
  const sx = isFinite(+p.stretchX) ? +p.stretchX : 1;
  const sy = isFinite(+p.stretchY) ? +p.stretchY : 1;
  const layers = Math.max(1, p.layers | 0);

  const dvs    = _dValues(d, layers);
  const dMax   = Math.max(...dvs);
  const scale  = _normScale(R, r, dMax, type, sx, sy);
  const ptFn   = _makePointFn(R, r, type);

  // Inner circle centre at t = 0 in spirograph coordinates
  const icRaw = type === 'hypo' ? (R - r) : (R + r);
  const icX   = icRaw * sx * scale;
  const icY   = 0;

  const paths = [];

  // Outer ellipse (the fixed track, radius R)
  paths.push(_ellipsePath(0, 0, R * sx * scale, R * sy * scale));

  // Inner ellipse (rolling circle, radius r, at t = 0 position)
  paths.push(_ellipsePath(icX, icY, r * sx * scale, r * sy * scale));

  // Cross at inner centre
  paths.push(..._cross(icX, icY, 0.025));

  // Pen arm + pen dot for each layer
  for (const dVal of dvs) {
    const { x: penRawX, y: penRawY } = ptFn(0, dVal);
    const penX = penRawX * sx * scale;
    const penY = penRawY * sy * scale;

    // Arm from inner centre to pen point
    paths.push([{ nx: icX, ny: icY }, { nx: penX, ny: penY }]);

    // Small circle at pen point
    paths.push(_ellipsePath(penX, penY, 0.018, 0.018, 32));
  }

  return paths;
}
