/**
 * main.js
 * Bootstraps all modules, owns the requestAnimationFrame loop,
 * and wires UI events.
 */

import * as audio      from './audio.js';
import * as recorder   from './recorder.js';
import * as visualizer from './visualizer.js';
import * as gcode      from './gcode.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas             = document.getElementById('viz-canvas');
const btnRecord          = document.getElementById('btn-record');
const btnExport          = document.getElementById('btn-export');
const btnExportAnaglyph  = document.getElementById('btn-export-anaglyph');
const statusLabel        = document.getElementById('status-label');
const frameCounter  = document.getElementById('frame-counter');
const modeSelect    = document.getElementById('mode-select');
const shapeSelect   = document.getElementById('shape-select');
const inputMaxFrames  = document.getElementById('setting-max-frames');
const inputAmpScale   = document.getElementById('setting-amp-scale');
const inputFeedRate   = document.getElementById('setting-feed-rate');
const inputFftSize    = document.getElementById('setting-fft-size');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let appState    = 'IDLE';   // IDLE | RECORDING | STOPPED
let currentMode = 'time';
let currentShape = 'linear';
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

    if (!audioReady) {
      statusLabel.textContent = 'Requesting microphone…';
      await audio.init(cfg);
      audioReady = true;
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
// Event: Export G-code button
// ---------------------------------------------------------------------------
btnExport.addEventListener('click', () => {
  if (recorder.getFrameCount() === 0) return;

  const cfg   = getConfig();
  const paths = visualizer.getProjectedPaths();

  const content = gcode.projectedPathsToGCode(paths, {
    feedRate:        cfg.feedRate,
    penDownFeedRate: 300,
    penUpZ:          5,
    penDownZ:        0,
  });
  const filename = gcode.generateFilename(currentMode, currentShape);
  gcode.downloadGCode(content, filename);
});

// ---------------------------------------------------------------------------
// Event: Export Anaglyph button
// ---------------------------------------------------------------------------
btnExportAnaglyph.addEventListener('click', () => {
  if (recorder.getFrameCount() === 0) return;

  const cfg = getConfig();
  const { leftPaths, rightPaths } = visualizer.getStereoPaths(0.65);

  const content = gcode.stereoPathsToGCode(leftPaths, rightPaths, {
    feedRate:        cfg.feedRate,
    penDownFeedRate: 300,
    penUpZ:          5,
    penDownZ:        0,
  });
  const filename = gcode.generateFilename(currentMode, currentShape + '-anaglyph');
  gcode.downloadGCode(content, filename);
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
// rAF loop — runs always once visualizer is initialised
// ---------------------------------------------------------------------------
function loop() {
  requestAnimationFrame(loop);

  if (audioReady) {
    const frame = audio.getFrame(currentMode);
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
  vizReady = true;
  setAppState('IDLE');
  requestAnimationFrame(loop);
});
