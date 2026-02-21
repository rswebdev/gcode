/**
 * visualizer.js
 * Three.js 3D scene. Supports twelve shapes:
 *   linear      — stacked wave lines (Joy Division)
 *   circular    — concentric amplitude rings on the XZ plane
 *   spiral      — one continuous spiral, rebuilt on each new frame
 *   lissajous   — L-channel vs R-channel scatter/trace
 *   phyllotaxis — golden-angle dot / line spiral, amplitude modulates radius
 *   tube        — audio-modulated helix tube with rib cross-sections
 *   terrain     — horizon-masked Joy Division (painters-algorithm occlusion)
 *   harmonograph— two-pendulum Lissajous with damping, driven by dominant FFT bins
 *   flowfield   — streamlines through an FFT-derived 2-D vector field
 *   epicycles   — DFT epicycle arm snapshot per frame, layered in Z
 *   chladni     — Chladni nodal pattern zero-crossings driven by dominant frequency
 *   moire       — two offset concentric ring families per frame
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

// Golden angle for phyllotaxis
const GOLDEN_ANGLE  = Math.PI * (3 - Math.sqrt(5));

// Helix parameters for tube shape
const R_HELIX  = 4;
const H_HELIX  = 12;
const RIB_SEGS = 8;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let renderer, camera, scene, controls;
let waveLines = [];        // recorded frame lines / segments / points
let liveLine  = null;      // real-time preview line
let shape     = 'linear';
let cfg       = { ampScale: 2.0, maxFrames: 64 };

// ---------------------------------------------------------------------------
// Public: shape sets
// REBUILD_ALL_SHAPES reconstruct their full geometry from all frames each time
// a new frame is added. Per-frame shapes append one (or more) lines.
// ---------------------------------------------------------------------------
export const REBUILD_ALL_SHAPES = new Set([
  'spiral', 'phyllotaxis', 'tube', 'flowfield', 'terrain', 'harmonograph', 'chladni',
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
 * @param {'linear'|'circular'|'spiral'|'lissajous'|'phyllotaxis'|'tube'|'terrain'|'harmonograph'|'flowfield'|'epicycles'|'chladni'|'moire'} newShape
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

  if (shape === 'epicycles') {
    liveLine = _buildEpicyclesLine(frameData, nextIndex, true);
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

  camera.updateMatrixWorld();

  const vpMatrix = new THREE.Matrix4();
  vpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vpMatrix.elements;

  const allPaths = [];

  for (const line of waveLines) {
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

// ---------------------------------------------------------------------------
// Central REBUILD_ALL dispatcher
// ---------------------------------------------------------------------------

function _rebuildAll(allFrames, isLive) {
  waveLines.forEach(_disposeLine);
  waveLines = [];
  if (!allFrames || allFrames.length === 0) return;

  switch (shape) {
    case 'spiral':       _rebuildSpiral(allFrames, isLive);       break;
    case 'phyllotaxis':  _rebuildPhyllotaxis(allFrames, isLive);  break;
    case 'tube':         _rebuildTube(allFrames, isLive);         break;
    case 'terrain':      _rebuildTerrain(allFrames, isLive);      break;
    case 'harmonograph': _rebuildHarmonograph(allFrames, isLive); break;
    case 'flowfield':    _rebuildFlowField(allFrames, isLive);    break;
    case 'chladni':      _rebuildChladni(allFrames, isLive);      break;
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
    case 'epicycles': {
      const l = _buildEpicyclesLine(frameData, frameIndex, isLive);
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
  const pos = new Float32Array(N * 3);
  const zOffset = frameIndex * 0.08;

  for (let i = 0; i < N; i++) {
    pos[i * 3]     = left[i]  * LISS_SCALE;
    pos[i * 3 + 1] = right[i] * LISS_SCALE;
    pos[i * 3 + 2] = zOffset;
  }
  return _makeLine(pos, frameIndex, isLive);
}

// ---------------------------------------------------------------------------
// Shape geometry builders — NEW
// ---------------------------------------------------------------------------

/**
 * Phyllotaxis — golden-angle positioned dots connected in order.
 * Each sample across all frames is placed at angle = gi * GOLDEN_ANGLE,
 * radius = OUTER_R * sqrt(gi / total), amplitude modulates radius.
 */
function _rebuildPhyllotaxis(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const F     = allFrames.length;
  const N     = _toMono(allFrames[0]).length;
  const total = F * N;
  const pos   = new Float32Array(total * 3);

  for (let gi = 0; gi < total; gi++) {
    const fi  = Math.floor(gi / N);
    const si  = gi % N;
    const amp = _toMono(allFrames[fi])[si];
    const t   = gi / Math.max(total - 1, 1);
    const r   = OUTER_R * Math.sqrt(t) + amp * OUTER_R * 0.12 * cfg.ampScale;
    const angle = gi * GOLDEN_ANGLE;
    pos[gi * 3]     = r * Math.cos(angle);
    pos[gi * 3 + 1] = amp * 1.5 * cfg.ampScale;
    pos[gi * 3 + 2] = r * Math.sin(angle);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0xffaa00);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: isLive ? 0.5 : 0.8 });
  const line  = new THREE.Line(geo, mat);
  waveLines.push(line);
  scene.add(line);
}

/**
 * Tube — audio-modulated helix tube with rib cross-sections.
 * Spine follows a helix; at each frame position, an octagonal rib is drawn
 * in the plane perpendicular to the helix tangent.
 */
function _rebuildTube(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const F = allFrames.length;
  const baseRibR = 1.2;
  const ribAmpScale = 0.8;
  const helixTurns = 2;

  // Compute spine points
  const spinePos = new Float32Array(F * 3);
  const spineAngles = [];

  for (let fi = 0; fi < F; fi++) {
    const t     = fi / Math.max(F - 1, 1);
    const angle = t * helixTurns * Math.PI * 2;
    spineAngles.push(angle);
    spinePos[fi * 3]     = R_HELIX * Math.cos(angle);
    spinePos[fi * 3 + 1] = t * H_HELIX - H_HELIX / 2;
    spinePos[fi * 3 + 2] = R_HELIX * Math.sin(angle);
  }

  // Spine line
  const spineGeo = new THREE.BufferGeometry();
  spineGeo.setAttribute('position', new THREE.BufferAttribute(spinePos, 3));
  const spineColor = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0x6644ff);
  const spineMat   = new THREE.LineBasicMaterial({ color: spineColor, transparent: true, opacity: 0.5 });
  const spineLine  = new THREE.Line(spineGeo, spineMat);
  waveLines.push(spineLine);
  scene.add(spineLine);

  // Rib cross-sections — collect all rib pair vertices into a LineSegments
  const ribVerts = [];

  for (let fi = 0; fi < F; fi++) {
    const data = _toMono(allFrames[fi]);
    const rms  = _rmsOf(data);
    const ribR = baseRibR + rms * ribAmpScale * cfg.ampScale;

    const cx = spinePos[fi * 3];
    const cy = spinePos[fi * 3 + 1];
    const cz = spinePos[fi * 3 + 2];

    // Tangent vector (helix direction)
    const angle  = spineAngles[fi];
    const tx = -R_HELIX * Math.sin(angle);
    const ty = H_HELIX / Math.max(F - 1, 1);
    const tz =  R_HELIX * Math.cos(angle);
    const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz);

    // Local frame: normal perpendicular to tangent in the XZ plane
    const nRaw = { x: tz / tLen, y: 0, z: -tx / tLen };
    const nLen = Math.sqrt(nRaw.x*nRaw.x + nRaw.z*nRaw.z) || 1;
    const nx = nRaw.x / nLen, nz = nRaw.z / nLen;

    // Compute rib ring points (RIB_SEGS vertices, closed)
    const ribPts = [];
    for (let k = 0; k <= RIB_SEGS; k++) {
      const a = (k / RIB_SEGS) * Math.PI * 2;
      // Modulate per-sample amplitude around the rib
      const sampleIdx = Math.floor((k / RIB_SEGS) * (data.length - 1));
      const sAmp = data[sampleIdx] * ribAmpScale * cfg.ampScale * 0.5;
      const r = ribR + sAmp;
      ribPts.push(
        cx + r * (Math.cos(a) * nx + Math.sin(a) * 0),      // simplified: use 2D in XZ plane of rib
        cy + r * Math.sin(a),
        cz + r * (Math.cos(a) * nz)
      );
    }

    // Emit as line segments (pairs for closed ring)
    for (let k = 0; k < RIB_SEGS; k++) {
      ribVerts.push(
        ribPts[k * 3], ribPts[k * 3 + 1], ribPts[k * 3 + 2],
        ribPts[(k+1) * 3], ribPts[(k+1) * 3 + 1], ribPts[(k+1) * 3 + 2]
      );
    }
  }

  if (ribVerts.length > 0) {
    const ribPos = new Float32Array(ribVerts);
    const ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3));
    const t = allFrames.length / Math.max(cfg.maxFrames, 1);
    const ribColor = isLive ? new THREE.Color(0xaaaaaa) : new THREE.Color().setHSL(0.65 + t * 0.1, 0.7, 0.5);
    const ribMat   = new THREE.LineBasicMaterial({ color: ribColor, transparent: true, opacity: 0.7 });
    const ribSegs  = new THREE.LineSegments(ribGeo, ribMat);
    waveLines.push(ribSegs);
    scene.add(ribSegs);
  }
}

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

  // ---- HORIZONTAL LINES (wave profiles, horizon-masked) ----
  // Process newest→oldest so front frames set the horizon for back frames.
  const horizonY = new Float32Array(N).fill(-1000);

  for (let fi = F - 1; fi >= 0; fi--) {
    const ys = yValues[fi];
    const z  = fi * zSpacing;
    let segPts = null;

    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * SCENE_W - SCENE_W / 2;
      if (ys[i] > horizonY[i]) {
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
    for (let i = 0; i < N; i++) if (ys[i] > horizonY[i]) horizonY[i] = ys[i];
  }

  // ---- PERPENDICULAR LINES (cross-sections along Z, horizon-masked per column) ----
  // Spacing chosen so the count of vertical lines ≈ count of horizontal lines,
  // giving a roughly square mesh cell.
  const N_STEP = Math.max(4, Math.min(64, Math.round(N / Math.max(F, 4))));

  for (let si = 0; si < N; si += N_STEP) {
    const x = (si / (N - 1)) * SCENE_W - SCENE_W / 2;
    // Per-column horizon: highest Y seen so far coming from the front (newest) frame.
    let colHorizon = -1000;
    let segPts = null;

    // Walk newest→oldest (Z decreasing from camera perspective).
    for (let fi = F - 1; fi >= 0; fi--) {
      const y = yValues[fi][si];
      const z = fi * zSpacing;

      if (y > colHorizon) {
        if (!segPts) segPts = [];
        segPts.push(x, y, z);
        colHorizon = y;
      } else {
        if (segPts && segPts.length >= 6) {
          _emitTerrainPerp(segPts, isLive);
        }
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
 * Flow field — streamlines through a 2-D vector field derived from the avg FFT.
 * All streamlines lie on the Y = 0 plane.
 */
function _rebuildFlowField(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const avg = _avgFrames(allFrames);
  const GN  = 20;  // grid resolution

  // Build GN×GN angle field; map avg[i] → angle
  const field = new Float32Array(GN * GN);
  for (let i = 0; i < GN * GN; i++) {
    field[i] = avg[i % avg.length] * Math.PI * 2;
  }

  // Bilinear interpolation of field angle at scene coords (x, z)
  function fieldAngle(x, z) {
    const nx  = Math.max(0, Math.min(1, (x + 9) / 18));
    const nz  = Math.max(0, Math.min(1, (z + 9) / 18));
    const gx  = nx * (GN - 1);
    const gz  = nz * (GN - 1);
    const i0  = Math.floor(gx), i1 = Math.min(i0 + 1, GN - 1);
    const j0  = Math.floor(gz), j1 = Math.min(j0 + 1, GN - 1);
    const tx  = gx - i0, tz = gz - j0;
    return  field[j0*GN+i0]*(1-tx)*(1-tz)
          + field[j0*GN+i1]*tx*(1-tz)
          + field[j1*GN+i0]*(1-tx)*tz
          + field[j1*GN+i1]*tx*tz;
  }

  const SEEDS    = 6;
  const STEPS    = 40;
  const STEP_SZ  = 0.35;
  let   seedIdx  = 0;

  for (let si = 0; si < SEEDS; si++) {
    for (let sj = 0; sj < SEEDS; sj++) {
      let x = -8 + si * (16 / (SEEDS - 1));
      let z = -8 + sj * (16 / (SEEDS - 1));

      const pos = new Float32Array((STEPS + 1) * 3);
      pos[0] = x; pos[1] = 0; pos[2] = z;

      for (let step = 1; step <= STEPS; step++) {
        const angle = fieldAngle(x, z);
        x += Math.cos(angle) * STEP_SZ;
        z += Math.sin(angle) * STEP_SZ;
        x = Math.max(-9, Math.min(9, x));
        z = Math.max(-9, Math.min(9, z));
        pos[step*3] = x; pos[step*3+1] = 0; pos[step*3+2] = z;
      }

      const line = _makeLine(pos, seedIdx++, isLive);
      waveLines.push(line);
      scene.add(line);
    }
  }
}

/**
 * Chladni — nodal pattern zero-crossing marks.
 * m, n are derived from the dominant frequency bin of the latest frame.
 */
function _rebuildChladni(allFrames, isLive) {
  if (!allFrames || allFrames.length === 0) return;

  const latestData  = _toMono(allFrames[allFrames.length - 1]);
  const { m, n }    = _chladniMN(latestData);
  const GRID        = 64;
  const EXTENT      = 9;
  const tickLen     = 0.3;

  const vertices = [];

  for (let ix = 0; ix < GRID - 1; ix++) {
    for (let iz = 0; iz < GRID - 1; iz++) {
      const x  = -EXTENT + ix  * (2 * EXTENT / (GRID - 1));
      const z  = -EXTENT + iz  * (2 * EXTENT / (GRID - 1));
      const x1 = -EXTENT + (ix+1) * (2 * EXTENT / (GRID - 1));
      const z1 = -EXTENT + (iz+1) * (2 * EXTENT / (GRID - 1));

      const px  = x  / EXTENT * Math.PI;
      const pz  = z  / EXTENT * Math.PI;
      const px1 = x1 / EXTENT * Math.PI;
      const pz1 = z1 / EXTENT * Math.PI;

      const v00 = Math.cos(m*px)*Math.cos(n*pz) - Math.cos(n*px)*Math.cos(m*pz);
      const v10 = Math.cos(m*px1)*Math.cos(n*pz) - Math.cos(n*px1)*Math.cos(m*pz);
      const v01 = Math.cos(m*px)*Math.cos(n*pz1) - Math.cos(n*px)*Math.cos(m*pz1);

      // X-direction crossing → vertical tick
      if (v00 * v10 < 0) {
        const alpha = v00 / (v00 - v10);
        const cx    = x + alpha * (x1 - x);
        const midZ  = (z + z1) * 0.5;
        vertices.push(cx, 0, midZ - tickLen, cx, 0, midZ + tickLen);
      }
      // Z-direction crossing → horizontal tick
      if (v00 * v01 < 0) {
        const alpha = v00 / (v00 - v01);
        const cz    = z + alpha * (z1 - z);
        const midX  = (x + x1) * 0.5;
        vertices.push(midX - tickLen, 0, cz, midX + tickLen, 0, cz);
      }
    }
  }

  if (vertices.length < 6) return;

  const pos = new Float32Array(vertices);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = isLive ? new THREE.Color(0xffffff) : new THREE.Color(0x88ffdd);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const segs  = new THREE.LineSegments(geo, mat);
  waveLines.push(segs);
  scene.add(segs);
}

/**
 * Epicycles — DFT arm snapshot per recorded frame.
 * Each frame shows the position of K spinning arms at a fixed t value.
 */
function _buildEpicyclesLine(frameData, frameIndex, isLive) {
  const K    = 16;
  const mono = _toMono(frameData);
  const comps = _dftTopK(mono, K);
  const t    = (frameIndex / Math.max(cfg.maxFrames - 1, 1)) * 2 * Math.PI;
  const z    = frameIndex * 0.18;

  // Arm trace: K+1 points (start at origin, extend through each arm)
  const pts = new Float32Array((K + 1) * 3);
  let cx = 0, cy = 0;

  for (let k = 0; k < K; k++) {
    const c = comps[k] || { amp: 0, phase: 0, bin: k + 1 };
    const radius = c.amp * LISS_SCALE * 0.8;
    const angle  = c.bin * t + c.phase;
    cx += radius * Math.cos(angle);
    cy += radius * Math.sin(angle);
    pts[(k + 1) * 3]     = cx;
    pts[(k + 1) * 3 + 1] = cy;
    pts[(k + 1) * 3 + 2] = z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const color = isLive ? new THREE.Color(0xffffff) : _frameColor(frameIndex, cfg.maxFrames);
  const mat   = new THREE.LineBasicMaterial({ color, transparent: true, opacity: isLive ? 0.8 : 0.65 });
  return new THREE.Line(geo, mat);
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

/** Derive Chladni mode numbers {m, n} from dominant frequency content. */
function _chladniMN(frameData) {
  const mono  = _toMono(frameData);
  const comps = _dftTopK(mono, 2);
  const bin1  = comps[0]?.bin ?? 4;
  const bin2  = comps[1]?.bin ?? 7;
  const m = Math.max(1, Math.min(7, 1 + Math.floor(bin1 * 6 / 64)));
  const n = Math.max(1, Math.min(8, 1 + Math.floor(bin2 * 7 / 64)));
  return { m, n: m === n ? n + 1 : n };
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
    phyllotaxis:  { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    tube:         { pos: [8,  4, 22],  lookAt: [0, 0,  6] },
    terrain:      { pos: [0,  8, 28],  lookAt: [0, 0, 10] },
    harmonograph: { pos: [0, 12, 22],  lookAt: [0, 0,  0] },
    flowfield:    { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    epicycles:    { pos: [0,  5, 20],  lookAt: [0, 0,  0] },
    chladni:      { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
    moire:        { pos: [0, 22,  3],  lookAt: [0, 0,  0] },
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
