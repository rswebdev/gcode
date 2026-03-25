/**
 * gcode.js
 * Converts accumulated audio frames to GRBL-compatible G-code for
 * AxiDraw pen plotter on A4 paper (210×297mm).
 * Supports four shapes: linear, circular, spiral, lissajous.
 */

// Paper & margin constants (mm)
const PAPER_W = 210;
const PAPER_H = 297;
const MARGIN  = 10;
const PLOT_W  = PAPER_W - 2 * MARGIN;   // 190 mm
const PLOT_H  = PAPER_H - 2 * MARGIN;   // 277 mm

// Polar plot constants
const CENTER_X = MARGIN + PLOT_W / 2;   // 105 mm
const CENTER_Y = MARGIN + PLOT_H / 2;   // 148.5 mm
const MAX_R    = Math.min(PLOT_W, PLOT_H) / 2;  // 95 mm
const INNER_R  = 5;                             // mm

const SPIRAL_TURNS = 3;

/**
 * Convert frame array to a GRBL G-code string.
 *
 * @param {Array} frames - Recorded frames (Float32Array or {left,right}).
 * @param {'time'|'frequency'|'stereo'} dataMode
 * @param {'linear'|'circular'|'spiral'|'lissajous'} shape
 * @param {{
 *   amplitudeScaleMm?: number,
 *   feedRate?: number,
 *   penDownFeedRate?: number,
 *   penUpZ?: number,
 *   penDownZ?: number
 * }} config
 * @returns {string}
 */
export function framesToGCode(frames, dataMode, shape, config = {}) {
  const feedRate    = config.feedRate         ?? 3000;
  const penDownFeed = config.penDownFeedRate  ?? 300;
  const penUpZ      = config.penUpZ           ?? 5;
  const penDownZ    = config.penDownZ         ?? 0;
  const ampScale    = config.amplitudeScaleMm ?? 8;
  const penMode     = config.penMode          ?? 'z';
  const penUpS      = config.penUpS           ?? 80;
  const penDownS    = config.penDownS         ?? 50;

  const opts = { feedRate, penDownFeed, penUpZ, penDownZ, ampScale, penMode, penUpS, penDownS };
  const lines = [];
  const ts = new Date().toISOString();

  lines.push(`; Audio Wave Visualizer - G-code Export`);
  lines.push(`; Data: ${dataMode} | Shape: ${shape} | Frames: ${frames.length}`);
  lines.push(`; Generated: ${ts}`);
  lines.push(`; Paper: A4 (${PAPER_W}x${PAPER_H}mm), ${MARGIN}mm margins`);
  lines.push(`; Plot area: ${PLOT_W} x ${PLOT_H} mm`);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  _penUp(lines, opts);
  lines.push(`G0 X${f(MARGIN)} Y${f(MARGIN)}`);
  lines.push('');

  switch (shape) {
    case 'circular':  _circularGCode(lines, frames, opts);   break;
    case 'spiral':    _spiralGCode(lines, frames, opts);     break;
    case 'lissajous': _lissajousGCode(lines, frames, opts);  break;
    default:
      dataMode === 'stereo'
        ? _stereoGCode(lines, frames, opts)
        : _monoGCode(lines, frames, opts);
  }

  _penUp(lines, opts);
  lines.push(`G0 X${f(0)} Y${f(0)}`);
  lines.push(`M2`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Linear shapes (existing)
// ---------------------------------------------------------------------------

function _monoGCode(lines, frames, opts) {
  const { feedRate, penDownFeed, penUpZ, penDownZ, ampScale } = opts;
  const F = frames.length;

  for (let fi = 0; fi < F; fi++) {
    const frame = frames[fi];
    const N = frame.length;
    const yBase       = MARGIN + (F > 1 ? (fi / (F - 1)) * PLOT_H : PLOT_H / 2);
    const rowAmpScale = _rowAmpScaleMm(F, ampScale);

    lines.push(`; --- Frame ${fi} (Y_base = ${f(yBase)} mm) ---`);
    lines.push(`G0 X${f(MARGIN)} Y${f(clampY(yBase))}`);
    _penDown(lines, opts);

    for (let i = 0; i < N; i++) {
      const px = MARGIN + (i / (N - 1)) * PLOT_W;
      const py = clampY(yBase + frame[i] * rowAmpScale);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    _penUp(lines, opts);
    lines.push('');
  }
}

function _stereoGCode(lines, frames, opts) {
  const { feedRate, penDownFeed, penUpZ, penDownZ, ampScale } = opts;
  const F = frames.length;
  const bandH = (PLOT_H - 10) / 2;
  const bands = [
    { ch: 'left',  start: MARGIN },
    { ch: 'right', start: MARGIN + bandH + 10 },
  ];
  const rowAmpScale = _rowAmpScaleMm(F, ampScale);

  for (const { ch, start } of bands) {
    lines.push(`; === Channel ${ch} ===`);
    for (let fi = 0; fi < F; fi++) {
      const frame = frames[fi];
      const data  = frame[ch] ?? frame;
      const N     = data.length;
      const yBase = start + (F > 1 ? (fi / (F - 1)) * bandH : bandH / 2);

      lines.push(`; --- ${ch} Frame ${fi} (Y_base = ${f(yBase)} mm) ---`);
      lines.push(`G0 X${f(MARGIN)} Y${f(clampY(yBase))}`);
      _penDown(lines, opts);

      for (let i = 0; i < N; i++) {
        const px = MARGIN + (i / (N - 1)) * PLOT_W;
        const py = clampY(yBase + data[i] * rowAmpScale);
        lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
      }

      _penUp(lines, opts);
      lines.push('');
    }
  }
}

// ---------------------------------------------------------------------------
// Circular shape
// ---------------------------------------------------------------------------

function _circularGCode(lines, frames, opts) {
  const { feedRate, penDownFeed, penUpZ, penDownZ, ampScale } = opts;
  const F = frames.length;
  const ringSpacing = (MAX_R - INNER_R) / Math.max(F, 1);   // mm per ring

  for (let fi = 0; fi < F; fi++) {
    const data       = _toMono(frames[fi]);
    const N          = data.length;
    const baseRadius = INNER_R + fi * ringSpacing;
    const ringAmpMm  = ringSpacing * 0.45 * ampScale;

    lines.push(`; --- Ring ${fi} (r_base = ${f(baseRadius)} mm) ---`);

    // Move to first point with pen up.
    const a0 = 0;
    const r0 = clampR(baseRadius + data[0] * ringAmpMm);
    lines.push(`G0 X${f(CENTER_X + r0 * Math.cos(a0))} Y${f(CENTER_Y + r0 * Math.sin(a0))}`);
    _penDown(lines, opts);

    // Draw N+1 points to close the ring.
    for (let i = 1; i <= N; i++) {
      const si    = i % N;
      const angle = (si / N) * Math.PI * 2;
      const r     = clampR(baseRadius + data[si] * ringAmpMm);
      const px    = CENTER_X + r * Math.cos(angle);
      const py    = CENTER_Y + r * Math.sin(angle);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    _penUp(lines, opts);
    lines.push('');
  }
}

// ---------------------------------------------------------------------------
// Spiral shape — one continuous pen stroke
// ---------------------------------------------------------------------------

function _spiralGCode(lines, frames, opts) {
  const { feedRate, penDownFeed, penUpZ, penDownZ, ampScale } = opts;
  const F = frames.length;
  if (F === 0) return;

  const N     = _toMono(frames[0]).length;
  const total = F * N;
  const ringSpacing = (MAX_R - INNER_R) / Math.max(F, 1);

  lines.push(`; --- Spiral (${F} frames × ${N} samples, ${SPIRAL_TURNS} turns) ---`);

  // Move to start with pen up.
  const startAngle = 0;
  const startR     = INNER_R;
  lines.push(`G0 X${f(CENTER_X + startR * Math.cos(startAngle))} Y${f(CENTER_Y + startR * Math.sin(startAngle))}`);
  _penDown(lines, opts);

  for (let gi = 0; gi < total; gi++) {
    const fi    = Math.floor(gi / N);
    const si    = gi % N;
    const t     = gi / (total - 1);
    const angle = t * SPIRAL_TURNS * Math.PI * 2;
    const data  = _toMono(frames[fi]);
    const r     = clampR(INNER_R + t * (MAX_R - INNER_R) + data[si] * ringSpacing * 0.45 * ampScale);
    const px    = CENTER_X + r * Math.cos(angle);
    const py    = CENTER_Y + r * Math.sin(angle);
    lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
  }

  _penUp(lines, opts);
  lines.push('');
}

// ---------------------------------------------------------------------------
// Lissajous shape
// ---------------------------------------------------------------------------

function _lissajousGCode(lines, frames, opts) {
  const { feedRate, penDownFeed, penUpZ, penDownZ, ampScale } = opts;
  const F = frames.length;

  // Scale: ±1 amplitude → ±halfPlot mm (use the smaller axis).
  const halfW = PLOT_W / 2;
  const halfH = PLOT_H / 2;
  const halfSize = Math.min(halfW, halfH) * 0.9;   // 90% of half-size, with breathing room
  const scale = halfSize * ampScale * 0.1;           // empirical: keep within bounds

  for (let fi = 0; fi < F; fi++) {
    const frame = frames[fi];
    let left, right;

    if (_isStereo(frame)) {
      left  = frame.left;
      right = frame.right;
    } else {
      left  = frame;
      const qShift = Math.floor(frame.length / 4);
      right = new Float32Array(frame.length);
      for (let i = 0; i < frame.length; i++) {
        right[i] = frame[(i + qShift) % frame.length];
      }
    }

    const N = left.length;
    lines.push(`; --- Lissajous frame ${fi} ---`);

    // Move to first point pen up.
    const x0 = clampX(CENTER_X + left[0] * halfSize);
    const y0 = clampY(CENTER_Y + right[0] * halfSize);
    lines.push(`G0 X${f(x0)} Y${f(y0)}`);
    _penDown(lines, opts);

    for (let i = 1; i < N; i++) {
      const px = clampX(CENTER_X + left[i] * halfSize);
      const py = clampY(CENTER_Y + right[i] * halfSize);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    _penUp(lines, opts);
    lines.push('');
  }
}

// ---------------------------------------------------------------------------
// Public utilities
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of the G-code string.
 * @param {string} content
 * @param {string} filename
 */
export function downloadGCode(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Filename generation — deterministic three-word name from params hash
// ---------------------------------------------------------------------------
const _WORDS = [
  'alpha','amber','arc','ash','aurora','axis','basin','beam','bloom','bore',
  'brine','brume','cairn','crest','curl','curve','delta','depth','dune','dust',
  'drift','echo','edge','ember','epoch','fault','field','flare','flux','foam',
  'fold','fringe','gap','ghost','grain','grove','haze','helix','helm','hollow',
  'hum','iris','keel','lace','layer','ledge','lens','lobe','loom','lune',
  'mast','mesa','mist','mode','moor','nave','node','notch','null','orbit',
  'oxbow','peak','phase','pitch','plume','polar','pond','prism','pulse',
  'quartz','radix','raft','range','reef','ridge','rime','rune','sand','scope',
  'shard','shear','shift','silt','slab','slope','smoke','span','spire','stave',
  'stem','stone','strand','stria','surge','tarn','tide','tilt','tone','trace',
  'trench','tuft','umbra','vale','vane','veil','vein','vent','void','vortex',
  'wake','warp','wave','wire','yarn','zone',
];

/** djb2 hash of a string → 32-bit unsigned integer. */
function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h, 33) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Produce a stable string from params, rounding floats to 2 dp
 * so minor floating-point drift doesn't change the name.
 */
function _paramsKey(params) {
  const r = v => (v == null ? '' : parseFloat(Number(v).toFixed(2)));
  const cam = params.camera;
  return [
    params.shape, params.source, params.dataMode,
    params.noiseType, params.seed,
    r(params.noiseSpeed), r(params.noiseFreq),
    params.noiseOct, r(params.noisePers),
    params.maxFrames, r(params.ampScale),
    params.fftSize, params.feedRate,
    cam ? cam.position.map(r).join(',') : '',
    cam ? cam.target.map(r).join(',')   : '',
  ].join('|');
}

/**
 * Return a deterministic filename like `waveform-amber-ridge-pulse.gcode`.
 * Same params always produce the same name.
 * @param {object} params - generation parameters from _buildExportParams()
 */
export function generateFilename(params) {
  const n    = _WORDS.length;
  let   seed = _djb2(_paramsKey(params));
  // LCG to derive three independent word indices from the hash
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  return `waveform-${_WORDS[next() % n]}-${_WORDS[next() % n]}-${_WORDS[next() % n]}.gcode`;
}

// ---------------------------------------------------------------------------
// Generation-parameter header comments
// ---------------------------------------------------------------------------
/**
 * Append `; key: value` comment lines for all known generation parameters.
 * @param {string[]} lines
 * @param {object}  params
 */
function _writeParams(lines, params) {
  if (!params) return;
  const p = (label, value) => lines.push(`; ${label.padEnd(16)} ${value}`);
  lines.push('; --- Generation Parameters ---');
  if (params.shape     != null) p('Shape:',       params.shape);
  if (params.source    != null) p('Source:',      params.source);
  if (params.dataMode  != null) p('Data mode:',   params.dataMode);
  if (params.source === 'noise') {
    if (params.noiseType != null) p('Noise type:',  params.noiseType);
    if (params.seed      != null) p('Seed:',        params.seed);
    if (params.noiseSpeed  != null) p('Noise speed:', params.noiseSpeed);
    if (params.noiseFreq   != null) p('Noise freq:',  params.noiseFreq);
    if (params.noiseOct    != null) p('Noise oct:',   params.noiseOct);
    if (params.noisePers   != null) p('Noise pers:',  params.noisePers);
  }
  if (params.maxFrames != null) p('Max frames:',  params.maxFrames);
  if (params.ampScale  != null) p('Amp scale:',   params.ampScale);
  if (params.fftSize   != null) p('FFT size:',    params.fftSize);
  if (params.feedRate  != null) p('Feed rate:',   `${params.feedRate} mm/min`);
  if (params.camera != null) {
    const { position: [px, py, pz], target: [tx, ty, tz] } = params.camera;
    p('Camera pos:',  `${px} ${py} ${pz}`);
    p('Camera tgt:',  `${tx} ${ty} ${tz}`);
  }
  lines.push('; ---');
}

/**
 * Convert projected 3D scene paths (NDC coordinates) to plotter G-code.
 * The paths come from visualizer.getProjectedPaths() which applies the
 * Three.js camera's view-projection matrix to all recorded wave lines.
 *
 * NDC mapping:
 *   nx = -1 → X = MARGIN           (left edge)
 *   nx = +1 → X = MARGIN + PLOT_W  (right edge)
 *   ny = +1 → Y = MARGIN + PLOT_H  (top edge, Three.js Y-up)
 *   ny = -1 → Y = MARGIN           (bottom edge)
 *
 * @param {Array<Array<{nx: number, ny: number}>>} paths
 * @param {{
 *   feedRate?: number,
 *   penDownFeedRate?: number,
 *   penUpZ?: number,
 *   penDownZ?: number
 * }} config
 * @returns {string}
 */
export function projectedPathsToGCode(paths, config = {}) {
  const feedRate    = config.feedRate        ?? 3000;
  const penDownFeed = config.penDownFeedRate ?? 300;
  const penUpZ      = config.penUpZ          ?? 5;
  const penDownZ    = config.penDownZ        ?? 0;
  const penMode     = config.penMode         ?? 'z';
  const penUpS      = config.penUpS          ?? 80;
  const penDownS    = config.penDownS        ?? 50;
  const coreXY      = !!config.coreXY;
  const { sx, sy }  = _ndcScales(config.aspect ?? 1);
  const penOpts     = { penMode, penUpZ, penDownZ, penDownFeed, penUpS, penDownS };

  const lines = [];
  const ts = new Date().toISOString();

  lines.push(`; Audio Wave Visualizer - Scene Projection G-code`);
  lines.push(`; Paths: ${paths.length} | Generated: ${ts}`);
  lines.push(`; Paper: A4 (${PAPER_W}x${PAPER_H}mm), ${MARGIN}mm margins`);
  lines.push(`; Plot area: ${PLOT_W} x ${PLOT_H} mm`);
  _writeParams(lines, config.params);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  _penUp(lines, penOpts);
  lines.push(`G0 ${_xy(MARGIN, MARGIN, coreXY)}`);
  lines.push('');

  for (const path of paths) {
    if (path.length < 2) continue;

    // Map first point and rapid move to it (pen up).
    const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny, sx, sy);
    lines.push(`G0 ${_xy(x0, y0, coreXY)}`);
    _penDown(lines, penOpts);

    for (let i = 1; i < path.length; i++) {
      const { px, py } = _ndcToPaper(path[i].nx, path[i].ny, sx, sy);
      lines.push(`G1 ${_xy(px, py, coreXY)} F${feedRate}`);
    }

    _penUp(lines, penOpts);
  }

  lines.push('');
  _penUp(lines, penOpts);
  lines.push(`G0 X0.000 Y0.000`);
  lines.push(`M2`);

  return lines.join('\n');
}

/**
 * Convert two projected path sets (left/right eye) to anaglyph G-code.
 * The plotter draws the left-eye paths first (red pen), pauses for a pen
 * change via M0, then draws the right-eye paths (cyan pen).
 *
 * NDC mapping is identical to projectedPathsToGCode.
 *
 * @param {Array<Array<{nx: number, ny: number}>>} leftPaths
 * @param {Array<Array<{nx: number, ny: number}>>} rightPaths
 * @param {{ feedRate?: number, penDownFeedRate?: number, penUpZ?: number, penDownZ?: number }} config
 * @returns {string}
 */
export function stereoPathsToGCode(leftPaths, rightPaths, config = {}) {
  const feedRate    = config.feedRate        ?? 3000;
  const penDownFeed = config.penDownFeedRate ?? 300;
  const penUpZ      = config.penUpZ          ?? 5;
  const penDownZ    = config.penDownZ        ?? 0;
  const penMode     = config.penMode         ?? 'z';
  const penUpS      = config.penUpS          ?? 80;
  const penDownS    = config.penDownS        ?? 50;
  const coreXY      = !!config.coreXY;
  const { sx, sy }  = _ndcScales(config.aspect ?? 1);
  const penOpts     = { penMode, penUpZ, penDownZ, penDownFeed, penUpS, penDownS };

  const lines = [];
  const ts = new Date().toISOString();

  lines.push(`; Audio Wave Visualizer - Anaglyph Stereo G-code`);
  lines.push(`; Left-eye paths: ${leftPaths.length}  Right-eye paths: ${rightPaths.length}`);
  lines.push(`; Generated: ${ts}`);
  lines.push(`; Paper: A4 (${PAPER_W}x${PAPER_H}mm), ${MARGIN}mm margins`);
  lines.push(`; Pass 1 = RED pen (left eye)  |  Pass 2 = CYAN pen (right eye)`);
  _writeParams(lines, config.params);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  _penUp(lines, penOpts);
  lines.push(`G0 ${_xy(MARGIN, MARGIN, coreXY)}`);
  lines.push('');
  lines.push(`; ===== PASS 1: RED (left eye) =====`);

  function _writePaths(paths) {
    for (const path of paths) {
      if (path.length < 2) continue;
      const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny, sx, sy);
      lines.push(`G0 ${_xy(x0, y0, coreXY)}`);
      _penDown(lines, penOpts);
      for (let i = 1; i < path.length; i++) {
        const { px, py } = _ndcToPaper(path[i].nx, path[i].ny, sx, sy);
        lines.push(`G1 ${_xy(px, py, coreXY)} F${feedRate}`);
      }
      _penUp(lines, penOpts);
    }
  }

  _writePaths(leftPaths);

  lines.push('');
  _penUp(lines, penOpts);
  lines.push(`G0 ${_xy(MARGIN, MARGIN, coreXY)}`);
  lines.push(`M0           ; Pause — swap to CYAN pen`);
  lines.push('');
  lines.push(`; ===== PASS 2: CYAN (right eye) =====`);

  _writePaths(rightPaths);

  lines.push('');
  _penUp(lines, penOpts);
  lines.push(`G0 X0.000 Y0.000`);
  lines.push(`M2`);

  return lines.join('\n');
}

// Compute half-extents (mm) for NDC → paper mapping that preserves the
// viewport aspect ratio via a "contain" fit (like CSS object-fit: contain).
// aspect = canvas_width / canvas_height (from camera.aspect).
function _ndcScales(aspect = 1) {
  const paperAspect = PLOT_W / PLOT_H;   // ~0.686 for A4 portrait
  let sx, sy;
  if (aspect >= paperAspect) {
    // viewport is wider than paper → x fills PLOT_W, y is proportionally smaller
    sx = PLOT_W / 2;
    sy = sx / aspect;
  } else {
    // viewport is taller than paper → y fills PLOT_H, x is proportionally smaller
    sy = PLOT_H / 2;
    sx = sy * aspect;
  }
  return { sx, sy };
}

// Map NDC (-1..+1) to paper coordinates (mm), centred on the paper.
// sx / sy are the half-extents in mm for each axis (from _ndcScales).
function _ndcToPaper(nx, ny, sx, sy) {
  const px = clampX(CENTER_X + nx * sx);
  const py = clampY(CENTER_Y + ny * sy);
  return { px, py };
}

// ---------------------------------------------------------------------------
// Pen up / down helpers — generate the right command for Z-axis or servo mode
// ---------------------------------------------------------------------------

function _penUp(lines, opts) {
  if (opts.penMode === 'servo') {
    lines.push(`M3 S${opts.penUpS ?? 80}`);
    lines.push(`G4 P0.1`);
  } else {
    lines.push(`G0 Z${f(opts.penUpZ)}`);
  }
}

function _penDown(lines, opts) {
  if (opts.penMode === 'servo') {
    lines.push(`M3 S${opts.penDownS ?? 50}`);
    lines.push(`G4 P0.1`);
  } else {
    lines.push(`G1 Z${f(opts.penDownZ)} F${opts.penDownFeed}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function f(n)        { return n.toFixed(3); }
function clampX(x)   { return Math.max(MARGIN, Math.min(MARGIN + PLOT_W, x)); }
function clampY(y)   { return Math.max(MARGIN, Math.min(MARGIN + PLOT_H, y)); }
function clampR(r)   { return Math.max(0, Math.min(MAX_R, r)); }

// Map Cartesian paper coords (mm) to a G-code XY fragment.
// When coreXY is true applies the CoreXY motor transform: A = X+Y, B = X−Y.
function _xy(px, py, coreXY) {
  if (coreXY) return `X${f(px + py)} Y${f(px - py)}`;
  return `X${f(px)} Y${f(py)}`;
}

function _rowAmpScaleMm(frameCount, configScale) {
  const rowSpacing = frameCount > 1 ? PLOT_H / (frameCount - 1) : PLOT_H;
  return rowSpacing * 0.45 * configScale;
}

function _isStereo(data) {
  return data && !(data instanceof Float32Array) && data.left instanceof Float32Array;
}

function _toMono(data) {
  return _isStereo(data) ? data.left : data;
}
