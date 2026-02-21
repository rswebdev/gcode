/**
 * noise.js
 * Synthetic wave source — alternative to microphone audio.
 * Three generator types, all seeded for reproducibility:
 *
 *   perlin  — 2-D Perlin fBm; x = sample position, y = time (scrolling)
 *   sine    — sum of seed-derived sinusoids (great for lissajous / harmonograph)
 *   white   — seeded xorshift white noise
 *
 * All generators match the audio.js frame API:
 *   getFrame('time')      → Float32Array  [-1..1]  length = fftSize
 *   getFrame('frequency') → Float32Array  [ 0..1]  length = fftSize/2
 *   getFrame('stereo')    → { left: Float32Array, right: Float32Array }
 */

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------
let cfg = {
  seed:        42,
  noiseType:   'perlin',   // 'perlin' | 'sine' | 'white'
  speed:       0.005,      // time increment per frame
  frequency:   2.0,        // spatial frequency scale
  octaves:     4,          // fBm octaves (perlin / sine)
  persistence: 0.5,        // amplitude falloff per octave
  fftSize:     512,        // output buffer size
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let t           = 0;       // global time cursor (Perlin / Sine)
let perm        = null;    // Perlin permutation table (length 512)
let sineParams  = null;    // pre-computed sine harmonic params
let whiteState  = 1;       // xorshift32 running state

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * (Re-)configure the noise generator.
 * Pass any subset of config keys; seed change resets the time cursor.
 */
export function configure(newCfg) {
  const reseed = newCfg.seed !== undefined && newCfg.seed !== cfg.seed;
  cfg = { ...cfg, ...newCfg };
  if (reseed || perm === null) {
    _init(cfg.seed);
  }
}

/** Reset time cursor to 0 (replays the same sequence). */
export function reset() {
  t = 0;
  whiteState = _seedToState(cfg.seed);
}

/** Always true — no async init required. */
export function isReady() { return true; }

/**
 * Generate one frame of noise data.
 * @param {'time'|'frequency'|'stereo'} mode
 * @returns {Float32Array | { left: Float32Array, right: Float32Array }}
 */
export function getFrame(mode) {
  if (!perm) _init(cfg.seed);

  if (mode === 'stereo') {
    const left  = _generateMono(cfg.fftSize, 0);
    const right = _generateMono(cfg.fftSize, 100);   // offset z for independent channel
    _advance();
    return { left, right };
  }

  const raw = _generateMono(cfg.fftSize, 0);
  _advance();

  if (mode === 'frequency') {
    // Convert to pseudo-spectrum: fold into fftSize/2, abs, normalize
    const half = cfg.fftSize >> 1;
    const freq = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      // Average adjacent samples and take abs to simulate magnitude
      freq[i] = Math.abs((raw[i * 2] + raw[i * 2 + 1]) * 0.5);
    }
    // Gentle 1/f roll-off so low frequencies appear louder
    for (let i = 0; i < half; i++) {
      freq[i] *= 1 / (1 + i * 0.08);
    }
    // Normalize to [0, 1]
    let peak = 0;
    for (let i = 0; i < half; i++) if (freq[i] > peak) peak = freq[i];
    if (peak > 0) for (let i = 0; i < half; i++) freq[i] /= peak;
    return freq;
  }

  return raw;  // time mode: [-1, 1]
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

function _init(seed) {
  perm       = _buildPerm(seed);
  sineParams = _buildSineParams(seed);
  whiteState = _seedToState(seed);
  t          = 0;
}

/** Map an integer seed to a non-zero xorshift32 state. */
function _seedToState(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0;
  return s || 1;
}

function _advance() {
  t += cfg.speed;
}

// ---------------------------------------------------------------------------
// Per-sample generators
// ---------------------------------------------------------------------------

/**
 * Generate one time-domain frame of length N.
 * @param {number} N          output length
 * @param {number} zOffset    offset in the z (channel) dimension
 */
function _generateMono(N, zOffset) {
  const out = new Float32Array(N);
  switch (cfg.noiseType) {
    case 'perlin':
      for (let i = 0; i < N; i++) {
        out[i] = _fbm(cfg.frequency * i / N, t + zOffset * 0.01);
      }
      break;
    case 'sine':
      for (let i = 0; i < N; i++) {
        out[i] = _sineAt(i / N, t + zOffset * 0.1);
      }
      break;
    case 'white':
      for (let i = 0; i < N; i++) {
        whiteState = _xr32(whiteState);
        // Map uint32 to [-1, 1]
        out[i] = (whiteState / 0x80000000) - 1;
      }
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Perlin noise
// ---------------------------------------------------------------------------

/** Build a seeded permutation table (doubled) for Perlin noise. */
function _buildPerm(seed) {
  let s = _seedToState(seed);
  const P = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    s = _xr32(s);
    const j = s % (i + 1);
    const tmp = P[i]; P[i] = P[j]; P[j] = tmp;
  }
  return [...P, ...P];   // doubled for wrapping
}

function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function _lerp(t, a, b) { return a + t * (b - a); }

function _grad2(h, x, y) {
  const H = h & 3;
  const u = H < 2 ? x : y;
  const v = H < 2 ? y : x;
  return ((H & 1) ? -u : u) + ((H & 2) ? -v : v);
}

/** Single-octave 2-D Perlin noise at (x, y). Returns roughly [-1, 1]. */
function _perlin2D(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = _fade(x), v = _fade(y);
  const a  = perm[X]     + Y;
  const b  = perm[X + 1] + Y;
  return _lerp(v,
    _lerp(u, _grad2(perm[a],     x,     y),   _grad2(perm[b],     x - 1, y)),
    _lerp(u, _grad2(perm[a + 1], x,     y - 1), _grad2(perm[b + 1], x - 1, y - 1))
  );
}

/** Fractal Brownian Motion over Perlin. Returns approximately [-1, 1]. */
function _fbm(x, y) {
  let val = 0, amp = 1, freq = 1, totalAmp = 0;
  for (let o = 0; o < cfg.octaves; o++) {
    val      += _perlin2D(x * freq, y * freq) * amp;
    totalAmp += amp;
    amp      *= cfg.persistence;
    freq     *= 2.0;    // lacunarity fixed at 2
  }
  return val / totalAmp;
}

// ---------------------------------------------------------------------------
// Sine-sum noise
// ---------------------------------------------------------------------------

/** Build per-seed harmonic parameters (up to 8 harmonics). */
function _buildSineParams(seed) {
  let s = _seedToState(seed * 7 + 3);
  const harmonics = [];
  for (let k = 0; k < 8; k++) {
    s = _xr32(s);
    const freqRatio = 1 + (s % 8);           // integer harmonic 1–8
    s = _xr32(s);
    const phaseOffset = (s / 0xFFFFFFFF) * Math.PI * 2;
    harmonics.push({ freqRatio, phaseOffset });
  }
  return harmonics;
}

/**
 * Sine-sum value for sample position x ∈ [0,1] at time t.
 * Returns [-1, 1].
 */
function _sineAt(x, t) {
  const K = Math.min(cfg.octaves, sineParams.length);
  let val = 0, amp = 1, totalAmp = 0;
  for (let k = 0; k < K; k++) {
    const { freqRatio, phaseOffset } = sineParams[k];
    const spatialPhase = cfg.frequency * freqRatio * x * Math.PI * 2;
    const timePhase    = freqRatio * t * Math.PI * 2;
    val      += Math.sin(spatialPhase + timePhase + phaseOffset) * amp;
    totalAmp += amp;
    amp      *= cfg.persistence;
  }
  return val / totalAmp;
}

// ---------------------------------------------------------------------------
// White noise / PRNG
// ---------------------------------------------------------------------------

/** xorshift32 — fast, good quality, easy to seed. */
function _xr32(s) {
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return s >>> 0 || 1;   // keep non-zero
}
