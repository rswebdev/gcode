/**
 * genart/cyclicCA.js
 * Cyclic Cellular Automaton (Greenberg-Hastings / BZ-reaction model).
 *
 * Rule: a cell in state s advances to state (s+1) % nStates if at least
 * `threshold` of its 8 neighbours are already in state (s+1) % nStates.
 *
 * Starting from a random field, rotating spiral waves emerge and fill the
 * entire grid. The state field is then sampled with marching squares at
 * each state-boundary level to produce the iso-contour paths.
 *
 * References: Dewdney (1988), Fisch, Gravner & Griffeath (1991).
 */

import { marchingSquares } from './_marchingSquares.js';

export const id    = 'cyclicca';
export const label = 'Cyclic CA';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'nStates',    label: 'States',      type: 'range',  min: 3,  max: 20, step: 1, default: 10 },
  { id: 'threshold',  label: 'Threshold',   type: 'range',  min: 1,  max: 3,  step: 1, default: 1  },
  { id: 'gridSize',   label: 'Grid Size',   type: 'range',  min: 60, max: 220, step: 10, default: 140 },
  { id: 'iterations', label: 'Iterations',  type: 'range',  min: 40, max: 500, step: 10, default: 180 },
  { id: 'seed',       label: 'Seed',        type: 'number', min: 0, max: 99999, default: 7 },
];

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const nStates  = Math.max(2, p.nStates   | 0);
  const thr      = Math.max(1, p.threshold | 0);
  const N        = Math.max(10, p.gridSize   | 0);
  const iters    = Math.max(1,  p.iterations | 0);
  const rng      = _makePrng(p.seed | 0);

  // Initialise with random states
  let grid    = new Uint8Array(N * N);
  let next    = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) grid[i] = Math.floor(rng() * nStates);

  // Simulate
  for (let iter = 0; iter < iters; iter++) {
    for (let y = 0; y < N; y++) {
      const yn = (y - 1 + N) % N;
      const yp = (y + 1) % N;
      for (let x = 0; x < N; x++) {
        const xn  = (x - 1 + N) % N;
        const xp  = (x + 1) % N;
        const s   = grid[y * N + x];
        const s1  = (s + 1) % nStates;
        // Count neighbours in state s+1
        let cnt = 0;
        if (grid[yn * N + xn] === s1) cnt++;
        if (grid[yn * N + x ] === s1) cnt++;
        if (grid[yn * N + xp] === s1) cnt++;
        if (grid[y  * N + xn] === s1) cnt++;
        if (grid[y  * N + xp] === s1) cnt++;
        if (grid[yp * N + xn] === s1) cnt++;
        if (grid[yp * N + x ] === s1) cnt++;
        if (grid[yp * N + xp] === s1) cnt++;
        next[y * N + x] = cnt >= thr ? s1 : s;
      }
    }
    const tmp = grid; grid = next; next = tmp;
  }

  // Extract one iso-contour per state transition k → (k+1) % nStates.
  // Build a binary field for each transition so only that boundary produces
  // a 0.5 contour; avoids the wrap boundary being counted by every threshold.
  const paths = [];
  const transitionField = new Float32Array(N * N);
  for (let k = 0; k < nStates; k++) {
    const kNext = (k + 1) % nStates;
    for (let i = 0; i < N * N; i++) {
      const s = grid[i];
      transitionField[i] = s === kNext ? 0 : 1; // 0 only on the kNext side
    }
    const segs = marchingSquares(transitionField, N, 0.5);
    for (const path of segs) paths.push(path);
  }
  return paths;
}
