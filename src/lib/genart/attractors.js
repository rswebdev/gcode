export const id    = 'attractors';
export const label = 'Strange Attractors';

export const params = [
  { id: 'preset', label: 'Preset', type: 'select', default: 'clifford',
    options: [
      { value: 'clifford',  label: 'Clifford' },
      { value: 'dejong',    label: 'De Jong' },
      { value: 'lorenz',    label: 'Lorenz' },
      { value: 'rossler',   label: 'Rössler' },
      { value: 'halvorsen', label: 'Halvorsen' },
    ]},
  { id: 'steps', label: 'Steps', type: 'range', min: 5000, max: 200000, step: 5000, default: 80000 },
  { id: 'usePreset', label: 'Use preset values', type: 'toggle', default: true },
  // Widened to ±30 to accommodate Lorenz (a=10, b=28) and Rössler (c=5.7)
  { id: 'a', label: 'a', type: 'number', min: -30, max: 30, default: -1.4 },
  { id: 'b', label: 'b', type: 'number', min: -30, max: 30, default:  1.6 },
  { id: 'c', label: 'c', type: 'number', min: -30, max: 30, default:  1.0 },
  { id: 'd', label: 'd', type: 'number', min: -30, max: 30, default:  0.7 },
];

const PRESET_DEFAULTS = {
  clifford:  { a: -1.4, b:  1.6, c:  1.0,   d:  0.7 },
  dejong:    { a:  1.4, b: -2.3, c:  2.4,   d: -2.1 },
  lorenz:    { a: 10,   b: 28,   c:  2.667, d:  0   },
  rossler:   { a:  0.2, b:  0.2, c:  5.7,   d:  0   },
  halvorsen: { a:  1.4, b:  0,   c:  0,     d:  0   },
};

// Use an explicit flag (usePreset) instead of a fragile numeric sentinel.
// When usePreset is true (the default), PRESET_DEFAULTS[p.preset] is used so
// switching presets always picks the correct coefficients even when a/b/c/d
// happen to equal another preset's values.
function resolveABCD(p) {
  if (p.usePreset !== false) return { ...PRESET_DEFAULTS[p.preset] };
  return { a: +p.a, b: +p.b, c: +p.c, d: +p.d };
}

function normalize(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of pts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale  = 2 * 0.95 / Math.max(rangeX, rangeY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return pts.map(pt => ({
    nx: (pt.x - cx) * scale,
    ny: (pt.y - cy) * scale,
  }));
}

function chunkPath(ndcPts, steps) {
  if (steps <= 50000) return [ndcPts];
  const CHUNK = 2000;
  const paths = [];
  for (let i = 0; i < ndcPts.length; i += CHUNK) {
    paths.push(ndcPts.slice(i, i + CHUNK));
  }
  return paths;
}

function cliffordPoints(a, b, c, d, steps) {
  const pts = [];
  let x = 0, y = 0;
  const transient = 1000;
  for (let i = 0; i < steps + transient; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    const ny = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx; y = ny;
    if (i >= transient && isFinite(x) && isFinite(y)) {
      pts.push({ x, y });
    }
  }
  return pts;
}

function dejongPoints(a, b, c, d, steps) {
  const pts = [];
  let x = 0, y = 0;
  const transient = 1000;
  for (let i = 0; i < steps + transient; i++) {
    const nx = Math.sin(a * y) - Math.cos(b * x);
    const ny = Math.sin(c * x) - Math.cos(d * y);
    x = nx; y = ny;
    if (i >= transient && isFinite(x) && isFinite(y)) {
      pts.push({ x, y });
    }
  }
  return pts;
}

// Shared RK4 integrator for 3D ODE attractors.
// deriv(x,y,z) → [dx,dy,dz]; proj(x,y,z) → {x,y} for the 2D projection.
function integrateRK4(dt, steps, transient, x0, y0, z0, deriv, proj) {
  const pts = [];
  let x = x0, y = y0, z = z0;
  for (let i = 0; i < steps + transient; i++) {
    const [k1x, k1y, k1z] = deriv(x, y, z);
    const [k2x, k2y, k2z] = deriv(x + k1x*dt/2, y + k1y*dt/2, z + k1z*dt/2);
    const [k3x, k3y, k3z] = deriv(x + k2x*dt/2, y + k2y*dt/2, z + k2z*dt/2);
    const [k4x, k4y, k4z] = deriv(x + k3x*dt, y + k3y*dt, z + k3z*dt);
    x += dt * (k1x + 2*k2x + 2*k3x + k4x) / 6;
    y += dt * (k1y + 2*k2y + 2*k3y + k4y) / 6;
    z += dt * (k1z + 2*k2z + 2*k3z + k4z) / 6;
    if (i >= transient) {
      const pt = proj(x, y, z);
      if (isFinite(pt.x) && isFinite(pt.y)) pts.push(pt);
    }
  }
  return pts;
}

function lorenzPoints(a, b, c, steps) {
  // dx = a(y-x), dy = x(b-z)-y, dz = xy-cz  — project xz plane
  return integrateRK4(0.005, steps, 1000, 0.1, 0, 0,
    (x, y, z) => [a*(y-x), x*(b-z)-y, x*y-c*z],
    (x, _y, z) => ({ x, y: z }));
}

function rosslerPoints(a, b, c, steps) {
  // dx=-y-z, dy=x+ay, dz=b+z(x-c)  — project xy
  return integrateRK4(0.05, steps, 1000, 0.1, 0, 0,
    (x, y, z) => [-y-z, x+a*y, b+z*(x-c)],
    (x, y, _z) => ({ x, y }));
}

function halvorsenPoints(a, steps) {
  // dx=-ax-4y-4z-y², dy=-ay-4z-4x-z², dz=-az-4x-4y-x²  — project xy
  return integrateRK4(0.005, steps, 1000, 0.1, 0, 0,
    (x, y, z) => [-a*x-4*y-4*z-y*y, -a*y-4*z-4*x-z*z, -a*z-4*x-4*y-x*x],
    (x, y, _z) => ({ x, y }));
}

export function generate(p) {
  const { a, b, c, d } = resolveABCD(p);
  const steps = p.steps;
  let raw;

  switch (p.preset) {
    case 'clifford':  raw = cliffordPoints(a, b, c, d, steps); break;
    case 'dejong':    raw = dejongPoints(a, b, c, d, steps);   break;
    case 'lorenz':    raw = lorenzPoints(a, b, c, steps);      break;
    case 'rossler':   raw = rosslerPoints(a, b, c, steps);     break;
    case 'halvorsen': raw = halvorsenPoints(a, steps);         break;
    default:          raw = cliffordPoints(a, b, c, d, steps);
  }

  if (raw.length === 0) return [[]];

  const ndcPts = normalize(raw);
  return chunkPath(ndcPts, steps);
}
