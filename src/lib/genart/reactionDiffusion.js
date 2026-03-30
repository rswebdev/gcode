/**
 * genart/reactionDiffusion.js
 * Gray–Scott reaction-diffusion model.
 * Simulates two chemicals (A and B) on a grid; different F/k parameters produce
 * qualitatively distinct patterns. Isoline contours of chemical B are extracted
 * with marching squares and returned as NDC paths for plotting.
 *
 * dA/dt = Da * ∇²A  -  A*B²  +  F*(1-A)
 * dB/dt = Db * ∇²B  +  A*B²  -  (F+k)*B
 */

export const id    = 'reactiondiff';
export const label = 'Reaction-Diffusion';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'spots',
    options: [
      { value: 'spots',   label: 'Spots'   },
      { value: 'stripes', label: 'Stripes' },
      { value: 'maze',    label: 'Maze'    },
      { value: 'coral',   label: 'Coral'   },
    ],
  },
  { id: 'iterations', label: 'Iterations', type: 'range', min: 500, max: 6000, step: 100, default: 2000 },
  { id: 'gridSize',   label: 'Grid Size',  type: 'range', min: 40,  max: 150,  step: 5,   default: 80   },
  { id: 'threshold',  label: 'Threshold',  type: 'range', min: 0.05, max: 0.5, step: 0.01, default: 0.2 },
];

// ---------------------------------------------------------------------------
// Preset parameters (F = feed rate, k = kill rate)
// ---------------------------------------------------------------------------

const PRESETS = {
  spots:   { Da: 1.0, Db: 0.5, F: 0.035, k: 0.065 },
  stripes: { Da: 1.0, Db: 0.5, F: 0.040, k: 0.060 },
  maze:    { Da: 1.0, Db: 0.5, F: 0.029, k: 0.057 },
  coral:   { Da: 1.0, Db: 0.5, F: 0.025, k: 0.060 },
};

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function _simulate(gridSize, iters, preset) {
  const N  = gridSize;
  const dt = 1.0;
  const { Da, Db, F, k } = preset;

  // A and B concentration fields, flat [N*N]
  const A = new Float32Array(N * N).fill(1);
  const B = new Float32Array(N * N);

  // Seed several random-ish spots of B in the centre region
  const seeds = [
    [0.45, 0.45], [0.55, 0.55], [0.45, 0.55], [0.55, 0.45],
    [0.5,  0.3 ], [0.5,  0.7 ],
  ];
  for (const [fx, fy] of seeds) {
    const cx = Math.round(fx * N);
    const cy = Math.round(fy * N);
    const r  = Math.max(2, Math.round(N * 0.04));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const idx = ((cy + dy + N) % N) * N + ((cx + dx + N) % N);
          A[idx] = 0.5;
          B[idx] = 0.25;
        }
      }
    }
  }

  const newA = new Float32Array(N * N);
  const newB = new Float32Array(N * N);

  for (let iter = 0; iter < iters; iter++) {
    for (let y = 0; y < N; y++) {
      const yn = (y - 1 + N) % N;
      const yp = (y + 1) % N;
      for (let x = 0; x < N; x++) {
        const xn = (x - 1 + N) % N;
        const xp = (x + 1)     % N;
        const i  = y  * N + x;

        const a = A[i], b = B[i];
        const lap_a = A[yn*N+x] + A[yp*N+x] + A[y*N+xn] + A[y*N+xp] - 4 * a;
        const lap_b = B[yn*N+x] + B[yp*N+x] + B[y*N+xn] + B[y*N+xp] - 4 * b;

        const react = a * b * b;
        newA[i] = Math.max(0, Math.min(1, a + dt * (Da * lap_a - react + F * (1 - a))));
        newB[i] = Math.max(0, Math.min(1, b + dt * (Db * lap_b + react - (F + k) * b)));
      }
    }
    A.set(newA);
    B.set(newB);
  }

  return B;
}

// ---------------------------------------------------------------------------
// Marching squares — extract isoline at `threshold` from a scalar field
// ---------------------------------------------------------------------------

// Edge table: for each of the 16 cases, which pairs of edges (0=bottom,1=right,2=top,3=left) are crossed
const EDGE_PAIRS = [
  [],           // 0000
  [[3, 0]],     // 0001
  [[0, 1]],     // 0010
  [[3, 1]],     // 0011
  [[1, 2]],     // 0100
  [[3, 0],[1,2]], // 0101 (saddle — take first)
  [[0, 2]],     // 0110
  [[3, 2]],     // 0111
  [[2, 3]],     // 1000
  [[2, 0]],     // 1001
  [[0, 1],[2,3]], // 1010 (saddle)
  [[2, 1]],     // 1011
  [[1, 3]],     // 1100
  [[1, 0]],     // 1101
  [[0, 3]],     // 1110
  [],           // 1111
];

function _marchingSquares(field, N, thr) {
  const segments = []; // each segment: [{nx,ny},{nx,ny}]

  function interp(a, b, va, vb) {
    if (Math.abs(vb - va) < 1e-10) return 0.5;
    return (thr - va) / (vb - va);
  }

  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      // Four corners: bottom-left, bottom-right, top-right, top-left
      // In NDC: x maps to [-1,+1], y maps to [+1,-1] (flip Y so top is positive)
      const v0 = field[ y      * N + x    ]; // bottom-left  (x,  y  )
      const v1 = field[ y      * N + x + 1]; // bottom-right (x+1,y  )
      const v2 = field[(y + 1) * N + x + 1]; // top-right    (x+1,y+1)
      const v3 = field[(y + 1) * N + x    ]; // top-left     (x,  y+1)

      const idx = ((v3 > thr) ? 8 : 0)
                | ((v2 > thr) ? 4 : 0)
                | ((v1 > thr) ? 2 : 0)
                | ((v0 > thr) ? 1 : 0);

      if (idx === 0 || idx === 15) continue;

      // Convert grid coords to NDC
      function toNDC(gx, gy) {
        return {
          nx: (gx / (N - 1)) * 2 - 1,
          ny: (gy / (N - 1)) * 2 - 1,
        };
      }

      // Interpolated edge midpoints
      // Edge 0: bottom  (y,   x → x+1)
      // Edge 1: right   (x+1, y → y+1)
      // Edge 2: top     (y+1, x+1 → x)
      // Edge 3: left    (x,   y+1 → y)
      function edgePt(e) {
        switch (e) {
          case 0: { const t = interp(x, x+1, v0, v1); return toNDC(x + t, y);     }
          case 1: { const t = interp(y, y+1, v1, v2); return toNDC(x + 1, y + t); }
          case 2: { const t = interp(x+1, x, v2, v3); return toNDC(x+1-t, y + 1);}
          case 3: { const t = interp(y+1, y, v3, v0); return toNDC(x,     y+1-t);}
          default: return toNDC(x, y);
        }
      }

      for (const [e0, e1] of EDGE_PAIRS[idx]) {
        segments.push([edgePt(e0), edgePt(e1)]);
      }
    }
  }

  // Stitch segments into polylines
  return _stitchSegments(segments);
}

/** Join segment endpoints that are very close together into polylines. */
function _stitchSegments(segments) {
  if (segments.length === 0) return [];

  const EPS = 2e-3;
  const used = new Uint8Array(segments.length);
  const paths = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    let path = [...segments[start]];

    // Try to extend forward from path's last point
    let extended = true;
    while (extended) {
      extended = false;
      const tail = path[path.length - 1];
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const [s, e] = segments[j];
        const d0 = (s.nx-tail.nx)**2 + (s.ny-tail.ny)**2;
        const d1 = (e.nx-tail.nx)**2 + (e.ny-tail.ny)**2;
        if (d0 < EPS * EPS) {
          path.push(e);
          used[j] = 1;
          extended = true;
          break;
        }
        if (d1 < EPS * EPS) {
          path.push(s);
          used[j] = 1;
          extended = true;
          break;
        }
      }
    }

    if (path.length >= 2) paths.push(path);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Public generate function
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const preset    = PRESETS[p.preset] || PRESETS.spots;
  const iters     = Math.max(100, p.iterations | 0);
  const gridSize  = Math.max(20, Math.min(150, p.gridSize | 0));
  const threshold = +p.threshold || 0.2;

  const field = _simulate(gridSize, iters, preset);
  return _marchingSquares(field, gridSize, threshold);
}
