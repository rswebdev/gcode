/**
 * genart/noiseContours.js
 * Topographic contour lines drawn from a fractal Brownian motion noise field.
 *
 * Evaluates a 2D seeded Perlin fBm field on a regular grid, then uses
 * marching squares to extract iso-contours at evenly-spaced height levels.
 * The result resembles natural terrain maps, wood grain, or flowing fabric.
 */

import { marchingSquares } from './_marchingSquares.js';

export const id    = 'noisecontours';
export const label = 'Noise Contours';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'seed',        label: 'Seed',        type: 'number', min: 0, max: 99999, default: 42     },
  { id: 'scale',       label: 'Scale',        type: 'range',  min: 0.5, max: 5,   step: 0.25, default: 2    },
  { id: 'octaves',     label: 'Octaves',      type: 'range',  min: 1,   max: 6,   step: 1,    default: 4    },
  { id: 'persistence', label: 'Persistence',  type: 'range',  min: 0.2, max: 0.8, step: 0.05, default: 0.5  },
  { id: 'numContours', label: 'Contours',     type: 'range',  min: 2,   max: 24,  step: 1,    default: 10   },
  { id: 'resolution',  label: 'Resolution',   type: 'range',  min: 80,  max: 240, step: 20,   default: 150  },
];

// ---------------------------------------------------------------------------
// Seeded Perlin noise
// ---------------------------------------------------------------------------

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function _makePerlin(seed) {
  const rng = _makePrng(seed);
  const p   = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function grad(h, x, y) {
    const u = (h & 1) ? -x : x;
    const v = (h & 2) ? -y : y;
    return u + v;
  }

  return function noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const A  = perm[X] + Y;
    const B  = perm[X + 1] + Y;
    return lerp(
      lerp(grad(perm[A],     xf,     yf    ), grad(perm[B],     xf - 1, yf    ), u),
      lerp(grad(perm[A + 1], xf,     yf - 1), grad(perm[B + 1], xf - 1, yf - 1), u),
      v,
    );
  };
}

function _fbm(noise, x, y, octaves, persistence) {
  let value = 0, amp = 1, freq = 1, max = 0;
  for (let o = 0; o < octaves; o++) {
    value += noise(x * freq, y * freq) * amp;
    max   += amp;
    amp   *= persistence;
    freq  *= 2;
  }
  return value / max;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const seed        = p.seed | 0;
  const scale       = +p.scale       || 2;
  const octaves     = Math.max(1, p.octaves | 0);
  const persistence = +p.persistence || 0.5;
  const numContours = Math.max(1, p.numContours | 0);
  const N           = Math.max(20, p.resolution | 0);

  const noise = _makePerlin(seed);

  // Evaluate fBm field over [-1,+1]²
  const field = new Float32Array(N * N);
  let minV = Infinity, maxV = -Infinity;
  for (let y = 0; y < N; y++) {
    const wy = (y / (N - 1)) * 2 - 1;
    for (let x = 0; x < N; x++) {
      const wx = (x / (N - 1)) * 2 - 1;
      const v  = _fbm(noise, wx * scale, wy * scale, octaves, persistence);
      field[y * N + x] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }

  // Extract evenly-spaced iso-contours — leave a small margin at each end
  // so the outermost and innermost contours are never at the absolute extremes
  const range  = maxV - minV;
  const margin = range / (numContours + 1);
  const paths  = [];

  for (let c = 1; c <= numContours; c++) {
    const thr   = minV + c * margin;
    const segs  = marchingSquares(field, N, thr);
    for (const path of segs) paths.push(path);
  }

  return paths;
}
