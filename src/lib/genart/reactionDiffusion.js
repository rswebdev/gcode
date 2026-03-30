/**
 * genart/reactionDiffusion.js
 * Gray–Scott reaction-diffusion model.
 *
 * Two chemicals A and B react on a 2D grid:
 *   dA/dt = Da·∇²A  −  A·B²  +  F·(1−A)
 *   dB/dt = Db·∇²B  +  A·B²  −  (F+k)·B
 *
 * Different feed/kill (F/k) parameters produce qualitatively distinct
 * pattern families. Iso-contours of chemical B are extracted with marching
 * squares and returned as NDC paths for plotting.
 *
 * Seeding: all presets scatter random seeds across the full grid so the
 * pattern develops everywhere, not just from a central cluster.
 */

import { marchingSquares } from './_marchingSquares.js';

export const id    = 'reactiondiff';
export const label = 'Reaction-Diffusion';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'maze',
    options: [
      { value: 'spots',        label: 'Spots'        },
      { value: 'maze',         label: 'Maze'         },
      { value: 'fingerprints', label: 'Fingerprints' },
      { value: 'coral',        label: 'Coral'        },
    ],
  },
  { id: 'iterations', label: 'Iterations', type: 'range',  min: 500,  max: 5000, step: 250, default: 2500 },
  { id: 'gridSize',   label: 'Grid Size',  type: 'range',  min: 40,   max: 120,  step: 10,  default: 80   },
  { id: 'threshold',  label: 'Threshold',  type: 'range',  min: 0.05, max: 0.45, step: 0.01, default: 0.2 },
  { id: 'seed',       label: 'Seed',       type: 'number', min: 0, max: 99999, default: 42 },
];

// ---------------------------------------------------------------------------
// Gray-Scott parameter presets (Da=1.0, Db=0.5 normalisation)
// ---------------------------------------------------------------------------

const PRESETS = {
  spots:        { F: 0.035, k: 0.065 }, // mitosis — expanding circles
  maze:         { F: 0.029, k: 0.057 }, // labyrinths — dense interlocking channels
  fingerprints: { F: 0.037, k: 0.060 }, // fingerprint-like curved stripes
  coral:        { F: 0.062, k: 0.0609 }, // coral / branching dendrites
};

const Da = 1.0, Db = 0.5, dt = 1.0;

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function _simulate(N, iters, preset, seed) {
  const { F, k } = preset;
  const rng       = _makePrng(seed);

  const A    = new Float32Array(N * N).fill(1);
  const B    = new Float32Array(N * N);
  const newA = new Float32Array(N * N);
  const newB = new Float32Array(N * N);

  // Scatter random 3×3 seeds of B across the entire field (~1.5% of cells)
  const numSeeds = Math.max(6, Math.round(N * N * 0.015));
  for (let s = 0; s < numSeeds; s++) {
    const cx = 1 + Math.floor(rng() * (N - 2));
    const cy = 1 + Math.floor(rng() * (N - 2));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const idx = (cy + dy) * N + (cx + dx);
        A[idx] = 0.5;
        B[idx] = 0.25;
      }
    }
  }

  for (let iter = 0; iter < iters; iter++) {
    for (let y = 0; y < N; y++) {
      const yn = (y - 1 + N) % N;
      const yp = (y + 1) % N;
      for (let x = 0; x < N; x++) {
        const xn = (x - 1 + N) % N;
        const xp = (x + 1) % N;
        const i  = y * N + x;

        const a = A[i], b = B[i];
        const lapA = A[yn*N+x] + A[yp*N+x] + A[y*N+xn] + A[y*N+xp] - 4*a;
        const lapB = B[yn*N+x] + B[yp*N+x] + B[y*N+xn] + B[y*N+xp] - 4*b;
        const react = a * b * b;

        newA[i] = Math.max(0, Math.min(1, a + dt * (Da*lapA - react + F*(1-a))));
        newB[i] = Math.max(0, Math.min(1, b + dt * (Db*lapB + react - (F+k)*b)));
      }
    }
    A.set(newA);
    B.set(newB);
  }

  return B;
}

// ---------------------------------------------------------------------------
// Public generate function
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const preset    = PRESETS[p.preset] || PRESETS.maze;
  const iters     = Math.max(100, p.iterations | 0);
  const N         = Math.max(20, Math.min(120, p.gridSize | 0));
  const threshold = +p.threshold || 0.2;
  const seed      = p.seed | 0;

  const field = _simulate(N, iters, preset, seed);
  return marchingSquares(field, N, threshold);
}
