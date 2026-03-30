/**
 * genart/attractors.js
 * Strange attractors — iterative 2D dynamical systems that trace dense,
 * organic curves.
 *
 * Clifford:  x' = sin(a·y) + c·cos(a·x)   y' = sin(b·x) + d·cos(b·y)
 * De Jong:   x' = sin(a·y) − cos(b·x)     y' = sin(c·x) − cos(d·y)
 */

export const id    = 'attractors';
export const label = 'Strange Attractors';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'type', label: 'Type', type: 'select', default: 'clifford',
    options: [
      { value: 'clifford', label: 'Clifford' },
      { value: 'dejong',   label: 'De Jong'  },
    ],
  },
  {
    id: 'preset', label: 'Preset', type: 'select', default: '1',
    options: [
      { value: '1', label: 'Preset 1' },
      { value: '2', label: 'Preset 2' },
      { value: '3', label: 'Preset 3' },
      { value: '4', label: 'Preset 4' },
      { value: '5', label: 'Preset 5' },
      { value: '6', label: 'Preset 6' },
    ],
  },
  { id: 'points', label: 'Points', type: 'range', min: 5000, max: 80000, step: 5000, default: 30000 },
];

// ---------------------------------------------------------------------------
// Preset parameter tables
// ---------------------------------------------------------------------------

const CLIFFORD = [
  { a: -1.4,  b:  1.6,  c:  1.0,  d:  0.7  }, // 1 — classic amoeba
  { a: -1.7,  b:  1.8,  c: -1.9,  d: -0.4  }, // 2 — tangled spirals
  { a:  1.5,  b: -1.8,  c:  1.6,  d: -0.6  }, // 3 — radial burst
  { a: -1.3,  b: -1.3,  c: -1.8,  d: -1.2  }, // 4 — dense web
  { a: -1.9,  b:  1.3,  c: -0.5,  d: -1.2  }, // 5 — flowing petals
  { a:  1.8,  b: -1.9,  c: -1.7,  d: -0.5  }, // 6 — asymmetric lace
];

const DEJONG = [
  { a: -2.0,  b: -2.0,  c: -1.2,  d:  2.0  }, // 1 — classic
  { a:  1.641,b:  1.902,c:  0.316,d:  1.525 }, // 2 — interlaced rings
  { a: -2.0,  b: -2.0,  c: -1.9,  d: -1.29 }, // 3 — butterfly
  { a:  1.4,  b: -2.3,  c:  2.4,  d: -2.1  }, // 4 — knotted net
  { a: -2.24, b:  0.43, c: -0.65, d: -2.43 }, // 5 — jellyfish
  { a:  2.01, b: -1.14, c: -0.53, d:  0.69 }, // 6 — unfolding rose
];

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const isClifford = p.type !== 'dejong';
  const table      = isClifford ? CLIFFORD : DEJONG;
  const idx        = Math.max(0, Math.min(table.length - 1, (p.preset | 0) - 1));
  const { a, b, c, d } = table[idx];
  const N = Math.max(100, p.points | 0);

  // Warm up: run 200 iterations before collecting to land on the attractor
  let x = 0.1, y = 0.1;
  for (let i = 0; i < 200; i++) {
    if (isClifford) {
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      const ny = Math.sin(b * x) + d * Math.cos(b * y);
      x = nx; y = ny;
    } else {
      const nx = Math.sin(a * y) - Math.cos(b * x);
      const ny = Math.sin(c * x) - Math.cos(d * y);
      x = nx; y = ny;
    }
  }

  // Collect trajectory
  const pts = new Float32Array(N * 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < N; i++) {
    if (isClifford) {
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      const ny = Math.sin(b * x) + d * Math.cos(b * y);
      x = nx; y = ny;
    } else {
      const nx = Math.sin(a * y) - Math.cos(b * x);
      const ny = Math.sin(c * x) - Math.cos(d * y);
      x = nx; y = ny;
    }
    pts[i * 2]     = x;
    pts[i * 2 + 1] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  // Normalize to NDC [-0.95, +0.95]
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 1.9 / Math.max(maxX - minX, maxY - minY, 0.001);

  // Split path into segments of ~2000 pts for canvas performance
  const SEG = 2000;
  const paths = [];
  for (let s = 0; s < N; s += SEG) {
    const end = Math.min(N, s + SEG + 1); // +1 overlap for continuity
    const path = [];
    for (let i = s; i < end; i++) {
      path.push({
        nx: (pts[i * 2]     - cx) * scale,
        ny: (pts[i * 2 + 1] - cy) * scale,
      });
    }
    if (path.length >= 2) paths.push(path);
  }
  return paths;
}
