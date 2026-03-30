/**
 * genart/flowField.js
 * Perlin-noise-driven flow field. Particles follow angle vectors derived from
 * a 2D gradient noise field, producing organic streamline artwork.
 */

export const id    = 'flowfield';
export const label = 'Flow Field';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'seed',      label: 'Seed',       type: 'number', min: 0, max: 99999, step: 1, default: 42   },
  { id: 'particles', label: 'Particles',  type: 'range',  min: 20, max: 600, step: 10, default: 200  },
  { id: 'steps',     label: 'Steps',      type: 'range',  min: 20, max: 300, step: 10, default: 100  },
  { id: 'stepLen',   label: 'Step Len',   type: 'range',  min: 0.002, max: 0.025, step: 0.001, default: 0.008 },
  { id: 'scale',     label: 'Field Scale',type: 'range',  min: 0.3, max: 4.0, step: 0.1, default: 1.4 },
  { id: 'angleMult', label: 'Twist',      type: 'range',  min: 1, max: 10, step: 0.5, default: 3.0   },
];

// ---------------------------------------------------------------------------
// Minimal seeded Perlin noise (gradient noise, 2D)
// ---------------------------------------------------------------------------

function _buildPerm(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0;
  function rng() {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  }
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function _lerp(a, b, t) { return a + t * (b - a); }

function _grad(h, x, y) {
  // 4 gradient directions
  switch (h & 3) {
    case 0:  return  x + y;
    case 1:  return -x + y;
    case 2:  return  x - y;
    default: return -x - y;
  }
}

function _noise2(x, y, perm) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u  = _fade(xf), v = _fade(yf);
  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];
  return _lerp(
    _lerp(_grad(aa, xf,     yf    ), _grad(ba, xf - 1, yf    ), u),
    _lerp(_grad(ab, xf,     yf - 1), _grad(bb, xf - 1, yf - 1), u),
    v,
  );
}

// ---------------------------------------------------------------------------
// Seeded RNG (xorshift32)
// ---------------------------------------------------------------------------

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const seed      = p.seed | 0;
  const nParticles = Math.max(1, p.particles | 0);
  const nSteps    = Math.max(1, p.steps | 0);
  const stepLen   = +p.stepLen || 0.008;
  const scale     = +p.scale  || 1.4;
  const twist     = +p.angleMult || 3.0;

  const perm = _buildPerm(seed);
  const rng  = _makePrng(seed + 1);

  const paths = [];

  for (let i = 0; i < nParticles; i++) {
    // Start anywhere in the [-1, +1] viewport
    let x = rng() * 2 - 1;
    let y = rng() * 2 - 1;

    const path = [{ nx: x, ny: y }];

    for (let s = 0; s < nSteps; s++) {
      const angle = _noise2(x * scale, y * scale, perm) * Math.PI * twist;
      x += Math.cos(angle) * stepLen;
      y += Math.sin(angle) * stepLen;

      if (x < -1.02 || x > 1.02 || y < -1.02 || y > 1.02) break;
      path.push({ nx: x, ny: y });
    }

    if (path.length >= 2) paths.push(path);
  }

  return paths;
}
