/**
 * genart/diffGrowth.js
 * Differential growth — a closed curve that grows by injecting new points
 * between far-apart neighbours, while cohesion forces keep it smooth and
 * separation forces push nearby points apart.
 *
 * The result mirrors organic forms found in coral, intestines, crumpled paper,
 * and folded leaves.
 *
 * Forces applied each step:
 *   Cohesion    — each point is attracted toward the midpoint of its two neighbours
 *   Separation  — each point is repelled by nearby points within radius R
 *   Boundary    — soft wall at ±0.93 keeps the curve on canvas
 *
 * A spatial hash grid makes separation O(n) instead of O(n²).
 */

export const id    = 'diffgrowth';
export const label = 'Differential Growth';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'initPts',  label: 'Init Points', type: 'range',  min: 8,   max: 60, step: 2,    default: 20   },
  { id: 'steps',    label: 'Steps',        type: 'range',  min: 50,  max: 500, step: 10,   default: 220  },
  { id: 'maxSeg',   label: 'Split At',     type: 'range',  min: 0.02, max: 0.12, step: 0.005, default: 0.055 },
  { id: 'repulse',  label: 'Repulse R',    type: 'range',  min: 0.02, max: 0.12, step: 0.005, default: 0.055 },
  { id: 'cohesion', label: 'Cohesion',     type: 'range',  min: 0.1,  max: 1.0,  step: 0.05,  default: 0.45  },
  { id: 'seed',     label: 'Seed',          type: 'number', min: 0,   max: 99999, default: 17  },
];

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// ---------------------------------------------------------------------------
// Spatial hash grid for O(n) neighbour queries
// ---------------------------------------------------------------------------

function _buildGrid(xs, ys, cellSize) {
  const inv  = 1 / cellSize;
  const map  = new Map();
  const N    = xs.length;

  for (let i = 0; i < N; i++) {
    const gx = Math.floor(xs[i] * inv);
    const gy = Math.floor(ys[i] * inv);
    const k  = `${gx},${gy}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }

  function nearby(x, y) {
    const gx  = Math.floor(x * inv);
    const gy  = Math.floor(y * inv);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = map.get(`${gx + dx},${gy + dy}`);
        if (cell) for (const idx of cell) out.push(idx);
      }
    }
    return out;
  }

  return { nearby };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const MAX_PTS = 3000; // safety cap so the algorithm stays fast

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const initN   = Math.max(4, p.initPts | 0);
  const steps   = Math.max(1, p.steps | 0);
  const maxSeg  = +p.maxSeg   || 0.055;
  const repulse = +p.repulse  || 0.055;
  const coh     = +p.cohesion || 0.45;
  const rng     = _makePrng(p.seed | 0);

  const repulse2 = repulse * repulse;
  const dt       = 0.5;
  const BORDER   = 0.93;

  // ---------- Initialise circle ----------
  // Slightly perturb to avoid perfect symmetry (which inhibits interesting growth)
  let xs = new Float64Array(initN);
  let ys = new Float64Array(initN);
  const r0 = 0.28;
  for (let i = 0; i < initN; i++) {
    const theta = (i / initN) * 2 * Math.PI;
    xs[i] = Math.cos(theta) * r0 + (rng() - 0.5) * 0.04;
    ys[i] = Math.sin(theta) * r0 + (rng() - 0.5) * 0.04;
  }

  // ---------- Grow ----------
  for (let step = 0; step < steps; step++) {
    const N = xs.length;
    const grid = _buildGrid(xs, ys, repulse);

    const fx = new Float64Array(N);
    const fy = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const prev = (i - 1 + N) % N;
      const next = (i + 1) % N;

      // Cohesion: pull toward midpoint of neighbours
      const midX = (xs[prev] + xs[next]) * 0.5;
      const midY = (ys[prev] + ys[next]) * 0.5;
      fx[i] += (midX - xs[i]) * coh;
      fy[i] += (midY - ys[i]) * coh;

      // Separation: push away from nearby points
      for (const j of grid.nearby(xs[i], ys[i])) {
        if (j === i) continue;
        const dx = xs[i] - xs[j];
        const dy = ys[i] - ys[j];
        const d2 = dx * dx + dy * dy;
        if (d2 < repulse2 && d2 > 1e-12) {
          const d    = Math.sqrt(d2);
          const mag  = (1 - d / repulse) * 0.6;
          fx[i] += (dx / d) * mag;
          fy[i] += (dy / d) * mag;
        }
      }

      // Soft boundary
      const bx = xs[i];
      const by_ = ys[i];
      if (bx >  BORDER) fx[i] -= (bx -  BORDER) * 2;
      if (bx < -BORDER) fx[i] -= (bx + BORDER) * 2;
      if (by_ >  BORDER) fy[i] -= (by_ -  BORDER) * 2;
      if (by_ < -BORDER) fy[i] -= (by_ + BORDER) * 2;
    }

    // Apply forces
    for (let i = 0; i < N; i++) {
      xs[i] += fx[i] * dt;
      ys[i] += fy[i] * dt;
    }

    // Injection: split long segments (process in reverse to keep indices valid)
    if (N < MAX_PTS) {
      const newXs = [xs[0]];
      const newYs = [ys[0]];
      for (let i = 1; i < N; i++) {
        const dx = xs[i] - xs[i - 1];
        const dy = ys[i] - ys[i - 1];
        if (Math.sqrt(dx * dx + dy * dy) > maxSeg && newXs.length < MAX_PTS) {
          newXs.push((xs[i - 1] + xs[i]) * 0.5);
          newYs.push((ys[i - 1] + ys[i]) * 0.5);
        }
        newXs.push(xs[i]);
        newYs.push(ys[i]);
      }
      // Close: check the wrap-around segment
      const dx0 = xs[0] - xs[N - 1];
      const dy0 = ys[0] - ys[N - 1];
      if (Math.sqrt(dx0 * dx0 + dy0 * dy0) > maxSeg && newXs.length < MAX_PTS) {
        newXs.push((xs[N - 1] + xs[0]) * 0.5);
        newYs.push((ys[N - 1] + ys[0]) * 0.5);
      }
      xs = new Float64Array(newXs);
      ys = new Float64Array(newYs);
    }
  }

  // ---------- Output: single closed path ----------
  const N = xs.length;
  const path = [];
  for (let i = 0; i < N; i++) path.push({ nx: xs[i], ny: ys[i] });
  path.push({ nx: xs[0], ny: ys[0] }); // close
  return [path];
}
