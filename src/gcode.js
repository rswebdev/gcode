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

  const opts = { feedRate, penDownFeed, penUpZ, penDownZ, ampScale };
  const lines = [];
  const ts = new Date().toISOString();

  lines.push(`; Audio Wave Visualizer - G-code Export`);
  lines.push(`; Data: ${dataMode} | Shape: ${shape} | Frames: ${frames.length}`);
  lines.push(`; Generated: ${ts}`);
  lines.push(`; Paper: A4 (${PAPER_W}x${PAPER_H}mm), ${MARGIN}mm margins`);
  lines.push(`; Plot area: ${PLOT_W} x ${PLOT_H} mm`);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  lines.push(`G0 Z${f(penUpZ)}`);
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

  lines.push(`G0 Z${f(penUpZ)}`);
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
    lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);

    for (let i = 0; i < N; i++) {
      const px = MARGIN + (i / (N - 1)) * PLOT_W;
      const py = clampY(yBase + frame[i] * rowAmpScale);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    lines.push(`G0 Z${f(penUpZ)}`);
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
      lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);

      for (let i = 0; i < N; i++) {
        const px = MARGIN + (i / (N - 1)) * PLOT_W;
        const py = clampY(yBase + data[i] * rowAmpScale);
        lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
      }

      lines.push(`G0 Z${f(penUpZ)}`);
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
    lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);

    // Draw N+1 points to close the ring.
    for (let i = 1; i <= N; i++) {
      const si    = i % N;
      const angle = (si / N) * Math.PI * 2;
      const r     = clampR(baseRadius + data[si] * ringAmpMm);
      const px    = CENTER_X + r * Math.cos(angle);
      const py    = CENTER_Y + r * Math.sin(angle);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    lines.push(`G0 Z${f(penUpZ)}`);
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
  lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);

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

  lines.push(`G0 Z${f(penUpZ)}`);
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
    lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);

    for (let i = 1; i < N; i++) {
      const px = clampX(CENTER_X + left[i] * halfSize);
      const py = clampY(CENTER_Y + right[i] * halfSize);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    lines.push(`G0 Z${f(penUpZ)}`);
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
 * @param {'time'|'frequency'|'stereo'} dataMode
 * @param {'linear'|'circular'|'spiral'|'lissajous'} shape
 * @returns {string}
 */
export function generateFilename(dataMode, shape) {
  return `wave-${shape}-${dataMode}-${Date.now()}.gcode`;
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

  const lines = [];
  const ts = new Date().toISOString();

  lines.push(`; Audio Wave Visualizer - Scene Projection G-code`);
  lines.push(`; Paths: ${paths.length} | Generated: ${ts}`);
  lines.push(`; Paper: A4 (${PAPER_W}x${PAPER_H}mm), ${MARGIN}mm margins`);
  lines.push(`; Plot area: ${PLOT_W} x ${PLOT_H} mm`);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  lines.push(`G0 Z${f(penUpZ)}`);
  lines.push(`G0 X${f(MARGIN)} Y${f(MARGIN)}`);
  lines.push('');

  for (const path of paths) {
    if (path.length < 2) continue;

    // Map first point and rapid move to it (pen up).
    const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny);
    lines.push(`G0 X${f(x0)} Y${f(y0)}`);
    lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);

    for (let i = 1; i < path.length; i++) {
      const { px, py } = _ndcToPaper(path[i].nx, path[i].ny);
      lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
    }

    lines.push(`G0 Z${f(penUpZ)}`);
  }

  lines.push('');
  lines.push(`G0 Z${f(penUpZ)}`);
  lines.push(`G0 X${f(0)} Y${f(0)}`);
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

  const lines = [];
  const ts = new Date().toISOString();

  lines.push(`; Audio Wave Visualizer - Anaglyph Stereo G-code`);
  lines.push(`; Left-eye paths: ${leftPaths.length}  Right-eye paths: ${rightPaths.length}`);
  lines.push(`; Generated: ${ts}`);
  lines.push(`; Paper: A4 (${PAPER_W}x${PAPER_H}mm), ${MARGIN}mm margins`);
  lines.push(`; Pass 1 = RED pen (left eye)  |  Pass 2 = CYAN pen (right eye)`);
  lines.push(`G21          ; Units: millimetres`);
  lines.push(`G90          ; Absolute positioning`);
  lines.push(`G0 Z${f(penUpZ)}`);
  lines.push(`G0 X${f(MARGIN)} Y${f(MARGIN)}`);
  lines.push('');
  lines.push(`; ===== PASS 1: RED (left eye) =====`);

  function _writePaths(paths) {
    for (const path of paths) {
      if (path.length < 2) continue;
      const { px: x0, py: y0 } = _ndcToPaper(path[0].nx, path[0].ny);
      lines.push(`G0 X${f(x0)} Y${f(y0)}`);
      lines.push(`G1 Z${f(penDownZ)} F${penDownFeed}`);
      for (let i = 1; i < path.length; i++) {
        const { px, py } = _ndcToPaper(path[i].nx, path[i].ny);
        lines.push(`G1 X${f(px)} Y${f(py)} F${feedRate}`);
      }
      lines.push(`G0 Z${f(penUpZ)}`);
    }
  }

  _writePaths(leftPaths);

  lines.push('');
  lines.push(`G0 Z${f(penUpZ)}`);
  lines.push(`G0 X${f(MARGIN)} Y${f(MARGIN)}`);
  lines.push(`M0           ; Pause — swap to CYAN pen`);
  lines.push('');
  lines.push(`; ===== PASS 2: CYAN (right eye) =====`);

  _writePaths(rightPaths);

  lines.push('');
  lines.push(`G0 Z${f(penUpZ)}`);
  lines.push(`G0 X${f(0)} Y${f(0)}`);
  lines.push(`M2`);

  return lines.join('\n');
}

// Map NDC (-1..+1) to paper coordinates (mm), clamped to plot area.
function _ndcToPaper(nx, ny) {
  const px = clampX(MARGIN + (nx + 1) / 2 * PLOT_W);
  const py = clampY(MARGIN + (ny + 1) / 2 * PLOT_H);
  return { px, py };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function f(n)        { return n.toFixed(3); }
function clampX(x)   { return Math.max(MARGIN, Math.min(MARGIN + PLOT_W, x)); }
function clampY(y)   { return Math.max(MARGIN, Math.min(MARGIN + PLOT_H, y)); }
function clampR(r)   { return Math.max(0, Math.min(MAX_R, r)); }

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
