/**
 * main.js
 * Bootstraps all modules, owns the requestAnimationFrame loop,
 * and wires UI events.
 */

import * as audio      from './audio.js';
import * as recorder   from './recorder.js';
import * as visualizer from './visualizer.js';
import * as gcode      from './gcode.js';
import * as noise      from './noise.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas             = document.getElementById('viz-canvas');
const btnRecord          = document.getElementById('btn-record');
const btnExport          = document.getElementById('btn-export');
const btnExportAnaglyph  = document.getElementById('btn-export-anaglyph');
const statusLabel        = document.getElementById('status-label');
const frameCounter       = document.getElementById('frame-counter');
const btnHelp            = document.getElementById('btn-help');
const helpModal          = document.getElementById('help-modal');
const btnHelpClose       = document.getElementById('btn-help-close');
const sourceSelect  = document.getElementById('source-select');
const modeSelect    = document.getElementById('mode-select');
const shapeSelect   = document.getElementById('shape-select');
const inputMaxFrames  = document.getElementById('setting-max-frames');
const inputAmpScale   = document.getElementById('setting-amp-scale');
const inputFeedRate   = document.getElementById('setting-feed-rate');
const inputFftSize    = document.getElementById('setting-fft-size');

// Noise controls
const noiseSection     = document.getElementById('controls-noise');
const noiseTypeSelect  = document.getElementById('noise-type');
const noiseSeedInput   = document.getElementById('noise-seed');
const noiseSpeedInput  = document.getElementById('noise-speed');
const noiseFreqInput   = document.getElementById('noise-frequency');
const noiseOctInput    = document.getElementById('noise-octaves');
const noisePersInput   = document.getElementById('noise-persistence');
const noiseSpeedVal    = document.getElementById('noise-speed-val');
const noiseFreqVal     = document.getElementById('noise-freq-val');
const noiseOctVal      = document.getElementById('noise-oct-val');
const noisePersVal     = document.getElementById('noise-pers-val');
// Labels that only apply to perlin/sine (hidden for white noise)
const noiseOctaveCtrl  = document.querySelectorAll('.noise-octave-ctrl');

// Camera controls
const cameraPosInput    = document.getElementById('camera-pos');
const cameraTargetInput = document.getElementById('camera-target');
const btnCameraSet      = document.getElementById('btn-camera-set');

// Advanced panel toggle
const advancedPanel  = document.getElementById('advanced-panel');
const advancedToggle = document.getElementById('advanced-toggle');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let appState    = 'IDLE';   // IDLE | RECORDING | STOPPED
let currentMode  = 'time';
let currentShape = 'terrain';
let currentSource = 'noise';  // 'mic' | 'noise'
let audioReady  = false;
let vizReady    = false;
let tickCount   = 0;

const RECORD_FPS      = 10;
const RAF_FPS         = 60;
const RECORD_EVERY_N  = Math.round(RAF_FPS / RECORD_FPS);

// ---------------------------------------------------------------------------
// Config helper
// ---------------------------------------------------------------------------
function getConfig() {
  const maxFrames  = Math.max(8,   Math.min(256, parseInt(inputMaxFrames.value)  || 64));
  const ampScale   = Math.max(0.1, Math.min(10,  parseFloat(inputAmpScale.value) || 2.0));
  const feedRate   = Math.max(100, Math.min(10000, parseInt(inputFeedRate.value)  || 3000));
  const fftSize    = Math.max(32,  Math.min(2048, parseInt(inputFftSize.value)    || 512));
  // Amplitude scale in mm: each row gets rowSpacing * 0.45 * ampScale mm of swing.
  // We pass ampScale directly; gcode.js computes rowSpacing internally.
  return { maxFrames, ampScale, feedRate, fftSize, amplitudeScaleMm: ampScale };
}

/** Read current noise-parameter inputs. */
function getNoiseConfig() {
  return {
    noiseType:   noiseTypeSelect.value,
    seed:        Math.max(0, parseInt(noiseSeedInput.value) || 42),
    speed:       parseFloat(noiseSpeedInput.value),
    frequency:   parseFloat(noiseFreqInput.value),
    octaves:     parseInt(noiseOctInput.value),
    persistence: parseFloat(noisePersInput.value),
    fftSize:     Math.max(32, Math.min(2048, parseInt(inputFftSize.value) || 512)),
  };
}

// ---------------------------------------------------------------------------
// UI state machine
// ---------------------------------------------------------------------------
function setAppState(state) {
  appState = state;

  if (state === 'IDLE') {
    btnRecord.textContent = 'Record';
    btnRecord.classList.remove('recording');
    btnExport.disabled = true;
    btnExportAnaglyph.disabled = true;
    modeSelect.disabled = false;
    shapeSelect.disabled = false;
    setInputsDisabled(false);
    statusLabel.textContent  = 'Idle';
    statusLabel.className    = '';
  } else if (state === 'RECORDING') {
    btnRecord.textContent = 'Stop';
    btnRecord.classList.add('recording');
    btnExport.disabled = true;
    btnExportAnaglyph.disabled = true;
    modeSelect.disabled = true;
    shapeSelect.disabled = true;
    setInputsDisabled(true);
    statusLabel.textContent = 'Recording';
    statusLabel.className   = 'active';
  } else if (state === 'STOPPED') {
    btnRecord.textContent = 'Record';
    btnRecord.classList.remove('recording');
    btnExport.disabled = recorder.getFrameCount() === 0;
    btnExportAnaglyph.disabled = recorder.getFrameCount() === 0;
    modeSelect.disabled = false;
    shapeSelect.disabled = false;
    setInputsDisabled(false);
    statusLabel.textContent = `Captured ${recorder.getFrameCount()} frames`;
    statusLabel.className   = 'done';
  }
}

function setInputsDisabled(disabled) {
  inputMaxFrames.disabled = disabled;
  inputAmpScale.disabled  = disabled;
  inputFeedRate.disabled  = disabled;
  inputFftSize.disabled   = disabled;
}

// ---------------------------------------------------------------------------
// Event: Record / Stop button
// ---------------------------------------------------------------------------
btnRecord.addEventListener('click', async () => {
  if (appState === 'RECORDING') {
    // STOP
    recorder.stop();
    setAppState('STOPPED');
    return;
  }

  // START (IDLE or STOPPED)
  const cfg = getConfig();

  try {
    visualizer.updateConfig(cfg);
    visualizer.clearWaveLines();

    if (currentSource === 'noise') {
      // Noise source: no microphone needed — configure and reset
      noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
      noise.reset();
    } else {
      // Microphone source
      if (!audioReady) {
        statusLabel.textContent = 'Requesting microphone…';
        await audio.init(cfg);
        audioReady = true;
      }
    }

    recorder.configure({ maxFrames: cfg.maxFrames, mode: currentMode });
    recorder.start();
    tickCount = 0;
    setAppState('RECORDING');
  } catch (err) {
    console.error('Failed to start recording:', err);
    statusLabel.textContent = 'Microphone access denied';
    statusLabel.className   = '';
    setAppState('IDLE');
  }
});

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------
function _buildExportParams() {
  const cfg = getConfig();
  return {
    shape:      currentShape,
    source:     currentSource,
    dataMode:   currentMode,
    noiseType:  noiseTypeSelect.value,
    seed:       parseInt(noiseSeedInput.value) || 42,
    noiseSpeed: parseFloat(noiseSpeedInput.value),
    noiseFreq:  parseFloat(noiseFreqInput.value),
    noiseOct:   parseInt(noiseOctInput.value),
    noisePers:  parseFloat(noisePersInput.value),
    maxFrames:  cfg.maxFrames,
    ampScale:   cfg.ampScale,
    fftSize:    cfg.fftSize,
    feedRate:   cfg.feedRate,
    camera:     visualizer.getCameraState(),
  };
}

// ---------------------------------------------------------------------------
// Event: Export G-code button
// ---------------------------------------------------------------------------
btnExport.addEventListener('click', () => {
  if (recorder.getFrameCount() === 0) return;

  const params = _buildExportParams();
  const paths  = visualizer.getProjectedPaths();

  const content = gcode.projectedPathsToGCode(paths, {
    feedRate:        params.feedRate,
    penDownFeedRate: 300,
    penUpZ:          5,
    penDownZ:        0,
    params,
  });
  gcode.downloadGCode(content, gcode.generateFilename(params));
});

// ---------------------------------------------------------------------------
// Event: Export Anaglyph button
// ---------------------------------------------------------------------------
btnExportAnaglyph.addEventListener('click', () => {
  if (recorder.getFrameCount() === 0) return;

  const params = _buildExportParams();
  const { leftPaths, rightPaths } = visualizer.getStereoPaths(0.65);

  const content = gcode.stereoPathsToGCode(leftPaths, rightPaths, {
    feedRate:        params.feedRate,
    penDownFeedRate: 300,
    penUpZ:          5,
    penDownZ:        0,
    params,
  });
  gcode.downloadGCode(content, gcode.generateFilename(params).replace('.gcode', '-anaglyph.gcode'));
});

// ---------------------------------------------------------------------------
// Event: Data mode change
// ---------------------------------------------------------------------------
modeSelect.addEventListener('change', async () => {
  const newMode = modeSelect.value;
  if (newMode === currentMode) return;

  currentMode = newMode;
  recorder.reset();
  visualizer.clearWaveLines();
  btnExport.disabled = true;
  btnExportAnaglyph.disabled = true;
  frameCounter.textContent = '0 frames';

  if (appState === 'STOPPED') {
    setAppState('IDLE');
  }

  // Re-init audio if already active (channel routing differs for stereo).
  if (audioReady) {
    try {
      await audio.destroy();
      audioReady = false;
      const cfg = getConfig();
      await audio.init(cfg);
      audioReady = true;
    } catch (err) {
      console.error('Audio re-init failed:', err);
      audioReady = false;
    }
  }
});

// ---------------------------------------------------------------------------
// Event: Shape change
// ---------------------------------------------------------------------------
shapeSelect.addEventListener('change', () => {
  const newShape = shapeSelect.value;
  if (newShape === currentShape) return;

  currentShape = newShape;
  recorder.reset();
  visualizer.setShape(newShape);
  btnExport.disabled = true;
  btnExportAnaglyph.disabled = true;
  frameCounter.textContent = '0 frames';

  if (appState === 'STOPPED') {
    setAppState('IDLE');
  }
});

// ---------------------------------------------------------------------------
// Event: Source change
// ---------------------------------------------------------------------------
sourceSelect.addEventListener('change', () => {
  currentSource = sourceSelect.value;

  // Show/hide noise panel
  noiseSection.classList.toggle('hidden', currentSource !== 'noise');

  // Pre-configure noise when switching to it so live preview starts immediately
  if (currentSource === 'noise') {
    const cfg = getConfig();
    noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
    noise.reset();
  }

  // Clear any recorded content — source change invalidates previous data
  recorder.reset();
  visualizer.clearWaveLines();
  btnExport.disabled = true;
  btnExportAnaglyph.disabled = true;
  frameCounter.textContent = '0 frames';
  if (appState === 'STOPPED') setAppState('IDLE');
});

// ---------------------------------------------------------------------------
// Events: Noise parameter sliders / inputs
// Live-update the noise module and the output display elements.
// ---------------------------------------------------------------------------
function _syncNoiseOctaveControls() {
  // Octaves / persistence don't apply to white noise
  const isWhite = noiseTypeSelect.value === 'white';
  noiseOctaveCtrl.forEach(el => el.classList.toggle('hidden', isWhite));
}

function _applyNoiseConfig() {
  if (currentSource !== 'noise') return;
  const cfg = getConfig();
  noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
}

noiseTypeSelect.addEventListener('change', () => {
  _syncNoiseOctaveControls();
  _applyNoiseConfig();
});

noiseSeedInput.addEventListener('change', () => {
  // Seed change: reconfigure (which resets time cursor) for reproducibility
  _applyNoiseConfig();
  noise.reset();
  // Clear visualizer so the new seed plays from the start
  if (appState !== 'RECORDING') {
    recorder.reset();
    visualizer.clearWaveLines();
    if (appState === 'STOPPED') setAppState('IDLE');
  }
});

noiseSpeedInput.addEventListener('input', () => {
  noiseSpeedVal.value = noiseSpeedInput.value;
  _applyNoiseConfig();
});

noiseFreqInput.addEventListener('input', () => {
  noiseFreqVal.value = noiseFreqInput.value;
  _applyNoiseConfig();
});

noiseOctInput.addEventListener('input', () => {
  noiseOctVal.value = noiseOctInput.value;
  _applyNoiseConfig();
});

noisePersInput.addEventListener('input', () => {
  noisePersVal.value = noisePersInput.value;
  _applyNoiseConfig();
});

// ---------------------------------------------------------------------------
// Camera controls
// ---------------------------------------------------------------------------
function _parseVec3(str) {
  const parts = str.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts;
}

btnCameraSet.addEventListener('click', () => {
  const pos = _parseVec3(cameraPosInput.value);
  const tgt = _parseVec3(cameraTargetInput.value);
  if (pos && tgt) visualizer.setCameraState(pos, tgt);
});

// Apply on Enter in either input
[cameraPosInput, cameraTargetInput].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') btnCameraSet.click();
  });
});

// ---------------------------------------------------------------------------
// Advanced panel toggle
// ---------------------------------------------------------------------------
advancedToggle.addEventListener('click', e => {
  e.preventDefault();
  const nowHidden = advancedPanel.classList.toggle('hidden');
  advancedToggle.textContent = nowHidden ? 'Advanced ▸' : 'Advanced ▾';
});

// ---------------------------------------------------------------------------
// Help modal
// ---------------------------------------------------------------------------
function _openHelp()  { helpModal.classList.remove('hidden'); }
function _closeHelp() { helpModal.classList.add('hidden'); }

btnHelp.addEventListener('click', _openHelp);
btnHelpClose.addEventListener('click', _closeHelp);

// Close on backdrop click (outside the content box).
helpModal.addEventListener('click', e => { if (e.target === helpModal) _closeHelp(); });

// Close on Escape key.
document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeHelp(); });

// ---------------------------------------------------------------------------
// rAF loop — runs always once visualizer is initialised
// ---------------------------------------------------------------------------
function loop() {
  requestAnimationFrame(loop);

  if (audioReady || currentSource === 'noise') {
    const frame = currentSource === 'noise'
      ? noise.getFrame(currentMode)
      : audio.getFrame(currentMode);
    const allFrames = visualizer.REBUILD_ALL_SHAPES.has(currentShape) ? recorder.getFrames() : null;

    // Live preview (always update).
    visualizer.updateLiveLine(frame, allFrames, recorder.getFrameCount());

    // Record at throttled rate.
    if (recorder.isRecording() && tickCount % RECORD_EVERY_N === 0) {
      recorder.addFrame(frame);
      const count = recorder.getFrameCount();
      const cfg   = getConfig();
      // Pass allFrames for spiral rebuild; for other shapes it is ignored.
      visualizer.addRecordedFrame(frame, count - 1, recorder.getFrames());
      frameCounter.textContent = `${count} / ${cfg.maxFrames} frames`;

      // Auto-stop when max frames reached.
      if (recorder.isFull()) {
        recorder.stop();
        setAppState('STOPPED');
      }
    }

    tickCount++;
  }

  // Sync camera position inputs every ~30 frames, but not while the user is editing them.
  if (tickCount % 30 === 0) {
    const focused = document.activeElement;
    if (focused !== cameraPosInput && focused !== cameraTargetInput) {
      const cam = visualizer.getCameraState();
      if (cam) {
        const fmt = arr => arr.map(v => parseFloat(v.toFixed(2))).join(' ');
        cameraPosInput.value    = fmt(cam.position);
        cameraTargetInput.value = fmt(cam.target);
      }
    }
  }

  visualizer.render();
}

// ---------------------------------------------------------------------------
// Kick off rAF loop immediately (visualizer.init is called later on first
// Record click to satisfy AudioContext user-gesture requirement).
// Pre-init the visualizer with canvas so OrbitControls are available right away.
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  // Pre-init the visualizer (no audio needed).
  visualizer.init(canvas, getConfig());
  // Apply default shape so camera is positioned correctly from the start.
  visualizer.setShape(currentShape);
  vizReady = true;
  setAppState('IDLE');

  // Pre-configure noise with defaults so it's ready instantly on source switch.
  const cfg = getConfig();
  noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });

  requestAnimationFrame(loop);
});
