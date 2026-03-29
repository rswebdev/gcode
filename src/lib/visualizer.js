/**
 * visualizer.js
 * Three.js 3D scene. Supports ten shapes:
 *   linear      — stacked wave lines (Joy Division)
 *   circular    — concentric amplitude rings on the XZ plane
 *   spiral      — one continuous spiral, rebuilt on each new frame
 *   lissajous   — L-channel vs R-channel scatter/trace
 *   terrain     — horizon-masked Joy Division (painters-algorithm occlusion)
 *   harmonograph— two-pendulum Lissajous with damping, driven by dominant FFT bins
 *   moire       — two offset concentric ring families per frame
 *   landscape   — Joy Division occlusion ridges with opaque fill polygons
 *   heatmap     — frequency spectrogram grid with cross-hatch density
 *   quantized   — Joy Division ridges with amplitude quantized to discrete bands; gap regions colored with hatch fills
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------
const SCENE_W       = 20;    // linear X range: -10 to +10
const SCENE_DEPTH   = 20;    // linear Z range: 0 to +20
const INNER_R       = 0.5;   // polar inner radius (scene units)
const OUTER_R       = 9.0;   // polar outer radius
const SPIRAL_TURNS  = 3;     // full rotations for spiral shape
const LISS_SCALE    = 7;     // scene units for lissajous extents
const PAPER_W       = 210;
const PAPER_H       = 297;
const MARGIN_MM     = 10;
const PLOT_W_MM     = PAPER_W - 2 * MARGIN_MM;
const PLOT_H_MM     = PAPER_H - 2 * MARGIN_MM;
const CENTER_X_MM   = MARGIN_MM + PLOT_W_MM / 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let renderer, camera, scene, controls;
let waveLines = [];        // recorded frame lines / segments / points
let liveLine  = null;      // real-time preview line
let shape     = 'linear';
let cfg       = { ampScale: 2.0, maxFrames: 64 };
let scaleFactor = 1.0;     // global scale for rendering (applied to XZ plane)

// ---------------------------------------------------------------------------
// Public: shape sets
// REBUILD_ALL_SHAPES reconstruct their full geometry from all frames each time
// a new frame is added. Per-frame shapes append one (or more) lines.
// ---------------------------------------------------------------------------
export const REBUILD_ALL_SHAPES = new Set([
  'spiral', 'terrain', 'harmonograph', 'landscape', 'heatmap', 'quantized',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise renderer and scene. Call once on DOMContentLoaded.
 * @param {HTMLCanvasElement} canvas
 * @param {{ ampScale: number, maxFrames: number }} config
 */
export function init(canvas, config) {
  cfg = { ...cfg, ...config };

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  const aspect = canvas.clientWidth / canvas.clientHeight;
  camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  _positionCameraForShape('linear');
  _buildGridAndAxes();

  window.addEventListener('resize', _onResize);
}

/**
 * Switch rendering shape. Clears all existing lines and repositions camera.
 * @param {'linear'|'circular'|'spiral'|'lissajous'|'terrain'|'harmonograph'|'moire'|'landscape'|'heatmap'|'quantized'} newShape
 */
export function setShape(newShape) {
  shape = newShape;
  clearWaveLines();
  _positionCameraForShape(newShape);
}

/** @param {{ ampScale?: number, maxFrames?: number }} config */
export function updateConfig(config) {
  cfg = { ...cfg, ...config };
}

/**
 * Set the scale factor for all rendered visualizations.
 * @param {number} scale Scale multiplier (1.0 = normal size)
 */
export function setScaleFactor(scale) {
  scaleFactor = Math.max(0.1, Math.min(10, scale || 1.0));
}

/**
 * Rebuild the full visualization from a set of previously recorded frames.
 * Clears current geometry and re-runs the shape builder with the current
 * config (so ampScale and other live settings are applied immediately).
 * @param {Array<Float32Array | { left: Float32Array, right: Float32Array }>} frames
 */
export function replayFrames(frames) {
  clearWaveLines();
  if (!frames || frames.length === 0) return;

  if (REBUILD_ALL_SHAPES.has(shape)) {
    _rebuildAll(frames, false);
  } else {
    for (let i = 0; i < frames.length; i++) {
      const lines = _buildPerFrameLines(frames[i], i, false);
      for (const l of lines) { waveLines.push(l); scene.add(l); }
    }
    _updateOpacities();
  }
}

/**
 * Add a newly recorded frame.
 * For REBUILD_ALL shapes, pass allFrames to reconstruct the full geometry.
 * @param {Float32Array | { left: Float32Array, right: Float32Array }} frameData
 * @param {number} frameIndex
 * @param {Array|null} allFrames  required for REBUILD_ALL shapes
 */
export function addRecordedFrame(frameData, frameIndex, allFrames) {
  if (REBUILD_ALL_SHAPES.has(shape)) {
    _rebuildAll(allFrames, false);
    return;
  }

  // Per-frame additive shapes
  const lines = _buildPerFrameLines(frameData, frameIndex, false);
  for (const l of lines) { waveLines.push(l); scene.add(l); }
  _updateOpacities();
}

/**
 * Replace the live preview line.
 * @param {Float32Array | { left: Float32Array, right: Float32Array }} frameData
 * @param {Array|null}  allFrames  used by spiral for full-path preview
 * @param {number}      frameCount  number of recorded frames so far
 */
export function updateLiveLine(frameData, allFrames, frameCount = 0) {
  _disposeLine(liveLine);
  liveLine = null;

  const nextIndex = frameCount;

  if (shape === 'spiral') {
    if (allFrames && allFrames.length > 0) {
      const mono    = _toMono(frameData);
      const preview = [...allFrames, mono];
      liveLine = _buildSpiralFromData(preview, true);
      if (liveLine) scene.add(liveLine);
    }
    return;
  }

  // For other REBUILD_ALL shapes: no per-tick live rebuild; the recorded
  // state already updates at the recording rate.
  if (REBUILD_ALL_SHAPES.has(shape)) return;

  // Per-frame additive shapes: show a live preview of the next frame.
  if (shape === 'lissajous') {
    liveLine = _buildLissajousLine(frameData, nextIndex, true);
    if (liveLine) scene.add(liveLine);
    return;
  }

  if (shape === 'circular') {
    liveLine = _buildCircleLine(_toMono(frameData), nextIndex, true);
    if (liveLine) scene.add(liveLine);
    return;
  }

  if (shape === 'moire') {
    // Live moire: just show the first ring family
    const moireLines = _buildMoireLines(frameData, nextIndex, true);
    if (moireLines.length > 0) {
      liveLine = moireLines[0];
      scene.add(liveLine);
    }
    return;
  }

  // linear (default)
  liveLine = _buildLinearLine(_toMono(frameData), nextIndex, 0, true);
  if (liveLine) scene.add(liveLine);
}

/** Remove and dispose all wave lines and the live line. */
export function clearWaveLines() {
  waveLines.forEach(_disposeLine);
  waveLines = [];
  _disposeLine(liveLine);
  liveLine = null;
}

/**
 * Render imported G-code XY paths in the scene.
 * @param {Array<Array<{x:number,y:number}>>} pathsMm
 * @param {number} scale Optional scale multiplier (default 1.0)
 */
export function showImportedGCodePaths(pathsMm, scale) {
  clearWaveLines();
  if (!Array.isArray(pathsMm) || pathsMm.length === 0) return;

  const scaleVal = scale !== undefined ? scale : scaleFactor;
  let idx = 0;
  for (const path of pathsMm) {
    if (!Array.isArray(path) || path.length < 2) continue;

    const pos = new Float32Array(path.length * 3);
    for (let i = 0; i < path.length; i++) {
      const xMm = path[i].x;
      const yMm = path[i].y;
      pos[i * 3]     = ((xMm - CENTER_X_MM) / (PLOT_W_MM / 2)) * (SCENE_W / 2) * scaleVal;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = ((yMm - MARGIN_MM) / PLOT_H_MM) * SCENE_DEPTH * scaleVal;
    }

    const line = _makeLine(pos, idx++, false);
    waveLines.push(line);
    scene.add(line);
  }

  _positionCameraForShape('linear');
}

/** Call in rAF loop. */
export function render() {
  controls.update();
  renderer.render(scene, camera);
}

export function dispose() {
  window.removeEventListener('resize', _onResize);
  clearWaveLines();
  renderer.dispose();
}

// ---------------------------------------------------------------------------
// Scene projection
// ---------------------------------------------------------------------------

/**
 * Project all recorded wave lines through the current camera.
 * Returns an array of sub-paths; each sub-path is an array of
 * { nx, ny } NDC coordinates in [-1, +1].
 * Paths are automatically split at points that go behind the camera
 * or stray far outside the view frustum.
 */
export function getProjectedPaths() {
  if (!camera || waveLines.length === 0) return [];
  if (shape === 'landscape') return _getLandscapeProjectedPaths();
  if (shape === 'quantized') return _getQuantizedProjectedPaths();

  camera.updateMatrixWorld();

  const vpMatrix = new THREE.Matrix4();
  vpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vpMatrix.elements;

  const allPaths = [];

  for (const line of waveLines) {
    // Skip fill meshes (landscape shape) — they are occluders, not plotter paths
    if (line instanceof THREE.Mesh) continue;
    const attr = line.geometry.attributes.position;
    if (!attr) continue;

    const subPaths = [];
    let current = null;

    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const z = attr.getZ(i);

      const rx = e[0]*x + e[4]*y + e[8]*z  + e[12];
      const ry = e[1]*x + e[5]*y + e[9]*z  + e[13];
      const rw = e[3]*x + e[7]*y + e[11]*z + e[15];

      if (rw <= 0.001) {
        if (current && current.length > 1) subPaths.push(current);
        current = null;
        continue;
      }

      const nx = rx / rw;
      const ny = ry / rw;

      if (Math.abs(nx) > 2.0 || Math.abs(ny) > 2.0) {
        if (current && current.length > 1) subPaths.push(current);
        current = null;
        continue;
      }

      if (!current) current = [];
      current.push({ nx, ny });
    }

    if (current && current.length > 1) subPaths.push(current);
    allPaths.push(...subPaths);
  }

  return allPaths;
}

/**
 * Project the scene twice with camera offset left/right by iod/2,
 * returning separate path arrays for anaglyph G-code export.
 * @param {number} iod  inter-ocular distance in scene units (default 0.65)
 * @returns {{ leftPaths: Array, rightPaths: Array }}
 */
export function getStereoPaths(iod = 0.65) {
  if (!camera || waveLines.length === 0) return { leftPaths: [], rightPaths: [] };

  // Save original camera state
  const origPos = camera.position.clone();
  const origQuat = camera.quaternion.clone();

  // Compute right vector from current orientation
  const right = new THREE.Vector3();
  right.crossVectors(
    camera.getWorldDirection(new THREE.Vector3()),
    camera.up
  ).normalize();

  // -- Left eye: shift camera -iod/2 along right --
  camera.position.addScaledVector(right, -iod / 2);
  camera.updateMatrixWorld();
  const leftPaths = getProjectedPaths();

  // -- Right eye: shift camera +iod from left eye position (net +iod/2 from origin) --
  camera.position.addScaledVector(right, iod);
  camera.updateMatrixWorld();
  const rightPaths = getProjectedPaths();

  // Restore camera
  camera.position.copy(origPos);
  camera.quaternion.copy(origQuat);
  camera.updateMatrixWorld();

  return { leftPaths, rightPaths };
}

/**
 * Return the current camera position and orbit target so the caller can
 * embed them in a filename or header comment for later reproduction.
 * Values are rounded to two decimal places.
 */
export function getCameraState() {
  if (!camera) return null;
  const p = camera.position;
  const t = controls ? controls.target : new THREE.Vector3();
  const r = v => Math.round(v * 100) / 100;
  return {
    position: [r(p.x), r(p.y), r(p.z)],
    target:   [r(t.x), r(t.y), r(t.z)],
  };
}

/** Return the camera's viewport aspect ratio (width / height). */
export function getCameraAspect() {
  return camera ? camera.aspect : 1;
}

/**
 * Programmatically set the camera position and orbit target.
 * @param {[number,number,number]} position
 * @param {[number,number,number]} target
 */
/** Reset camera to the default position for the current shape. */
export function resetCamera() {
  _positionCameraForShape(shape);
}

export function setCameraState(position, target) {
  if (!camera || !controls) return;
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
}

// ---------------------------------------------------------------------------
// Central REBUILD_ALL dispatcher
// ---------------------------------------------------------------------------

function _rebuildAll(allFrames, isLive) {
  waveLines.forEach(_disposeLine);
  waveLines = [];
  if (!allFrames || allFrames.length === 0) return;

  switch (shape) {
    case 'spiral':       _rebuildSpiral(allFrames, isLive);       break;
    case 'terrain':      _rebuildTerrain(allFrames, isLive);      break;
    case 'harmonograph': _rebuildHarmonograph(allFrames, isLive); break;
    case 'landscape':    _rebuildLandscape(allFrames, isLive);    break;
    case 'heatmap':      _rebuildHeatmap(allFrames, isLive);      break;
    case 'quantized':    _rebuildQuantized(allFrames, isLive);    break;
  }
}

// ---------------------------------------------------------------------------
// Per-frame additive dispatcher
// ---------------------------------------------------------------------------

function _buildPerFrameLines(frameData, frameIndex, isLive) {
  switch (shape) {
    case 'circular':  {
      const l = _buildCircleLine(_toMono(frameData), frameIndex, isLive);
      return [l];
    }
    case 'lissajous': {
      const l = _buildLissajousLine(frameData, frameIndex, isLive);
      return l ? [l] : [];
    }
    case 'moire': {
      return _buildMoireLines(frameData, frameIndex, isLive);
    }
    default: {
      // linear (includes stereo)
      if (_isStereo(frameData)) {
        const lLine = _buildLinearLine(frameData.left,  frameIndex, 0, isLive);
        const rLine = _buildLinearLine(frameData.right, frameIndex, 1, isLive);
        return [lLine, rLine];
      }
      return [_buildLinearLine(frameData, frameIndex, 0, isLive)];
    }
  }
}

// ---------------------------------------------------------------------------
// Shape geometry builders — EXISTING
// ---------------------------------------------------------------------------

/**
 * Linear stacked wave.
 * X = sample index, Y = amplitude, Z = frame * spacing.
 */
function _buildLinearLine(data, frameIndex, channel, isLive) {
  const N = data.length;
  const pos = new Float32Array(N * 3);
  const zSpacing  = SCENE_DEPTH / Math.max(cfg.maxFrames - 1, 1);
  const stereoSep = 2.0;

  for (let i = 0; i < N; i++) {
    pos[i * 3]     = (i / (N - 1)) * SCENE_W - SCENE_W / 2;
    pos[i * 3 + 1] = data[i] * 4 * cfg.ampScale;
    pos[i * 3 + 2] = frameIndex * zSpacing + channel * stereoSep;
  }
  return _makeLine(pos, frameIndex, isLive);
}

/**
 * Concentric ring.
 * Radius = baseRadius ± amplitude. All on XZ plane (Y = 0).
 */
function _buildCircleLine(data, frameIndex, isLive) {
  const N         = data.length;
  const ringSpacing = (OUTER_R - INNER_R) / Math.max(cfg.maxFrames, 1);
  const baseRadius  = INNER_R + frameIndex * ringSpacing;
  const pos = new Float32Array((N + 1) * 3);

  for (let i = 0; i <= N; i++) {
    const si    = i % N;
    const angle = (si / N) * Math.PI * 2;
    const r     = baseRadius + data[si] * ringSpacing * 0.45 * cfg.ampScale;
    pos[i * 3]     = r * Math.cos(angle);
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = r * Math.sin(angle);
  }
  return _makeLine(pos, frameIndex, isLive);
}

/**
 * Spiral — one continuous line built from ALL recorded frames.
 */
function _buildSpiralFromData(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return null;

  const F = allFrames.length;
  const N = (allFrames[0] instanceof Float32Array) ? allFrames[0].length
                                                   : allFrames[0].left
                                                     ? allFrames[0].left.length
                                                     : 0;
  if (N === 0) return null;

  const total = F * N;
  const pos   = new Float32Array(total * 3);
  const ringSpacing = (OUTER_R - INNER_R) / Math.max(cfg.maxFrames, 1);

  for (let gi = 0; gi < total; gi++) {
    const fi  = Math.floor(gi / N);
    const si  = gi % N;
    const t   = gi / (total - 1);
    const angle = t * SPIRAL_TURNS * Math.PI * 2;
    const frame = allFrames[fi];
    const amp   = frame instanceof Float32Array ? frame[si]
                : frame.left ? frame.left[si] : 0;
    const r = INNER_R + t * (OUTER_R - INNER_R) + amp * ringSpacing * 0.45 * cfg.ampScale;
    pos[gi * 3]     = r * Math.cos(angle);
    pos[gi * 3 + 1] = 0;
    pos[gi * 3 + 2] = r * Math.sin(angle);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0x00d4ff);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: isLive ? 0.6 : 1.0 });
  return new THREE.Line(geo, mat);
}

function _rebuildSpiral(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;
  const line = _buildSpiralFromData(allFrames, isLive);
  if (line) { waveLines.push(line); scene.add(line); }
}

/**
 * Lissajous figure.
 * X = left (or mono) channel, Y = right channel, Z = small frame offset.
 */
function _buildLissajousLine(frameData, frameIndex, isLive) {
  let left, right;

  if (_isStereo(frameData)) {
    left  = frameData.left;
    right = frameData.right;
  } else {
    left  = frameData;
    const qShift = Math.floor(frameData.length / 4);
    right = new Float32Array(frameData.length);
    for (let i = 0; i < frameData.length; i++) {
      right[i] = frameData[(i + qShift) % frameData.length];
    }
  }

  const N   = left.length;
  const pos = new Float32Array((N + 1) * 3);
  const zOffset = frameIndex * 0.08;

  for (let i = 0; i < N; i++) {
    pos[i * 3]     = left[i]  * LISS_SCALE;
    pos[i * 3 + 1] = right[i] * LISS_SCALE;
    pos[i * 3 + 2] = zOffset;
  }
  // Close the curve: repeat first point
  pos[N * 3]     = left[0]  * LISS_SCALE;
  pos[N * 3 + 1] = right[0] * LISS_SCALE;
  pos[N * 3 + 2] = zOffset;
  return _makeLine(pos, frameIndex, isLive);
}

// ---------------------------------------------------------------------------
// Shape geometry builders — NEW
// ---------------------------------------------------------------------------

/**
 * Terrain — Joy Division horizon-occlusion.
 * Frames are processed front-to-back; a horizon buffer masks hidden portions.
 */
function _rebuildTerrain(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const F = allFrames.length;
  const N = _toMono(allFrames[0]).length;
  const zSpacing = SCENE_DEPTH / Math.max(cfg.maxFrames - 1, 1);

  // Pre-compute every Y value so both horizontal and perpendicular passes share data.
  const yValues = [];
  for (let fi = 0; fi < F; fi++) {
    const data = _toMono(allFrames[fi]);
    const ys   = new Float32Array(N);
    for (let i = 0; i < N; i++) ys[i] = data[i] * 4 * cfg.ampScale;
    yValues.push(ys);
  }

  // ---- Screen-space (perspective-correct) horizon via camera VP matrix ----
  // Project each world point through the camera to get NDC coordinates.
  // The horizon buffer stores the highest NDC-Y seen so far at each screen-X bucket,
  // which respects the camera's vanishing point instead of flat world-Y comparisons.
  camera.updateMatrixWorld();
  const vp = new THREE.Matrix4();
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vp.elements;

  function projectPt(x, y, z) {
    const rx = e[0]*x + e[4]*y + e[8]*z  + e[12];
    const ry = e[1]*x + e[5]*y + e[9]*z  + e[13];
    const rw = e[3]*x + e[7]*y + e[11]*z + e[15];
    if (rw <= 0.001) return null;
    return { nx: rx / rw, ny: ry / rw };
  }

  const N_BUCKETS = 512;
  // Map NDC X [-1, +1] to bucket indices
  function ndcToB(nx) {
    return Math.max(0, Math.min(N_BUCKETS - 1, Math.floor((nx + 1) * 0.5 * N_BUCKETS)));
  }

  // ---- HORIZONTAL LINES (wave profiles, perspective-correct horizon-masked) ----
  // Process newest→oldest so front frames set the horizon for back frames.
  const horizonNY = new Float32Array(N_BUCKETS).fill(-Infinity);

  for (let fi = F - 1; fi >= 0; fi--) {
    const ys = yValues[fi];
    const z  = fi * zSpacing;
    let segPts = null;

    for (let i = 0; i < N; i++) {
      const x  = (i / (N - 1)) * SCENE_W - SCENE_W / 2;
      const pt = projectPt(x, ys[i], z);
      const visible = pt && pt.ny >= horizonNY[ndcToB(pt.nx)];
      if (visible) {
        if (!segPts) segPts = [];
        segPts.push(x, ys[i], z);
      } else {
        if (segPts && segPts.length >= 6) {
          const line = _makeLine(new Float32Array(segPts), fi, isLive);
          waveLines.push(line);
          scene.add(line);
        }
        segPts = null;
      }
    }
    if (segPts && segPts.length >= 6) {
      const line = _makeLine(new Float32Array(segPts), fi, isLive);
      waveLines.push(line);
      scene.add(line);
    }

    // Update horizon: raise NDC-Y for each projected sample, interpolating between neighbours.
    let prevPt = null;
    for (let i = 0; i < N; i++) {
      const x  = (i / (N - 1)) * SCENE_W - SCENE_W / 2;
      const pt = projectPt(x, ys[i], z);
      if (!pt) { prevPt = null; continue; }
      const b = ndcToB(pt.nx);
      if (pt.ny > horizonNY[b]) horizonNY[b] = pt.ny;
      if (prevPt) {
        const b0 = ndcToB(prevPt.nx), b1 = b;
        const bMin = Math.min(b0, b1), bMax = Math.max(b0, b1);
        for (let bi = bMin + 1; bi < bMax; bi++) {
          const t  = (bi - bMin) / (bMax - bMin);
          const iy = prevPt.ny + t * (pt.ny - prevPt.ny);
          if (iy > horizonNY[bi]) horizonNY[bi] = iy;
        }
      }
      prevPt = pt;
    }
  }

  // ---- PERPENDICULAR LINES (cross-sections along Z, perspective-correct horizon per column) ----
  const N_STEP = Math.max(4, Math.min(64, Math.round(N / Math.max(F, 4))));

  for (let si = 0; si < N; si += N_STEP) {
    const x = (si / (N - 1)) * SCENE_W - SCENE_W / 2;
    // Per-column horizon in NDC-Y.
    let colHorizonNY = -Infinity;
    let segPts = null;

    // Walk newest→oldest — front crests set the horizon for back columns.
    for (let fi = F - 1; fi >= 0; fi--) {
      const y  = yValues[fi][si];
      const z  = fi * zSpacing;
      const pt = projectPt(x, y, z);
      const ny = pt ? pt.ny : -Infinity;

      if (ny >= colHorizonNY) {
        if (!segPts) segPts = [];
        segPts.push(x, y, z);
        if (ny > colHorizonNY) colHorizonNY = ny;
      } else {
        if (segPts && segPts.length >= 6) _emitTerrainPerp(segPts, isLive);
        segPts = null;
      }
    }
    if (segPts && segPts.length >= 6) _emitTerrainPerp(segPts, isLive);
  }
}

/** Emit one perpendicular terrain segment with a slightly cooler tint. */
function _emitTerrainPerp(pts, isLive) {
  const pos = new Float32Array(pts);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0x4488bb);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: isLive ? 0.4 : 0.45 });
  const line  = new THREE.Line(geo, mat);
  waveLines.push(line);
  scene.add(line);
}

/**
 * Harmonograph — two-pendulum parametric curve with damping.
 * Frequency ratios derived from dominant DFT bins of the averaged spectrum.
 */
function _rebuildHarmonograph(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const avg   = _avgFrames(allFrames);
  const comps = _dftTopK(avg, 3);

  // Map top DFT bins to pendulum frequencies (scale to small integer ratios)
  const rawF1 = comps[0] ? comps[0].bin : 5;
  const rawF2 = comps[1] ? comps[1].bin : 8;
  const rawF3 = comps[2] ? comps[2].bin : 13;

  // Normalise to 1..6 range
  const f1 = 1 + (rawF1 % 5);
  const f2 = 1 + (rawF2 % 5);
  const f3 = 1 + (rawF3 % 4);
  const ph1 = comps[0]?.phase ?? 0;
  const ph2 = comps[1]?.phase ?? Math.PI / 4;
  const ph3 = comps[2]?.phase ?? Math.PI / 2;

  const rms = _rmsOf(avg);
  const A   = 5 + rms * 4 * cfg.ampScale;
  const B   = 5 + rms * 3 * cfg.ampScale;
  const C   = 2 + rms * 2 * cfg.ampScale;
  const d   = 0.0015 + (1 - Math.min(rms, 0.9)) * 0.003;

  const STEPS = 2048;
  const T_MAX = 10 * Math.PI;
  const pos   = new Float32Array(STEPS * 3);

  for (let i = 0; i < STEPS; i++) {
    const t     = (i / (STEPS - 1)) * T_MAX;
    const decay = Math.exp(-d * t);
    pos[i * 3]     = A * Math.sin(f1 * t + ph1) * decay;
    pos[i * 3 + 1] = C * Math.sin(f3 * t + ph3) * Math.exp(-d * 1.2 * t);
    pos[i * 3 + 2] = B * Math.sin(f2 * t + ph2) * decay;
  }

  const geo   = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0xff6600);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: isLive ? 0.6 : 0.9 });
  const line  = new THREE.Line(geo, mat);
  waveLines.push(line);
  scene.add(line);
}

/**
 * Landscape — Joy Division *Unknown Pleasures* style.
 * Back-to-front pass: each frame gets an opaque fill polygon (background colour)
 * that occludes geometry behind it, then a bright wave-line stroke on top.
 * The result is clean horizon gaps between ridges.
 * THREE.Mesh fills are skipped by getProjectedPaths so they don't appear in G-code.
 */
function _rebuildLandscape(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const F        = allFrames.length;
  const N        = _toMono(allFrames[0]).length;
  const zSpacing = SCENE_DEPTH / Math.max(cfg.maxFrames - 1, 1);
  const FLOOR_Y  = -10;
  const SUB      = 64;   // subsampled vertices for fill polygon (performance)

  // Pre-compute Y values — shared by fill/line pass and perpendicular pass.
  const yValues = [];
  for (let fi = 0; fi < F; fi++) {
    const data = _toMono(allFrames[fi]);
    const ys   = new Float32Array(N);
    for (let i = 0; i < N; i++) ys[i] = data[i] * 4 * cfg.ampScale;
    yValues.push(ys);
  }

  // ---- HORIZONTAL PASS: fill polygon + wave stroke per frame ----
  // Oldest frame first (back-to-front) so nearer fills occlude geometry behind.
  for (let fi = 0; fi < F; fi++) {
    const ys = yValues[fi];
    const z  = fi * zSpacing;

    // Fill polygon: bottom-left → wave crest (subsampled) → bottom-right
    const sh = new THREE.Shape();
    sh.moveTo(-SCENE_W / 2, FLOOR_Y);
    for (let s = 0; s < SUB; s++) {
      const si = Math.floor(s * (N - 1) / (SUB - 1));
      sh.lineTo((si / (N - 1)) * SCENE_W - SCENE_W / 2, ys[si]);
    }
    sh.lineTo(SCENE_W / 2, FLOOR_Y);

    const fillGeo = new THREE.ShapeGeometry(sh);
    const fillMat = new THREE.MeshBasicMaterial({
      color:               0x0a0a0a,
      polygonOffset:       true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits:  1,
      side:                THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(fillGeo, fillMat);
    mesh.position.z = z;
    waveLines.push(mesh);
    scene.add(mesh);

    // Wave stroke (full resolution) on top of fill
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (i / (N - 1)) * SCENE_W - SCENE_W / 2;
      pos[i * 3 + 1] = ys[i];
      pos[i * 3 + 2] = z;
    }
    const line = _makeLine(pos, fi, isLive);
    waveLines.push(line);
    scene.add(line);
  }

  // ---- CIRCLE PASS: amplitude-sized circles at grid intersections ----
  // Replace perpendicular connecting lines with circles in the XY plane (vertical),
  // centered at each sample's amplitude height. Radius ∝ |amplitude|.
  const N_STEP = Math.max(4, Math.min(64, Math.round(N / Math.max(F, 4))));
  const CIRCLE_SEGS_L = 20;
  const maxCircleR = Math.min(zSpacing, (SCENE_W / N) * N_STEP) * 0.4;
  const circleVerts = [];

  for (let si = 0; si < N; si += N_STEP) {
    const x = (si / (N - 1)) * SCENE_W - SCENE_W / 2;
    for (let fi = 0; fi < F; fi++) {
      const y = yValues[fi][si];
      const z = fi * zSpacing;
      const r = Math.abs(y) / (4 * cfg.ampScale || 1) * maxCircleR;
      if (r < maxCircleR * 0.03) continue;  // skip near-zero

      // Circle in XY plane at this Z
      for (let s = 0; s < CIRCLE_SEGS_L; s++) {
        const a0 = (s / CIRCLE_SEGS_L) * Math.PI * 2;
        const a1 = ((s + 1) / CIRCLE_SEGS_L) * Math.PI * 2;
        circleVerts.push(
          x + r * Math.cos(a0), y + r * Math.sin(a0), z,
          x + r * Math.cos(a1), y + r * Math.sin(a1), z
        );
      }
    }
  }

  if (circleVerts.length > 0) {
    const cPos  = new Float32Array(circleVerts);
    const cGeo  = new THREE.BufferGeometry();
    cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
    const cColor = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0x5599cc);
    const cMat   = new THREE.LineBasicMaterial({ color: cColor, transparent: true, opacity: isLive ? 0.3 : 0.5 });
    const cSegs  = new THREE.LineSegments(cGeo, cMat);
    waveLines.push(cSegs);
    scene.add(cSegs);
  }
}

/** Emit one perpendicular landscape segment (dimmer, cooler than horizontal lines). */
function _emitLandscapePerp(pts, isLive) {
  const pos = new Float32Array(pts);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0x5599cc);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: isLive ? 0.3 : 0.4 });
  const line  = new THREE.Line(geo, mat);
  waveLines.push(line);
  scene.add(line);
}

/**
 * Quantized Noise — Joy Division ridges where each wave's amplitude is snapped
 * to discrete bands (quantized). Points below the threshold are snapped to y=0.
 * The largest sky-gap regions between consecutive ridges are filled with colored
 * accent hatching, both in the 3D preview (THREE.Mesh) and as exported hatch
 * lines (THREE.Line with userData.isHatch = true).
 */
function _rebuildQuantized(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const F          = allFrames.length;
  const N          = _toMono(allFrames[0]).length;
  const zSpacing   = SCENE_DEPTH / Math.max(cfg.maxFrames - 1, 1);
  const FLOOR_Y    = -8;
  const SUB        = 64;
  const N_DIRS     = 8;
  const N_COLORS   = 3;
  const HATCH_STEP = 0.3;
  const PALETTE    = ['#e8732a', '#c45fa0', '#2ab8c4'];
  const QUANT_STEP = (4 * cfg.ampScale) / N_DIRS;
  const dxSub      = SCENE_W / (SUB - 1);

  // Pre-compute quantized Y values (full resolution + subsampled)
  const yRaw = [];
  const ySub = [];
  for (let fi = 0; fi < F; fi++) {
    const data = _toMono(allFrames[fi]);
    const ys   = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const raw = data[i] * 4 * cfg.ampScale;
      const q   = Math.round(raw / QUANT_STEP) * QUANT_STEP;
      ys[i]     = Math.abs(raw) < QUANT_STEP ? 0 : q;
    }
    yRaw.push(ys);
    const sub = new Float32Array(SUB);
    for (let s = 0; s < SUB; s++) {
      sub[s] = ys[Math.floor(s * (N - 1) / (SUB - 1))];
    }
    ySub.push(sub);
  }

  // Step 1: occluder fill polygon + quantized wave stroke per frame (back-to-front)
  for (let fi = 0; fi < F; fi++) {
    const ys = yRaw[fi];
    const z  = fi * zSpacing;

    const sh = new THREE.Shape();
    sh.moveTo(-SCENE_W / 2, FLOOR_Y);
    for (let s = 0; s < SUB; s++) {
      const si = Math.floor(s * (N - 1) / (SUB - 1));
      sh.lineTo((si / (N - 1)) * SCENE_W - SCENE_W / 2, ys[si]);
    }
    sh.lineTo(SCENE_W / 2, FLOOR_Y);

    const fillGeo = new THREE.ShapeGeometry(sh);
    const fillMat = new THREE.MeshBasicMaterial({
      color:               0x0a0a0a,
      polygonOffset:       true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits:  1,
      side:                THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(fillGeo, fillMat);
    mesh.position.z = z;
    waveLines.push(mesh);
    scene.add(mesh);

    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (i / (N - 1)) * SCENE_W - SCENE_W / 2;
      pos[i * 3 + 1] = ys[i];
      pos[i * 3 + 2] = z;
    }
    const line = _makeLine(pos, fi, isLive);
    waveLines.push(line);
    scene.add(line);
  }

  // Step 2: compute gap areas between adjacent frame pairs, pick top-N
  const gapAreas = [];
  for (let fi = 0; fi < F - 1; fi++) {
    const yB = ySub[fi];
    const yF = ySub[fi + 1];
    let area = 0;
    for (let s = 0; s < SUB; s++) area += Math.max(0, yB[s] - yF[s]);
    gapAreas.push({ fi, area: area * dxSub });
  }
  gapAreas.sort((a, b) => b.area - a.area);

  // Step 3: colored fills + hatch lines for top-N gap regions
  const topGaps = gapAreas.slice(0, N_COLORS);
  for (let k = 0; k < topGaps.length; k++) {
    const { fi } = topGaps[k];
    if (fi + 1 >= F) continue;
    const color = new THREE.Color(PALETTE[k]);
    const yB    = ySub[fi];
    const yF    = ySub[fi + 1];
    const z     = fi * zSpacing;

    const xOf = (s) => s * dxSub - SCENE_W / 2;

    // Colored fill meshes (3D visual, one per contiguous gap span)
    const emitFillSpan = (start, end) => {
      if (end - start < 1) return;
      const sh = new THREE.Shape();
      sh.moveTo(xOf(start), yF[start]);
      for (let s = start; s <= end; s++) sh.lineTo(xOf(s), yF[s]);
      for (let s = end; s >= start; s--) sh.lineTo(xOf(s), yB[s]);
      sh.closePath();
      const shGeo = new THREE.ShapeGeometry(sh);
      const shMat = new THREE.MeshBasicMaterial({
        color,
        transparent:         true,
        opacity:             0.4,
        polygonOffset:       true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits:  -1,
        side:                THREE.DoubleSide,
      });
      const m = new THREE.Mesh(shGeo, shMat);
      m.position.z = z;
      waveLines.push(m);
      scene.add(m);
    };

    let inSpan = false, spanStart = 0;
    for (let s = 0; s < SUB; s++) {
      const hasGap = yB[s] > yF[s];
      if (hasGap && !inSpan)  { inSpan = true; spanStart = s; }
      else if (!hasGap && inSpan) { emitFillSpan(spanStart, s - 1); inSpan = false; }
    }
    if (inSpan) emitFillSpan(spanStart, SUB - 1);

    // Hatch lines (exported to G-code)
    let yMin = Infinity, yMax = -Infinity;
    for (let s = 0; s < SUB; s++) {
      if (yF[s] < yMin) yMin = yF[s];
      if (yB[s] > yMax) yMax = yB[s];
    }

    const emitHatch = (x1, x2, y_h) => {
      if (x2 <= x1) return;
      const hPos = new Float32Array([x1, y_h, z, x2, y_h, z]);
      const hGeo = new THREE.BufferGeometry();
      hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
      const hMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(PALETTE[k]),
        transparent: true,
        opacity:     0.5,
      });
      const hLine = new THREE.Line(hGeo, hMat);
      hLine.userData.isHatch = true;
      waveLines.push(hLine);
      scene.add(hLine);
    };

    for (let y_h = yMin; y_h <= yMax + 1e-6; y_h += HATCH_STEP) {
      let inHatch = false, hatchX0 = 0;
      for (let s = 0; s < SUB; s++) {
        const inGap = y_h >= yF[s] && y_h <= yB[s];
        if (inGap && !inHatch)  { inHatch = true; hatchX0 = xOf(s); }
        else if (!inGap && inHatch) { emitHatch(hatchX0, xOf(s - 1), y_h); inHatch = false; }
      }
      if (inHatch) emitHatch(hatchX0, xOf(SUB - 1), y_h);
    }
  }
}

/**
 * Moiré — two offset concentric ring families per frame.
 * The second family drifts based on frame index × RMS amplitude.
 */
function _buildMoireLines(frameData, frameIndex, isLive) {
  const RINGS    = 10;
  const RING_PTS = 64;
  const mono     = _toMono(frameData);
  const avgAmp   = _rmsOf(mono);

  const dx = avgAmp * 2.5 * Math.cos(frameIndex * 0.28);
  const dz = avgAmp * 2.5 * Math.sin(frameIndex * 0.28);

  const lines = [];

  for (let r = 1; r <= RINGS; r++) {
    const radius = r * OUTER_R / RINGS;

    // Family A — centred at origin
    const posA = new Float32Array((RING_PTS + 1) * 3);
    for (let i = 0; i <= RING_PTS; i++) {
      const a = (i / RING_PTS) * Math.PI * 2;
      posA[i*3] = radius * Math.cos(a);
      posA[i*3+1] = 0;
      posA[i*3+2] = radius * Math.sin(a);
    }
    const lA = _makeLine(posA, frameIndex, isLive);
    lines.push(lA);

    // Family B — offset
    const posB = new Float32Array((RING_PTS + 1) * 3);
    for (let i = 0; i <= RING_PTS; i++) {
      const a = (i / RING_PTS) * Math.PI * 2;
      posB[i*3] = dx + radius * Math.cos(a);
      posB[i*3+1] = 0;
      posB[i*3+2] = dz + radius * Math.sin(a);
    }
    const lB = _makeLine(posB, frameIndex + 0.5, isLive);
    lines.push(lB);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Helpers — existing
// ---------------------------------------------------------------------------

/**
 * Landscape-specific projection: applies screen-space horizon masking so that
 * only the visible (un-occluded) portions of each wave line are exported.
 * Wave lines are processed front-to-back; each line's projected crest updates
 * the horizon buffer, and only points above the running horizon are emitted.
 */
function _getLandscapeProjectedPaths() {
  camera.updateMatrixWorld();
  const vpMatrix = new THREE.Matrix4();
  vpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vpMatrix.elements;

  // 1024-bucket horizon across NDC X [-2, +2]
  const N_BUCKETS = 1024;
  const horizon   = new Float32Array(N_BUCKETS).fill(-Infinity);

  function ndcToB(nx) {
    return Math.max(0, Math.min(N_BUCKETS - 1, Math.floor((nx + 2) / 4 * N_BUCKETS)));
  }

  function project(x, y, z) {
    const rx = e[0]*x + e[4]*y + e[8]*z  + e[12];
    const ry = e[1]*x + e[5]*y + e[9]*z  + e[13];
    const rw = e[3]*x + e[7]*y + e[11]*z + e[15];
    if (rw <= 0.001) return null;
    return { nx: rx / rw, ny: ry / rw };
  }

  // Collect wave lines only (skip THREE.Mesh fills and THREE.LineSegments circles)
  const lineObjects = waveLines.filter(l => l.type === 'Line');
  if (lineObjects.length === 0) return [];

  const allPaths = [];

  // Process nearest-first (reverse storage order) so closer ridges set the horizon first
  for (let li = lineObjects.length - 1; li >= 0; li--) {
    const line = lineObjects[li];
    const attr = line.geometry.attributes.position;
    if (!attr) continue;

    // Project all vertices
    const pts = [];
    for (let i = 0; i < attr.count; i++) {
      pts.push(project(attr.getX(i), attr.getY(i), attr.getZ(i)));
    }

    // Emit sub-paths: only points above the current horizon
    const subPaths = [];
    let current = null;

    for (const pt of pts) {
      if (!pt || Math.abs(pt.nx) > 2.0 || Math.abs(pt.ny) > 2.0) {
        if (current && current.length > 1) subPaths.push(current);
        current = null;
        continue;
      }
      if (pt.ny >= horizon[ndcToB(pt.nx)]) {
        if (!current) current = [];
        current.push({ nx: pt.nx, ny: pt.ny });
      } else {
        if (current && current.length > 1) subPaths.push(current);
        current = null;
      }
    }
    if (current && current.length > 1) subPaths.push(current);
    allPaths.push(...subPaths);

    // Update horizon with this line's crest; interpolate between consecutive points
    // to avoid gaps when projected points are far apart in bucket space.
    let prevPt = null;
    for (const pt of pts) {
      if (!pt || Math.abs(pt.nx) > 2.0 || Math.abs(pt.ny) > 2.0) {
        prevPt = null;
        continue;
      }
      const b = ndcToB(pt.nx);
      if (pt.ny > horizon[b]) horizon[b] = pt.ny;

      if (prevPt) {
        const b0 = ndcToB(prevPt.nx), b1 = b;
        const bMin = Math.min(b0, b1), bMax = Math.max(b0, b1);
        for (let bi = bMin + 1; bi < bMax; bi++) {
          const t  = (bi - bMin) / (bMax - bMin);
          const iy = prevPt.ny + t * (pt.ny - prevPt.ny);
          if (iy > horizon[bi]) horizon[bi] = iy;
        }
      }
      prevPt = pt;
    }
  }

  return allPaths;
}

/**
 * Quantized-specific projection: applies horizon masking to wave strokes
 * (same algorithm as landscape) and naive projection to hatch lines.
 */
function _getQuantizedProjectedPaths() {
  camera.updateMatrixWorld();
  const vpMatrix = new THREE.Matrix4();
  vpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vpMatrix.elements;

  const N_BUCKETS = 1024;
  const horizon   = new Float32Array(N_BUCKETS).fill(-Infinity);

  function ndcToB(nx) {
    return Math.max(0, Math.min(N_BUCKETS - 1, Math.floor((nx + 2) / 4 * N_BUCKETS)));
  }

  function project(x, y, z) {
    const rx = e[0]*x + e[4]*y + e[8]*z  + e[12];
    const ry = e[1]*x + e[5]*y + e[9]*z  + e[13];
    const rw = e[3]*x + e[7]*y + e[11]*z + e[15];
    if (rw <= 0.001) return null;
    return { nx: rx / rw, ny: ry / rw };
  }

  const allPaths = [];

  // Wave strokes: horizon-masked, processed nearest-first
  const waveObjs = waveLines.filter(l => l.type === 'Line' && !l.userData.isHatch);
  for (let li = waveObjs.length - 1; li >= 0; li--) {
    const line = waveObjs[li];
    const attr = line.geometry.attributes.position;
    if (!attr) continue;

    const pts = [];
    for (let i = 0; i < attr.count; i++) {
      pts.push(project(attr.getX(i), attr.getY(i), attr.getZ(i)));
    }

    const subPaths = [];
    let cur = null;

    for (const pt of pts) {
      if (!pt || Math.abs(pt.nx) > 2.0 || Math.abs(pt.ny) > 2.0) {
        if (cur && cur.length > 1) subPaths.push(cur);
        cur = null;
        continue;
      }
      if (pt.ny >= horizon[ndcToB(pt.nx)]) {
        if (!cur) cur = [];
        cur.push({ nx: pt.nx, ny: pt.ny });
      } else {
        if (cur && cur.length > 1) subPaths.push(cur);
        cur = null;
      }
    }
    if (cur && cur.length > 1) subPaths.push(cur);
    allPaths.push(...subPaths);

    // Update horizon with interpolation between consecutive projected points
    let prevPt = null;
    for (const pt of pts) {
      if (!pt || Math.abs(pt.nx) > 2.0 || Math.abs(pt.ny) > 2.0) { prevPt = null; continue; }
      const b = ndcToB(pt.nx);
      if (pt.ny > horizon[b]) horizon[b] = pt.ny;
      if (prevPt) {
        const b0 = ndcToB(prevPt.nx), b1 = b;
        const bMin = Math.min(b0, b1), bMax = Math.max(b0, b1);
        for (let bi = bMin + 1; bi < bMax; bi++) {
          const t  = (bi - bMin) / (bMax - bMin);
          const iy = prevPt.ny + t * (pt.ny - prevPt.ny);
          if (iy > horizon[bi]) horizon[bi] = iy;
        }
      }
      prevPt = pt;
    }
  }

  // Hatch lines: naive projection (already clipped to gap region)
  const hatchObjs = waveLines.filter(l => l.userData.isHatch === true);
  for (const line of hatchObjs) {
    const attr = line.geometry.attributes.position;
    if (!attr || attr.count < 2) continue;
    const path = [];
    for (let i = 0; i < attr.count; i++) {
      const pt = project(attr.getX(i), attr.getY(i), attr.getZ(i));
      if (!pt) break;
      path.push({ nx: pt.nx, ny: pt.ny });
    }
    if (path.length >= 2) allPaths.push(path);
  }

  return allPaths;
}

/**
 * Heatmap (spectrogram) — frequency bins × frames grid with cross-hatch density.
 * Lies flat on the XZ plane (Y=0). Cell fill density proportional to amplitude.
 */
function _rebuildHeatmap(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const F    = allFrames.length;
  const raw0 = _toMono(allFrames[0]);
  const N    = raw0.length;
  const COLS = Math.min(N, 48);

  const cellW    = SCENE_W / COLS;
  const zSpacing = SCENE_DEPTH / Math.max(cfg.maxFrames - 1, 1);
  const cellH    = zSpacing;
  const CIRCLE_SEGS = 24;  // segments per circle polygon

  // Subsample each frame into COLS bins and find global max for normalization.
  const grid = [];
  let globalMax = 0;
  for (let fi = 0; fi < F; fi++) {
    const data = _toMono(allFrames[fi]);
    const row  = new Float32Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const lo = Math.floor(c * N / COLS);
      const hi = Math.floor((c + 1) * N / COLS);
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += Math.abs(data[i]);
      row[c] = sum / Math.max(hi - lo, 1);
    }
    grid.push(row);
    for (let c = 0; c < COLS; c++) {
      if (row[c] > globalMax) globalMax = row[c];
    }
  }
  if (globalMax < 1e-6) globalMax = 1;

  const maxR  = Math.min(cellW, cellH) * 0.45;  // max circle radius (fits inside cell)
  const gridX = -SCENE_W / 2;

  for (let fi = 0; fi < F; fi++) {
    const row = grid[fi];
    const xShift = (fi % 2) * cellW * 0.5;  // honeycomb: odd rows offset by half cell
    for (let c = 0; c < COLS; c++) {
      const norm = row[c] / globalMax;
      if (norm < 0.02) continue;  // skip near-silent cells

      const r   = norm * maxR;
      const ccx = gridX + (c + 0.5) * cellW + xShift;
      const ccz = fi * cellH + cellH * 0.5;

      // Each circle as a closed THREE.Line (CIRCLE_SEGS+1 vertices, last = first)
      const pos = new Float32Array((CIRCLE_SEGS + 1) * 3);
      for (let s = 0; s <= CIRCLE_SEGS; s++) {
        const a = (s / CIRCLE_SEGS) * Math.PI * 2;
        pos[s * 3]     = ccx + r * Math.cos(a);
        pos[s * 3 + 1] = 0;
        pos[s * 3 + 2] = ccz + r * Math.sin(a);
      }
      const line = _makeLine(pos, fi * COLS + c, isLive);
      waveLines.push(line);
      scene.add(line);
    }
  }
}


function _makeLine(positions, frameIndex, isLive) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const color = isLive ? new THREE.Color(0xffffff) : _frameColor(frameIndex, cfg.maxFrames);
  const mat   = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: isLive ? 1.0 : 0.7,
  });
  return new THREE.Line(geo, mat);
}

function _frameColor(idx, total) {
  const t   = total > 1 ? idx / (total - 1) : 1;
  const hue = 220 - t * 60;
  return new THREE.Color().setHSL(hue / 360, 0.7 + t * 0.1, 0.45 + t * 0.15);
}

function _updateOpacities() {
  const n = waveLines.length;
  waveLines.forEach((line, i) => {
    line.material.opacity = 0.15 + 0.85 * (i / Math.max(n - 1, 1));
  });
}

function _disposeLine(line) {
  if (!line) return;
  scene.remove(line);
  line.geometry.dispose();
  line.material.dispose();
}

function _isStereo(data) {
  return data && !(data instanceof Float32Array) && data.left instanceof Float32Array;
}

function _toMono(data) {
  return _isStereo(data) ? data.left : data;
}

// ---------------------------------------------------------------------------
// Helpers — new
// ---------------------------------------------------------------------------

/** Element-wise average of all frames (converted to mono). */
function _avgFrames(allFrames) {
  const mono0 = _toMono(allFrames[0]);
  const N   = mono0.length;
  const out = new Float32Array(N);
  for (const f of allFrames) {
    const m = _toMono(f);
    for (let i = 0; i < N; i++) out[i] += m[i];
  }
  const inv = 1 / allFrames.length;
  for (let i = 0; i < N; i++) out[i] *= inv;
  return out;
}

/** DFT top-K components (signal sub-sampled to 256 pts for speed). */
function _dftTopK(signal, K) {
  const NS  = 256;
  const sub = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    sub[i] = signal[Math.floor(i * signal.length / NS)];
  }

  const comps = [];
  for (let k = 1; k < NS / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < NS; n++) {
      const angle = -2 * Math.PI * k * n / NS;
      re += sub[n] * Math.cos(angle);
      im += sub[n] * Math.sin(angle);
    }
    comps.push({ bin: k, amp: Math.sqrt(re*re + im*im) / NS, phase: Math.atan2(im, re) });
  }
  comps.sort((a, b) => b.amp - a.amp);
  return comps.slice(0, K);
}

/** RMS of a Float32Array. */
function _rmsOf(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

// ---------------------------------------------------------------------------
// Camera & scene setup
// ---------------------------------------------------------------------------

function _positionCameraForShape(s) {
  if (!camera) return;

  const positions = {
    linear:       { pos: [0,  8, 28],  lookAt: [0, 0, 10] },
    circular:     { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    spiral:       { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    lissajous:    { pos: [0,  0, 22],  lookAt: [0, 0,  0] },
    terrain:      { pos: [0,  8, 28],  lookAt: [0, 0, 10] },
    harmonograph: { pos: [0, 12, 22],  lookAt: [0, 0,  0] },
    moire:        { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    landscape:    { pos: [0,  6, 28],  lookAt: [0, 1, 10] },
    heatmap:      { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    quantized:    { pos: [0,  6, 28],  lookAt: [0, 1, 10] },
  };
  const { pos, lookAt } = positions[s] || positions.linear;
  camera.position.set(...pos);
  camera.lookAt(...lookAt);
  controls.target.set(...lookAt);
  controls.update();
}

function _buildGridAndAxes() {
  const grid = new THREE.GridHelper(SCENE_W, 10, 0x1a1a1a, 0x141414);
  grid.position.set(0, -0.5, SCENE_DEPTH / 2);
  scene.add(grid);

  const axDefs = [
    { dir: new THREE.Vector3(10, 0, 0),  color: 0x552222 },
    { dir: new THREE.Vector3(0, 5, 0),   color: 0x225522 },
    { dir: new THREE.Vector3(0, 0, 20),  color: 0x222255 },
  ];
  axDefs.forEach(({ dir, color }) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir]);
    scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })));
  });
}

function _onResize() {
  const canvas = renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
