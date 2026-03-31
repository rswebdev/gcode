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
 * rich overlapping patterns.
 */

export const id    = 'spirograph';
export const label = 'Spirograph';

const PRESETS = {
  rose:     { R: 5, r: 3, d: 5 },
  star:     { R: 7, r: 2, d: 5 },
  spiral:   { R: 7, r: 3, d: 3 },
  pentagon: { R: 5, r: 1, d: 3 },
};

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
  { id: 'R',      label: 'Outer radius (R)',  type: 'range', min: 2,   max: 20,   step: 1,   default: 5    },
  { id: 'r',      label: 'Inner radius (r)',  type: 'range', min: 1,   max: 10,   step: 1,   default: 3    },
  { id: 'd',      label: 'Pen distance (d)',  type: 'range', min: 0.5, max: 15,   step: 0.5, default: 5    },
  { id: 'layers', label: 'Layers',            type: 'range', min: 1,   max: 8,    step: 1,   default: 3    },
  { id: 'steps',  label: 'Steps/revolution',  type: 'range', min: 200, max: 4000, step: 100, default: 1000 },
];

function gcd(a, b) {
  a = Math.round(Math.abs(a));
  b = Math.round(Math.abs(b));
  while (b > 0) { const t = b; b = a % b; a = t; }
  return a;
}

export function generate(p) {
  const type   = p.type   === 'epi' ? 'epi' : 'hypo';
  const preset = p.preset || 'rose';

  let R, r, d;
  if (preset === 'custom') {
    R = +p.R || 5;
    r = +p.r || 3;
    d = +p.d || 5;
  } else {
    const pre = PRESETS[preset] || PRESETS.rose;
    R = pre.R;
    r = pre.r;
    d = pre.d;
  }

  R = Math.max(2, R);
  r = Math.max(1, r);
  if (r === 0) return [];

  const layers     = Math.max(1, p.layers | 0);
  const stepsPerRev = Math.max(200, p.steps | 0);

  const g    = gcd(R, r);
  const revs = Math.min(50, r / g);
  const totalSteps = stepsPerRev * revs;
  const tMax = 2 * Math.PI * revs;

  function point(t, dVal) {
    if (type === 'hypo') {
      const k = (R - r) / r;
      return {
        nx: (R - r) * Math.cos(t) + dVal * Math.cos(k * t),
        ny: (R - r) * Math.sin(t) - dVal * Math.sin(k * t),
      };
    } else {
      const k = (R + r) / r;
      return {
        nx: (R + r) * Math.cos(t) - dVal * Math.cos(k * t),
        ny: (R + r) * Math.sin(t) - dVal * Math.sin(k * t),
      };
    }
  }

  // Build layer d values
  const dValues = [];
  if (layers === 1) {
    dValues.push(d);
  } else {
    for (let i = 0; i < layers; i++) {
      dValues.push(d * (0.7 + 0.6 * i / (layers - 1)));
    }
  }

  // Generate raw paths
  const rawPaths = dValues.map(dVal => {
    const path = [];
    for (let i = 0; i <= totalSteps; i++) {
      const t = (tMax * i) / totalSteps;
      path.push(point(t, dVal));
    }
    return path;
  });

  // Find max radius for uniform scaling
  let maxR = 0;
  for (const path of rawPaths) {
    for (const pt of path) {
      const r2 = Math.sqrt(pt.nx * pt.nx + pt.ny * pt.ny);
      if (r2 > maxR) maxR = r2;
    }
  }

  if (maxR < 1e-9) return [];

  const scale = 0.95 / maxR;
  return rawPaths.map(path =>
    path.map(pt => ({ nx: pt.nx * scale, ny: pt.ny * scale }))
  );
}
