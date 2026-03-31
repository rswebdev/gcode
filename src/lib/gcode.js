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
  const { feedRate, ampScale } = opts;
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
  const { feedRate, ampScale } = opts;
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
  const { feedRate, ampScale } = opts;
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
  const { feedRate, ampScale } = opts;
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
  const { feedRate } = opts;
  const F = frames.length;

  // Scale: ±1 amplitude → ±halfPlot mm (use the smaller axis).
  const halfW = PLOT_W / 2;
  const halfH = PLOT_H / 2;
  const halfSize = Math.min(halfW, halfH) * 0.9;

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

/**
 * Parse XY draw paths from a G-code file.
 * Draw paths are created from contiguous G1 moves; G0 moves split paths.
 * Supports G90/G91 (absolute/relative) and G92 (set current position).
 *
 * @param {string} content
 * @returns {{ paths: Array<Array<{x:number,y:number}>>, stats: { moves: number, draws: number } }}
 */
export function parseGCodePaths(content) {
  const paths = [];
  let current = null;
  let absolute = true;
  let x = 0;
  let y = 0;
  let moves = 0;
  let draws = 0;

  const finishPath = () => {
    if (current && current.length > 1) paths.push(current);
    current = null;
  };

  const lines = (content || '').split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) continue;
    const noParen = raw.replace(/\([^)]*\)/g, '');
    const line = noParen.split(';')[0].trim();
    if (!line) continue;

    const gMatch = line.match(/\bG0*([0-9]+)\b/i);
    const gCode = gMatch ? parseInt(gMatch[1], 10) : null;

    if (gCode === 90) { absolute = true; continue; }
    if (gCode === 91) { absolute = false; continue; }

    const xMatch = line.match(/\bX\s*([-+]?\d*\.?\d+)\b/i);
    const yMatch = line.match(/\bY\s*([-+]?\d*\.?\d+)\b/i);

    if (gCode === 92) {
      if (xMatch) x = parseFloat(xMatch[1]);
      if (yMatch) y = parseFloat(yMatch[1]);
      continue;
    }

    if (gCode !== 0 && gCode !== 1) continue;
    if (!xMatch && !yMatch) continue;

    const nextX = xMatch ? (absolute ? parseFloat(xMatch[1]) : x + parseFloat(xMatch[1])) : x;
    const nextY = yMatch ? (absolute ? parseFloat(yMatch[1]) : y + parseFloat(yMatch[1])) : y;

    if (gCode === 1) {
      if (!current) current = [{ x, y }];
      current.push({ x: nextX, y: nextY });
      draws += 1;
    } else {
      finishPath();
      moves += 1;
    }

    x = nextX;
    y = nextY;
  }

  finishPath();
  return { paths, stats: { moves, draws } };
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
  // Genart exports set algorithmId + params; wave exports set shape/source/etc.
  // Include both so filenames are deterministic for either source.
  const genartKey = params.algorithmId
    ? `${params.algorithmId}|${JSON.stringify(params.params ?? {})}`
    : '';
  return [
    genartKey,
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
  if (params.algorithmId    != null) p('Algorithm ID:',  params.algorithmId);
  if (params.algorithmLabel != null) p('Algorithm:',     params.algorithmLabel);
  if (params.params         != null) {
    for (const [k, v] of Object.entries(params.params)) {
      p(`  ${k}:`, v);
    }
  }
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
  const penYComp    = config.penYComp        ?? 0;
  const coreXY      = !!config.coreXY;
  const offsetX     = config.offsetX ?? 0;
  const offsetY     = config.offsetY ?? 0;
  const plotScale   = config.plotScale ?? 1;
  const dims        = _paperCtx(config);
  const ow = dims ? dims.ow : PLOT_W;
  const oh = dims ? dims.oh : PLOT_H;
  const { sx: sxR, sy: syR } = _ndcScales(config.aspect ?? 1, ow, oh);
  const sx = sxR * plotScale;
  const sy = syR * plotScale;
  const penOpts = { penMode, penUpZ, penDownZ, penDownFeed, penUpS, penDownS, penYComp };

  const lines = [];
  const ts = new Date().toISOString();
  const pw = config.paperW ?? PAPER_W;
  const ph = config.paperH ?? PAPER_H;

  lines.push(`; Audio Wave Visualizer - Scene Projection G-code`);
  lines.push(`; Paths: ${paths.length} | Generated: ${ts}`);
  lines.push(`; Paper: ${pw}x${ph}mm, ${config.margin ?? MARGIN}mm margins`);
  lines.push(`; Plot area: ${ow} x ${oh} mm`);
  _writeParams(lines, config.params);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  _penUp(lines, penOpts);
  lines.push('');

  for (const path of _sortPaths(paths)) {
    if (path.length < 2) continue;

    // Map first point and rapid move to it (pen up).
    const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny, sx, sy, offsetX, offsetY, dims);
    lines.push(`G0 ${_xy(x0, y0, coreXY)}`);
    _penDown(lines, penOpts, y0);

    for (let i = 1; i < path.length; i++) {
      const { px, py } = _ndcToPaper(path[i].nx, path[i].ny, sx, sy, offsetX, offsetY, dims);
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
  const penYComp    = config.penYComp        ?? 0;
  const coreXY      = !!config.coreXY;
  const offsetX     = config.offsetX ?? 0;
  const offsetY     = config.offsetY ?? 0;
  const plotScale   = config.plotScale ?? 1;
  const dims        = _paperCtx(config);
  const ow = dims ? dims.ow : PLOT_W;
  const oh = dims ? dims.oh : PLOT_H;
  const { sx: sxR, sy: syR } = _ndcScales(config.aspect ?? 1, ow, oh);
  const sx = sxR * plotScale;
  const sy = syR * plotScale;
  const penOpts = { penMode, penUpZ, penDownZ, penDownFeed, penUpS, penDownS, penYComp };

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
  lines.push('');
  lines.push(`; ===== PASS 1: RED (left eye) =====`);

  function _writePaths(paths) {
    for (const path of paths) {
      if (path.length < 2) continue;
      const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny, sx, sy, offsetX, offsetY, dims);
      lines.push(`G0 ${_xy(x0, y0, coreXY)}`);
      _penDown(lines, penOpts, y0);
      for (let i = 1; i < path.length; i++) {
        const { px, py } = _ndcToPaper(path[i].nx, path[i].ny, sx, sy, offsetX, offsetY, dims);
        lines.push(`G1 ${_xy(px, py, coreXY)} F${feedRate}`);
      }
      _penUp(lines, penOpts);
    }
  }

  _writePaths(_sortPaths(leftPaths));

  lines.push('');
  _penUp(lines, penOpts);
  lines.push(`M0           ; Pause — swap to CYAN pen`);
  lines.push('');
  lines.push(`; ===== PASS 2: CYAN (right eye) =====`);

  _writePaths(_sortPaths(rightPaths));

  lines.push('');
  _penUp(lines, penOpts);
  lines.push(`G0 X0.000 Y0.000`);
  lines.push(`M2`);

  return lines.join('\n');
}

/**
 * Generate multi-pass G-code for an image trace result.
 *
 * Pass 1: contour outlines.
 * Then for each shading pass an M0 pause allows a pen swap before
 * drawing that shade level.  Darker/denser passes come first.
 *
 * @param {Array<Array<{nx,ny}>>} contourPaths
 * @param {Array<{label:string, paths:Array<Array<{nx,ny}>>}>} shadingPasses
 * @param {object} config  Same shape as projectedPathsToGCode config.
 * @returns {string}
 */
export function imageGCode(contourPaths, shadingPasses, config = {}) {
  const feedRate    = config.feedRate        ?? 3000;
  const penDownFeed = config.penDownFeedRate ?? 300;
  const penUpZ      = config.penUpZ          ?? 5;
  const penDownZ    = config.penDownZ        ?? 0;
  const penMode     = config.penMode         ?? 'z';
  const penUpS      = config.penUpS          ?? 80;
  const penDownS    = config.penDownS        ?? 50;
  const penYComp    = config.penYComp        ?? 0;
  const coreXY      = !!config.coreXY;
  const offsetX     = config.offsetX ?? 0;
  const offsetY     = config.offsetY ?? 0;
  const plotScale   = config.plotScale ?? 1;
  const dims        = _paperCtx(config);
  const ow = dims ? dims.ow : PLOT_W;
  const oh = dims ? dims.oh : PLOT_H;
  const { sx: sxR, sy: syR } = _ndcScales(config.aspect ?? 1, ow, oh);
  const sx = sxR * plotScale;
  const sy = syR * plotScale;
  const penOpts = { penMode, penUpZ, penDownZ, penDownFeed, penUpS, penDownS, penYComp };
  const pw = config.paperW ?? PAPER_W;
  const ph = config.paperH ?? PAPER_H;
  const totalPasses = 1 + (shadingPasses?.length ?? 0);

  const lines = [];
  lines.push(`; Image Trace G-code — ${contourPaths.length} contour paths, ${totalPasses} passes`);
  lines.push(`; Generated: ${new Date().toISOString()}`);
  lines.push(`; Paper: ${pw}x${ph}mm | Plot area: ${ow}x${oh}mm`);
  if (totalPasses > 1) lines.push(`; M0 pauses allow pen swap between passes`);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  _penUp(lines, penOpts);
  lines.push('');

  function _writePaths(paths) {
    for (const path of _sortPaths(paths)) {
      if (path.length < 2) continue;
      const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny, sx, sy, offsetX, offsetY, dims);
      lines.push(`G0 ${_xy(x0, y0, coreXY)}`);
      _penDown(lines, penOpts, y0);
      for (let i = 1; i < path.length; i++) {
        const { px, py } = _ndcToPaper(path[i].nx, path[i].ny, sx, sy, offsetX, offsetY, dims);
        lines.push(`G1 ${_xy(px, py, coreXY)} F${feedRate}`);
      }
      _penUp(lines, penOpts);
    }
  }

  lines.push(`; ===== PASS 1 / ${totalPasses}: Contours =====`);
  _writePaths(contourPaths);

  for (let i = 0; i < (shadingPasses?.length ?? 0); i++) {
    const pass = shadingPasses[i];
    if (!pass.paths.length) continue;
    lines.push('');
    _penUp(lines, penOpts);
    lines.push(`M0           ; Pause — swap pen for shading: ${pass.label}`);
    lines.push('');
    lines.push(`; ===== PASS ${i + 2} / ${totalPasses}: ${pass.label} =====`);
    _writePaths(pass.paths);
  }

  lines.push('');
  _penUp(lines, penOpts);
  lines.push(`G0 X0.000 Y0.000`);
  lines.push(`M2`);

  return lines.join('\n');
}
// viewport aspect ratio via a "contain" fit (like CSS object-fit: contain).
// aspect = canvas_width / canvas_height (from camera.aspect).
// Accept optional plotW/plotH overrides (default: A4 plot area).
function _ndcScales(aspect = 1, plotW = PLOT_W, plotH = PLOT_H) {
  const paperAspect = plotW / plotH;
  let sx, sy;
  if (aspect >= paperAspect) {
    sx = plotW / 2;
    sy = sx / aspect;
  } else {
    sy = plotH / 2;
    sx = sy * aspect;
  }
  return { sx, sy };
}

// Map NDC (-1..+1) to paper coordinates (mm), centred on the paper.
// sx / sy are the half-extents in mm for each axis (from _ndcScales).
// ox / oy are optional mm offsets applied after the mapping.
// dims (optional) overrides center and clamping bounds for non-A4 paper.
// clamp (default false): when true, constrains output to the plot area.
//   Leave false for projected/stereo paths (landscape intentionally exceeds bounds).
//   Pass true for frameGCode bounding-box traces.
function _ndcToPaper(nx, ny, sx, sy, ox = 0, oy = 0, dims = null, clamp = false) {
  const cx = dims ? dims.cx : CENTER_X;
  const cy = dims ? dims.cy : CENTER_Y;
  const m  = dims ? dims.m  : MARGIN;
  const ow = dims ? dims.ow : PLOT_W;
  const oh = dims ? dims.oh : PLOT_H;
  const rawX = cx + nx * sx + ox;
  const rawY = cy + ny * sy + oy;
  return {
    px: clamp ? Math.max(m, Math.min(m + ow, rawX)) : rawX,
    py: clamp ? Math.max(m, Math.min(m + oh, rawY)) : rawY,
  };
}

// Build paper context for non-default paper sizes.
// Returns null when config has no paperW/H (keeps using module constants = no overhead).
function _paperCtx(config) {
  const m  = config.margin  ?? MARGIN;
  const pw = config.paperW  ?? PAPER_W;
  const ph = config.paperH  ?? PAPER_H;
  if (pw === PAPER_W && ph === PAPER_H && m === MARGIN) return null;
  const ow = pw - 2 * m;
  const oh = ph - 2 * m;
  return { m, ow, oh, cx: m + ow / 2, cy: m + oh / 2 };
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

function _penDown(lines, opts, yMm = 0) {
  if (opts.penMode === 'servo') {
    const slope = opts.penYComp ?? 0;
    const s = Math.round(Math.max(0, Math.min(1000, (opts.penDownS ?? 50) + slope * yMm)));
    lines.push(`M3 S${s}`);
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

/**
 * Generate a dry-run bounding-box trace of the projected paths.
 * The pen stays raised the entire time — use this to verify plot placement
 * before committing to a full print.
 *
 * @param {Array<Array<{nx: number, ny: number}>>} paths
 * @param {{ penUpZ?, penUpS?, penMode?, coreXY?, aspect? }} config
 * @returns {string}
 */
export function frameGCode(paths, config = {}) {
  const coreXY  = !!config.coreXY;
  const offsetX = config.offsetX ?? 0;
  const offsetY = config.offsetY ?? 0;
  const penMode = config.penMode ?? 'z';
  const penUpZ  = config.penUpZ  ?? 5;
  const penUpS  = config.penUpS  ?? 80;
  const penOpts = { penMode, penUpZ, penDownZ: 0, penDownFeed: 300, penUpS, penDownS: 50 };
  const plotScale = config.plotScale ?? 1;
  const dims    = _paperCtx(config);
  const ow = dims ? dims.ow : PLOT_W;
  const oh = dims ? dims.oh : PLOT_H;
  const { sx: sxR, sy: syR } = _ndcScales(config.aspect ?? 1, ow, oh);
  const sx = sxR * plotScale;
  const sy = syR * plotScale;

  // Compute bounding box across all path points.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const pt of path) {
      const { px, py } = _ndcToPaper(pt.nx, pt.ny, sx, sy, offsetX, offsetY, dims, true);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (!isFinite(minX)) return '';

  const lines = ['G21', 'G90'];
  _penUp(lines, penOpts);

  // Trace: bottom-left → bottom-right → top-right → top-left → bottom-left.
  for (const [cx, cy] of [
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
  ]) {
    lines.push(`G0 ${_xy(cx, cy, coreXY)}`);
  }

  _penUp(lines, penOpts);
  lines.push('G0 X0.000 Y0.000');
  return lines.join('\n');
}

function _rowAmpScaleMm(frameCount, configScale) {
  const rowSpacing = frameCount > 1 ? PLOT_H / (frameCount - 1) : PLOT_H;
  return rowSpacing * 0.45 * configScale;
}

/**
 * Reorder (and if needed reverse) paths to minimise total pen-up travel using
 * a greedy nearest-neighbour algorithm. Works in NDC space — no unit conversion
 * needed since it's a linear transform of paper coords.
 * Returns a new array; the input paths are not mutated.
 */
/**
 * Sorts paths using a greedy nearest-neighbour algorithm to minimise total
 * pen-up travel.  Each path can also be reversed if that brings the pen
 * closer to the next start point.
 *
 * @param {Array<Array<{nx:number,ny:number}>>} paths
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function sortPaths(paths) {
  return _sortPaths(paths);
}

function _sortPaths(paths) {
  if (paths.length < 2) return paths;

  const deduped = _deduplicatePaths(paths);

  const remaining = deduped.slice();
  const result    = [];
  // Start from the NDC equivalent of machine home (0,0) which sits at the
  // bottom-left of the plot area — approximately NDC (-1,-1).
  let cx = -1, cy = -1;

  while (remaining.length > 0) {
    let bestIdx  = 0;
    let bestDist = Infinity;
    let bestRev  = false;

    for (let i = 0; i < remaining.length; i++) {
      const p    = remaining[i];
      const head = p[0];
      const tail = p[p.length - 1];
      const dHead = (head.nx - cx) ** 2 + (head.ny - cy) ** 2;
      const dTail = (tail.nx - cx) ** 2 + (tail.ny - cy) ** 2;
      if (dHead < bestDist) { bestDist = dHead; bestIdx = i; bestRev = false; }
      if (dTail < bestDist) { bestDist = dTail; bestIdx = i; bestRev = true;  }
    }

    const p      = remaining.splice(bestIdx, 1)[0];
    const chosen = bestRev ? p.slice().reverse() : p;
    result.push(chosen);

    const last = chosen[chosen.length - 1];
    cx = last.nx;
    cy = last.ny;
  }

  return result;
}

/**
 * Remove duplicate line segments from a path set and rechain the survivors.
 *
 * Two segments are considered identical when both endpoints round to the same
 * NDC coordinates at 1e-6 precision (handles tiny floating-point differences
 * between paths computed independently, e.g. shared Voronoi cell edges).
 * Deduplication is bidirectional: A→B and B→A are the same segment.
 *
 * A fast early-exit pre-scan means non-duplicate inputs (typical waveform
 * paths) are returned as-is with minimal overhead.
 */
function _deduplicatePaths(paths) {
  const PREC = 1e6;
  const snap = v => Math.round(v * PREC) / PREC;
  const pk   = pt  => `${snap(pt.nx)},${snap(pt.ny)}`;
  const ek   = (k1, k2) => k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;

  // ── Fast pre-scan: bail out immediately if no duplicates exist ────────────
  const quickSeen = new Set();
  let hasDupes = false;
  outer: for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const key = ek(pk(path[i]), pk(path[i + 1]));
      if (quickSeen.has(key)) { hasDupes = true; break outer; }
      quickSeen.add(key);
    }
  }
  if (!hasDupes) return paths;

  // ── Full pass: collect unique segments ────────────────────────────────────
  quickSeen.clear();
  const segs = [];
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const key = ek(pk(path[i]), pk(path[i + 1]));
      if (!quickSeen.has(key)) {
        quickSeen.add(key);
        segs.push([path[i], path[i + 1]]);
      }
    }
  }

  // ── Rechain: greedily join adjacent segments into polylines ───────────────
  // Build adjacency: vertex-key → [{neighbourKey, segIdx, reversed}]
  const adj = new Map();
  const addAdj = (kFrom, kTo, idx, rev) => {
    if (!adj.has(kFrom)) adj.set(kFrom, []);
    adj.get(kFrom).push({ kTo, idx, rev });
  };
  segs.forEach(([p1, p2], i) => {
    const k1 = pk(p1), k2 = pk(p2);
    addAdj(k1, k2, i, false);
    addAdj(k2, k1, i, true);
  });

  const used   = new Uint8Array(segs.length);
  const chains = [];
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const chain = [segs[start][0], segs[start][1]];
    let cur = pk(segs[start][1]);
    for (;;) {
      const nbrs = adj.get(cur) ?? [];
      let extended = false;
      for (const { kTo, idx, rev } of nbrs) {
        if (!used[idx]) {
          used[idx] = 1;
          chain.push(rev ? segs[idx][0] : segs[idx][1]);
          cur = kTo;
          extended = true;
          break;
        }
      }
      if (!extended) break;
    }
    chains.push(chain);
  }
  return chains;
}

function _isStereo(data) {
  return data && !(data instanceof Float32Array) && data.left instanceof Float32Array;
}

function _toMono(data) {
  return _isStereo(data) ? data.left : data;
}

// ---------------------------------------------------------------------------
// Y calibration sweep — test servo compensation across bed
// ---------------------------------------------------------------------------

/**
 * Generate a pen calibration sweep.
 * Draws short horizontal strokes at regular Y intervals using the current
 * pen-down settings and Y compensation. Compare mark depth across Y positions:
 * uniform marks → compensation correct; fading at one end → adjust penYComp.
 *
 * @param {{
 *   penMode?, penUpZ?, penDownZ?, penUpS?, penDownS?, penYComp?,
 *   feedRate?, penDownFeedRate?, coreXY?,
 *   calYMax?: number,     // max Y to reach (mm, default 260)
 *   calYStep?: number,    // spacing between marks (mm, default 20)
 *   calStrokeMm?: number, // horizontal stroke length (mm, default 30)
 *   xCenter?: number,     // X centre of strokes (mm, default paper centre)
 * }} config
 * @returns {string}
 */
export function calSweepGCode(config = {}) {
  const penMode     = config.penMode          ?? 'z';
  const penUpZ      = config.penUpZ           ?? 5;
  const penDownZ    = config.penDownZ         ?? 0;
  const penUpS      = config.penUpS           ?? 80;
  const penDownS    = config.penDownS         ?? 50;
  const penYComp    = config.penYComp         ?? 0;
  const feedRate    = config.feedRate         ?? 3000;
  const penDownFeed = config.penDownFeedRate  ?? 300;
  const coreXY      = !!config.coreXY;
  const yMax        = config.calYMax          ?? 260;
  const yStep       = config.calYStep         ?? 20;
  const stroke      = config.calStrokeMm      ?? 30;
  const xCenter     = config.xCenter          ?? CENTER_X;
  const xL          = xCenter - stroke / 2;
  const xR          = xCenter + stroke / 2;
  const penOpts     = { penMode, penUpZ, penDownZ, penDownFeed, penUpS, penDownS, penYComp };

  const lines = [];
  lines.push('; Pen Y Calibration Sweep');
  lines.push(`; penDownS=${penDownS}  penYComp=${penYComp} S/mm`);
  lines.push(`; ${Math.floor(yMax / yStep) + 1} marks every ${yStep} mm  (Y 0 → ${yMax} mm)`);
  lines.push('G21');
  lines.push('G90');
  _penUp(lines, penOpts);

  for (let y = 0; y <= yMax + 0.001; y = Math.round((y + yStep) * 1000) / 1000) {
    lines.push(`; Y=${f(y)} mm  (mat ${(y / 10).toFixed(1)} cm)`);
    lines.push(`G0 ${_xy(xL, y, coreXY)}`);
    _penDown(lines, penOpts, y);
    lines.push(`G1 ${_xy(xR, y, coreXY)} F${feedRate}`);
    _penUp(lines, penOpts);
  }

  _penUp(lines, penOpts);
  lines.push('G0 X0.000 Y0.000');
  return lines.join('\n');
}

/**
 * Generate a calibration test pattern: square outline + grid.
 * Exports G-code text that parseGCodePaths can parse back to paths.
 * @param {number} size - Size of square (mm, default 50)
 * @param {number} gridSpacing - Grid line spacing (mm, default 10)
 * @param {number} offsetX - Left offset from center (mm, default 50)
 * @param {number} offsetY - Bottom offset (mm, default 50)
 * @returns {string} G-code content
 */
export function generateCalibrationPattern(size = 50, gridSpacing = 10, offsetX = 50, offsetY = 50) {
  const lines = [];
  lines.push('; Calibration Test Pattern');
  lines.push(`; ${size}mm × ${size}mm square with ${gridSpacing}mm grid`);
  lines.push('G21');
  lines.push('G90');
  lines.push('G0 Z5');

  const startX = offsetX;
  const startY = offsetY;
  const endX   = offsetX + size;
  const endY   = offsetY + size;

  // Outer square outline
  lines.push(`; Outer square outline`);
  lines.push(`G0 X${f(startX)} Y${f(startY)}`);
  lines.push(`G1 X${f(endX)} Y${f(startY)} F3000`);
  lines.push(`G1 X${f(endX)} Y${f(endY)} F3000`);
  lines.push(`G1 X${f(startX)} Y${f(endY)} F3000`);
  lines.push(`G1 X${f(startX)} Y${f(startY)} F3000`);

  // Vertical grid lines
  lines.push(`; Vertical grid lines`);
  for (let x = startX + gridSpacing; x < endX; x += gridSpacing) {
    lines.push(`G0 X${f(x)} Y${f(startY)}`);
    lines.push(`G1 X${f(x)} Y${f(endY)} F3000`);
  }

  // Horizontal grid lines
  lines.push(`; Horizontal grid lines`);
  for (let y = startY + gridSpacing; y < endY; y += gridSpacing) {
    lines.push(`G0 X${f(startX)} Y${f(y)}`);
    lines.push(`G1 X${f(endX)} Y${f(y)} F3000`);
  }

  // Diagonal lines (for plotter movement check)
  lines.push(`; Diagonal lines`);
  lines.push(`G0 X${f(startX)} Y${f(startY)}`);
  lines.push(`G1 X${f(endX)} Y${f(endY)} F3000`);
  lines.push(`G0 X${f(endX)} Y${f(startY)}`);
  lines.push(`G1 X${f(startX)} Y${f(endY)} F3000`);

  lines.push('G0 Z5');
  lines.push('G0 X0 Y0');
  return lines.join('\n');
}
