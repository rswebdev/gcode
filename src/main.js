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
import * as serial     from './serial.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas             = document.getElementById('viz-canvas');
const btnRecord          = document.getElementById('btn-record');
const btnExport          = document.getElementById('btn-export');
const btnImportGCode     = document.getElementById('btn-import-gcode');
const fileImportGCode    = document.getElementById('file-import-gcode');
const btnTestPattern     = document.getElementById('btn-test-pattern');
const btnExportAnaglyph  = document.getElementById('btn-export-anaglyph');
const btnSerialSend      = document.getElementById('btn-serial-send');
const btnFrame           = document.getElementById('btn-frame');
const btnCalSweep        = document.getElementById('btn-cal-sweep');
const btnRerender        = document.getElementById('btn-rerender');
const statusLabel        = document.getElementById('status-label');
const frameCounter       = document.getElementById('frame-counter');
const btnHelp            = document.getElementById('btn-help');
const helpModal          = document.getElementById('help-modal');
const btnHelpClose       = document.getElementById('btn-help-close');
const sourceSelect  = document.getElementById('source-select');
const modeSelect    = document.getElementById('mode-select');
const shapeSelect   = document.getElementById('shape-select');
const presetIndicator  = document.getElementById('preset-indicator');
const btnPresetSave    = document.getElementById('btn-preset-save');
const btnPresetClear   = document.getElementById('btn-preset-clear');
const inputMaxFrames  = document.getElementById('setting-max-frames');
const inputAmpScale   = document.getElementById('setting-amp-scale');
const inputFeedRate   = document.getElementById('setting-feed-rate');
const inputOffsetX    = document.getElementById('setting-offset-x');
const inputOffsetY    = document.getElementById('setting-offset-y');
const inputPenUpZ     = document.getElementById('setting-pen-up-z');
const inputPenDownZ   = document.getElementById('setting-pen-down-z');
const inputPenMode    = document.getElementById('setting-pen-mode');
const inputPenUpS     = document.getElementById('setting-pen-up-s');
const inputPenDownS   = document.getElementById('setting-pen-down-s');
const inputPenComp    = document.getElementById('setting-pen-comp');
const inputCalYMax    = document.getElementById('setting-cal-y-max');
const inputCalStep    = document.getElementById('setting-cal-step');
const zUpCtrl         = document.getElementById('z-up-ctrl');
const zDownCtrl       = document.getElementById('z-down-ctrl');
const servoUpCtrl     = document.getElementById('servo-up-ctrl');
const servoDownCtrl   = document.getElementById('servo-down-ctrl');
const servoCompCtrl   = document.getElementById('servo-comp-ctrl');
const inputFftSize    = document.getElementById('setting-fft-size');
const inputRecordFps  = document.getElementById('setting-record-fps');
const inputSmoothing  = document.getElementById('setting-smoothing');
const inputImportScale = document.getElementById('import-scale');

// Plotter machine controls
const btnPlotterHome    = document.getElementById('btn-plotter-home');
const btnPlotterZeroXY  = document.getElementById('btn-plotter-zero-xy');
const btnPlotterZeroZ   = document.getElementById('btn-plotter-zero-z');
const btnPlotterPenUp   = document.getElementById('btn-plotter-pen-up');
const btnPlotterPenDown = document.getElementById('btn-plotter-pen-down');
const btnServoSweep     = document.getElementById('btn-servo-sweep');

// Jog controls
const jogStepSelect = document.getElementById('jog-step');
const jogSwapXY     = document.getElementById('jog-swap-xy');
const jogCoreXY     = document.getElementById('jog-corexy');
const btnJogXP = document.getElementById('btn-jog-xp');
const btnJogXM = document.getElementById('btn-jog-xm');
const btnJogYP = document.getElementById('btn-jog-yp');
const btnJogYM = document.getElementById('btn-jog-ym');
const btnJogZP = document.getElementById('btn-jog-zp');
const btnJogZM = document.getElementById('btn-jog-zm');

// Serial monitor
const btnMonitorToggle  = document.getElementById('btn-monitor-toggle');
const serialMonitor     = document.getElementById('serial-monitor');
const monitorLog        = document.getElementById('monitor-log');
const monitorInput      = document.getElementById('monitor-input');
const monitorConnStatus = document.getElementById('monitor-conn-status');
const btnMonitorClear   = document.getElementById('btn-monitor-clear');
const btnMonitorClose   = document.getElementById('btn-monitor-close');
const btnMonitorSend    = document.getElementById('btn-monitor-send');

// Labels that only show when source = mic
const micOnlyCtrls    = document.querySelectorAll('.mic-only-ctrl');

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
const btnCameraReset    = document.getElementById('btn-camera-reset');

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
let importedPathCount = 0;

const RAF_FPS = 60;

function _hasPlottablePaths() {
  return recorder.getFrameCount() > 0 || importedPathCount > 0;
}

function _clearImportedPaths() {
  importedPathCount = 0;
}

function _getActiveProjectedPaths() {
  return visualizer.getProjectedPaths();
}

// ---------------------------------------------------------------------------
// Per-source × per-shape defaults
// Applied automatically whenever the user switches source or shape.
// Keys map directly to DOM input IDs / JS state vars.
// Only properties listed here are overridden; everything else is untouched.
// ---------------------------------------------------------------------------
const SHAPE_SOURCE_DEFAULTS = {
  noise: {
    // shape:       { noiseType, noiseSpeed, noiseFreq, noiseOct, noisePers, ampScale, maxFrames }
    linear:       { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 64  },
    terrain:      { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 64  },
    landscape:    { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 64  },
    circular:     { noiseType: 'perlin', noiseSpeed: 0.008, noiseFreq: 3,   noiseOct: 3, noisePers: 0.5, ampScale: 1.5, maxFrames: 32  },
    spiral:       { noiseType: 'perlin', noiseSpeed: 0.004, noiseFreq: 2,   noiseOct: 4, noisePers: 0.6, ampScale: 0.8, maxFrames: 96  },
    lissajous:    { noiseType: 'sine',   noiseSpeed: 0.01,  noiseFreq: 1.5, noiseOct: 3, noisePers: 0.5, ampScale: 6,   maxFrames: 32  },
    phyllotaxis:  { noiseType: 'perlin', noiseSpeed: 0.006, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 0.8, maxFrames: 128 },
    tube:         { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 3,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 48  },
    harmonograph: { noiseType: 'perlin', noiseSpeed: 0.003, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 32  },
    flowfield:    { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 3, noisePers: 0.5, ampScale: 1,   maxFrames: 48  },
    epicycles:    { noiseType: 'perlin', noiseSpeed: 0.008, noiseFreq: 3,   noiseOct: 3, noisePers: 0.5, ampScale: 5,   maxFrames: 32  },
    chladni:      { noiseType: 'perlin', noiseSpeed: 0.004, noiseFreq: 1,   noiseOct: 2, noisePers: 0.5, ampScale: 1,   maxFrames: 32  },
    moire:        { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 3, noisePers: 0.5, ampScale: 1,   maxFrames: 32  },
    heatmap:      { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 1,   maxFrames: 48  },
  },
  mic: {
    // Mic: raw audio peaks are large and fast-changing.
    // Prefer frequency mode (smoother) for most shapes; lower ampScale.
    // mode key sets the data mode select.
    linear:       { ampScale: 1.2, maxFrames: 32,  mode: 'time'      },
    terrain:      { ampScale: 1.2, maxFrames: 32,  mode: 'time'      },
    landscape:    { ampScale: 1.2, maxFrames: 32,  mode: 'time'      },
    circular:     { ampScale: 1.0, maxFrames: 32,  mode: 'frequency' },
    spiral:       { ampScale: 0.5, maxFrames: 64,  mode: 'frequency' },
    lissajous:    { ampScale: 5.0, maxFrames: 16,  mode: 'stereo'    },
    phyllotaxis:  { ampScale: 0.4, maxFrames: 64,  mode: 'frequency' },
    tube:         { ampScale: 1.5, maxFrames: 32,  mode: 'frequency' },
    harmonograph: { ampScale: 1.5, maxFrames: 16,  mode: 'frequency' },
    flowfield:    { ampScale: 1.0, maxFrames: 32,  mode: 'frequency' },
    epicycles:    { ampScale: 3.0, maxFrames: 16,  mode: 'frequency' },
    chladni:      { ampScale: 1.0, maxFrames: 16,  mode: 'frequency' },
    moire:        { ampScale: 1.0, maxFrames: 32,  mode: 'time'      },
    heatmap:      { ampScale: 1.0, maxFrames: 32,  mode: 'frequency' },
  },
};

/**
 * Apply default settings for the given source + shape combination.
 * Only affects the parameters listed in the defaults table.
 * Does NOT reset noise seed or camera.
 */
function _applyShapeSourceDefaults(source, shape) {
  const d = (SHAPE_SOURCE_DEFAULTS[source] || {})[shape];
  if (!d) return;

  if (d.noiseType  != null) { noiseTypeSelect.value  = d.noiseType; _syncNoiseOctaveControls(); }
  if (d.noiseSpeed != null) { noiseSpeedInput.value  = d.noiseSpeed; if (noiseSpeedVal) noiseSpeedVal.value = d.noiseSpeed; }
  if (d.noiseFreq  != null) { noiseFreqInput.value   = d.noiseFreq;  if (noiseFreqVal)  noiseFreqVal.value  = d.noiseFreq; }
  if (d.noiseOct   != null) { noiseOctInput.value    = d.noiseOct;   if (noiseOctVal)   noiseOctVal.value   = d.noiseOct; }
  if (d.noisePers  != null) { noisePersInput.value   = d.noisePers;  if (noisePersVal)  noisePersVal.value  = d.noisePers; }
  if (d.ampScale   != null) inputAmpScale.value  = d.ampScale;
  if (d.maxFrames  != null) inputMaxFrames.value = d.maxFrames;
  if (d.mode       != null) { modeSelect.value = d.mode; currentMode = d.mode; }
}

// ---------------------------------------------------------------------------
// Config helper
// ---------------------------------------------------------------------------
function getConfig() {
  const maxFrames  = Math.max(8,   Math.min(256, parseInt(inputMaxFrames.value)  || 64));
  const ampScale   = Math.max(0.1, Math.min(10,  parseFloat(inputAmpScale.value) || 2.0));
  const feedRate   = Math.max(100, Math.min(10000, parseInt(inputFeedRate.value)  || 3000));
  const offsetX    = parseFloat(inputOffsetX.value) || 0;
  const offsetY    = parseFloat(inputOffsetY.value) || 0;
  const penUpZ     = Math.max(-20, Math.min(20,  parseFloat(inputPenUpZ.value)   ?? 5));
  const penDownZ   = Math.max(-20, Math.min(20,  parseFloat(inputPenDownZ.value) ?? 0));
  const penMode    = inputPenMode.value || 'z';
  const penUpS     = Math.max(0, Math.min(1000, parseInt(inputPenUpS.value)   || 80));
  const penDownS   = Math.max(0, Math.min(1000, parseInt(inputPenDownS.value) || 50));
  const penYComp   = parseFloat(inputPenComp.value) || 0;
  const fftSize    = Math.max(32,  Math.min(2048, parseInt(inputFftSize.value)    || 512));
  const recordFps  = Math.max(1,   Math.min(30,   parseFloat(inputRecordFps.value) || 10));
  return { maxFrames, ampScale, feedRate, offsetX, offsetY, penUpZ, penDownZ, penMode, penUpS, penDownS, penYComp, fftSize, recordFps, amplitudeScaleMm: ampScale, coreXY: jogCoreXY.checked };
}

function getScale() {
  return Math.max(0.1, Math.min(10, parseFloat(inputImportScale.value) || 1.0));
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
    btnSerialSend.disabled = true;
    btnFrame.disabled = true;
    btnCalSweep.disabled = !serial.isAvailable();
    btnRerender.disabled = true;
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
    btnSerialSend.disabled = true;
    btnFrame.disabled = true;
    btnCalSweep.disabled = true;
    btnRerender.disabled = true;
    modeSelect.disabled = true;
    shapeSelect.disabled = true;
    setInputsDisabled(true);
    statusLabel.textContent = 'Recording';
    statusLabel.className   = 'active';
  } else if (state === 'STOPPED') {
    btnRecord.textContent = 'Record';
    btnRecord.classList.remove('recording');
    const hasFrames = recorder.getFrameCount() > 0;
    const hasPaths  = _hasPlottablePaths();
    btnExport.disabled = !hasPaths;
    btnExportAnaglyph.disabled = !hasPaths;
    btnSerialSend.disabled = !hasPaths || !serial.isAvailable();
    btnFrame.disabled = !hasPaths || !serial.isAvailable();
    btnCalSweep.disabled = !serial.isAvailable();
    btnRerender.disabled = !hasFrames;
    modeSelect.disabled = false;
    shapeSelect.disabled = false;
    setInputsDisabled(false);
    statusLabel.textContent = hasFrames
      ? `Captured ${recorder.getFrameCount()} frames`
      : `Imported ${importedPathCount} paths`;
    statusLabel.className   = 'done';
  }
}

function setInputsDisabled(disabled) {
  inputMaxFrames.disabled = disabled;
  inputAmpScale.disabled  = disabled;
  inputFeedRate.disabled  = disabled;
  inputPenUpZ.disabled    = disabled;
  inputPenDownZ.disabled  = disabled;
  inputFftSize.disabled   = disabled;
  inputRecordFps.disabled = disabled;
  inputSmoothing.disabled = disabled;
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
    _clearImportedPaths();
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
    offsetX:    cfg.offsetX,
    offsetY:    cfg.offsetY,
    penUpZ:     cfg.penUpZ,
    penDownZ:   cfg.penDownZ,
    penMode:    cfg.penMode,
    penUpS:     cfg.penUpS,
    penDownS:   cfg.penDownS,
    penYComp:   cfg.penYComp,
    coreXY:     cfg.coreXY,
    camera:     visualizer.getCameraState(),
  };
}

// ---------------------------------------------------------------------------
// Events: Import G-code / Test Pattern buttons
// ---------------------------------------------------------------------------
btnImportGCode.addEventListener('click', () => {
  fileImportGCode.click();
});

fileImportGCode.addEventListener('change', async () => {
  const file = fileImportGCode.files?.[0];
  if (!file) return;

  try {
    const content = await file.text();
    const { paths, stats } = gcode.parseGCodePaths(content);
    if (paths.length === 0) {
      statusLabel.textContent = 'No drawable G1 XY paths found';
      statusLabel.className   = '';
      return;
    }

    recorder.reset();
    importedPathCount = paths.length;
    visualizer.showImportedGCodePaths(paths, getScale());
    const importCamPos = [0, 24, 14];
    const importCamTgt = [0, 0, 10];
    visualizer.setCameraState(importCamPos, importCamTgt);
    cameraPosInput.value = importCamPos.join(' ');
    cameraTargetInput.value = importCamTgt.join(' ');
    setAppState('STOPPED');
    frameCounter.textContent = `${paths.length} imported paths`;
    statusLabel.textContent  = `Imported ${paths.length} paths (${stats.draws} draw moves)`;
    statusLabel.className    = 'done';
  } catch (err) {
    statusLabel.textContent = `Import failed: ${err?.message ?? err}`;
    statusLabel.className   = '';
  } finally {
    fileImportGCode.value = '';
  }
});

btnTestPattern.addEventListener('click', () => {
  try {
    // Generate a 50mm × 50mm test square with 10mm grid
    // positioned at (60, 60) to be centered-ish on A4 paper
    const content = gcode.generateCalibrationPattern(50, 10, 60, 60);
    const { paths, stats } = gcode.parseGCodePaths(content);
    if (paths.length === 0) {
      statusLabel.textContent = 'Test pattern failed to parse';
      statusLabel.className   = '';
      return;
    }

    recorder.reset();
    importedPathCount = paths.length;
    visualizer.showImportedGCodePaths(paths, getScale());
    const importCamPos = [0, 24, 14];
    const importCamTgt = [0, 0, 10];
    visualizer.setCameraState(importCamPos, importCamTgt);
    cameraPosInput.value = importCamPos.join(' ');
    cameraTargetInput.value = importCamTgt.join(' ');
    setAppState('STOPPED');
    frameCounter.textContent = `${paths.length} test paths`;
    statusLabel.textContent  = `Loaded test pattern: ${paths.length} paths (${stats.draws} draw moves)`;
    statusLabel.className    = 'done';
  } catch (err) {
    statusLabel.textContent = `Test pattern failed: ${err?.message ?? err}`;
    statusLabel.className   = '';
  }
});

btnExport.addEventListener('click', () => {
  if (!_hasPlottablePaths()) return;

  const params = _buildExportParams();
  const paths  = _getActiveProjectedPaths();
  if (!paths.length) return;

  const content = gcode.projectedPathsToGCode(paths, {
    feedRate:        params.feedRate,
    penDownFeedRate: 300,
    penUpZ:          params.penUpZ,
    penDownZ:        params.penDownZ,
    penMode:         params.penMode,
    penUpS:          params.penUpS,
    penDownS:        params.penDownS,
    penYComp:        params.penYComp,
    coreXY:          params.coreXY,
    offsetX:         params.offsetX,
    offsetY:         params.offsetY,
    aspect:          visualizer.getCameraAspect(),
    params,
  });
  gcode.downloadGCode(content, gcode.generateFilename(params));
});

// ---------------------------------------------------------------------------
// Event: Export Anaglyph button
// ---------------------------------------------------------------------------
btnExportAnaglyph.addEventListener('click', () => {
  if (!_hasPlottablePaths()) return;

  const params = _buildExportParams();
  const { leftPaths, rightPaths } = visualizer.getStereoPaths(0.65);

  const content = gcode.stereoPathsToGCode(leftPaths, rightPaths, {
    feedRate:        params.feedRate,
    penDownFeedRate: 300,
    penUpZ:          params.penUpZ,
    penDownZ:        params.penDownZ,
    penMode:         params.penMode,
    penUpS:          params.penUpS,
    penDownS:        params.penDownS,
    penYComp:        params.penYComp,
    coreXY:          params.coreXY,
    offsetX:         params.offsetX,
    offsetY:         params.offsetY,
    aspect:          visualizer.getCameraAspect(),
    params,
  });
  gcode.downloadGCode(content, gcode.generateFilename(params).replace('.gcode', '-anaglyph.gcode'));
});

// ---------------------------------------------------------------------------
// Event: Send to Plotter button (Web Serial → GRBL)
// ---------------------------------------------------------------------------
btnSerialSend.addEventListener('click', async () => {
  // If currently sending, cancel and stop.
  if (serial.isSending()) {
    serial.cancelSend();
    return;
  }
  if (serial.isBusy()) return;

  if (!_hasPlottablePaths()) return;

  // Connect if not already open.
  if (!serial.isConnected()) {
    try {
      statusLabel.textContent = 'Connecting to plotter…';
      statusLabel.className   = 'active';
      await serial.connect();
    } catch (err) {
      // User cancelled the port picker or the port failed to open.
      const msg = err?.message ?? String(err);
      statusLabel.textContent = msg.includes('No port selected') ? 'No port selected' : `Connect failed: ${msg}`;
      statusLabel.className   = '';
      return;
    }
  }

  // Build G-code (same projection as the Export button).
  const params  = _buildExportParams();
  const paths   = _getActiveProjectedPaths();
  if (!paths.length) return;
  const content = gcode.projectedPathsToGCode(paths, {
    feedRate:        params.feedRate,
    penDownFeedRate: 300,
    penUpZ:          params.penUpZ,
    penDownZ:        params.penDownZ,
    penMode:         params.penMode,
    penUpS:          params.penUpS,
    penDownS:        params.penDownS,
    penYComp:        params.penYComp,
    coreXY:          params.coreXY,
    offsetX:         params.offsetX,
    offsetY:         params.offsetY,
    aspect:          visualizer.getCameraAspect(),
    params,
  });

  // Stream to GRBL.
  btnSerialSend.textContent = 'Cancel';
  btnSerialSend.disabled    = false;

  try {
    statusLabel.className = 'active';
    const { cancelled } = await serial.sendGCode(content, (sent, total) => {
      statusLabel.textContent = `Sending ${sent} / ${total}`;
    });
    if (cancelled) {
      statusLabel.textContent = 'Send cancelled';
      statusLabel.className   = '';
    } else {
      statusLabel.textContent = 'Plot sent';
      statusLabel.className   = 'done';
    }
  } catch (err) {
    statusLabel.textContent = `Plotter error: ${err?.message ?? err}`;
    statusLabel.className   = '';
  } finally {
    btnSerialSend.textContent = 'Send to Plotter';
    btnSerialSend.disabled    = false;
  }
});

// ---------------------------------------------------------------------------
// Event: Frame button — trace plot bounding box with pen raised
// ---------------------------------------------------------------------------
btnFrame.addEventListener('click', async () => {
  if (serial.isSending()) {
    serial.cancelSend();
    return;
  }
  if (serial.isBusy()) return;
  if (!_hasPlottablePaths()) return;

  if (!serial.isConnected()) {
    try {
      statusLabel.textContent = 'Connecting to plotter…';
      statusLabel.className   = 'active';
      await serial.connect();
    } catch (err) {
      statusLabel.textContent = 'No port selected';
      statusLabel.className   = '';
      return;
    }
  }

  const params  = _buildExportParams();
  const paths   = _getActiveProjectedPaths();
  const content = gcode.frameGCode(paths, {
    penUpZ:  params.penUpZ,
    penUpS:  params.penUpS,
    penMode: params.penMode,
    coreXY:  params.coreXY,
    offsetX: params.offsetX,
    offsetY: params.offsetY,
    aspect:  visualizer.getCameraAspect(),
  });
  if (!content) return;

  btnFrame.textContent = 'Stop Frame';
  btnFrame.disabled    = false;
  try {
    statusLabel.className = 'active';
    statusLabel.textContent = 'Framing…';
    const { cancelled } = await serial.sendGCode(content);
    statusLabel.textContent = cancelled ? 'Frame cancelled' : 'Frame complete';
    statusLabel.className   = '';
  } catch (err) {
    statusLabel.textContent = `Frame error: ${err?.message ?? err}`;
    statusLabel.className   = '';
  } finally {
    btnFrame.textContent = 'Frame';
    btnFrame.disabled    = false;
  }
});

// ---------------------------------------------------------------------------
// Event: Cal Sweep button — Y compensation calibration sweep
// ---------------------------------------------------------------------------
btnCalSweep.addEventListener('click', async () => {
  if (serial.isSending()) {
    serial.cancelSend();
    return;
  }
  if (serial.isBusy()) return;

  if (!serial.isConnected()) {
    try {
      statusLabel.textContent = 'Connecting to plotter…';
      statusLabel.className   = 'active';
      await serial.connect();
    } catch (err) {
      statusLabel.textContent = 'No port selected';
      statusLabel.className   = '';
      return;
    }
  }

  const cfg     = getConfig();
  const content = gcode.calSweepGCode({
    penMode:         cfg.penMode,
    penUpZ:          cfg.penUpZ,
    penDownZ:        cfg.penDownZ,
    penUpS:          cfg.penUpS,
    penDownS:        cfg.penDownS,
    penYComp:        cfg.penYComp,
    feedRate:        cfg.feedRate,
    coreXY:          cfg.coreXY,
    calYMax:         parseFloat(inputCalYMax.value) || 260,
    calYStep:        parseFloat(inputCalStep.value) || 20,
  });

  btnCalSweep.textContent = 'Stop Cal';
  btnCalSweep.disabled    = false;
  try {
    statusLabel.className   = 'active';
    statusLabel.textContent = 'Calibrating…';
    const { cancelled } = await serial.sendGCode(content, (sent, total) => {
      statusLabel.textContent = `Cal ${sent} / ${total}`;
    });
    statusLabel.textContent = cancelled ? 'Cal cancelled' : 'Cal complete';
    statusLabel.className   = '';
  } catch (err) {
    statusLabel.textContent = `Cal error: ${err?.message ?? err}`;
    statusLabel.className   = '';
  } finally {
    btnCalSweep.textContent = 'Cal';
    btnCalSweep.disabled    = false;
  }
});

// ---------------------------------------------------------------------------
// Plotter machine controls (Home, Set Origin, Pen Up/Down)
// Each button auto-connects if needed, then sends a single GRBL command.
// ---------------------------------------------------------------------------

async function _plotterCommand(cmd) {
  if (!serial.isAvailable()) return;
  if (serial.isBusy()) return;
  if (!serial.isConnected()) {
    try {
      statusLabel.textContent = 'Connecting to plotter…';
      statusLabel.className   = 'active';
      await serial.connect();
    } catch (err) {
      statusLabel.textContent = 'No port selected';
      statusLabel.className   = '';
      return;
    }
  }
  try {
    await serial.sendCommand(cmd);
    statusLabel.textContent = `Done: ${cmd}`;
    statusLabel.className   = 'done';
  } catch (err) {
    statusLabel.textContent = `Plotter error: ${err?.message ?? err}`;
    statusLabel.className   = '';
  }
}

btnPlotterHome.addEventListener('click', () => _plotterCommand('$H'));

btnPlotterZeroXY.addEventListener('click', () => _plotterCommand('G92 X0 Y0'));

btnPlotterZeroZ.addEventListener('click', () => _plotterCommand('G92 Z0'));

btnPlotterPenUp.addEventListener('click', () => {
  if (inputPenMode.value === 'servo') {
    const s = parseInt(inputPenUpS.value) || 80;
    _plotterCommand(`M3 S${s}`);
  } else {
    const z = parseFloat(inputPenUpZ.value) || 5;
    _plotterCommand(`G0 Z${z.toFixed(3)}`);
  }
});

btnPlotterPenDown.addEventListener('click', () => {
  if (inputPenMode.value === 'servo') {
    const s = parseInt(inputPenDownS.value) || 50;
    _plotterCommand(`M3 S${s}`);
  } else {
    const z = parseFloat(inputPenDownZ.value) ?? 0;
    _plotterCommand(`G1 Z${z.toFixed(3)} F300`);
  }
});

btnServoSweep.addEventListener('click', async () => {
  if (serial.isSending()) {
    serial.cancelSend();
    return;
  }
  if (serial.isBusy()) return;
  if (!serial.isAvailable()) return;
  if (!serial.isConnected()) {
    try {
      statusLabel.textContent = 'Connecting to plotter…';
      statusLabel.className   = 'active';
      await serial.connect();
    } catch (err) {
      statusLabel.textContent = 'No port selected';
      statusLabel.className   = '';
      return;
    }
  }

  // Build M3 ramp: S1 → S1000 → S1 in steps of 5, 100 ms dwell each step.

  const sweepStart = 1;
  const sweepEnd   = 1000;
  const sweepStep  = 5;
  const sweepDwell = 0.1;

  const lines = [];
  for (let s = sweepStart; s <= sweepEnd; s += sweepStep) { lines.push(`M3 S${s}`, `G4 P${sweepDwell}`); }
  for (let s = sweepEnd; s >= sweepStart; s -= sweepStep)  { lines.push(`M3 S${s}`, `G4 P${sweepDwell}`); }
  lines.push('M5');
  const content = lines.join('\n');

  btnServoSweep.textContent = 'Stop Sweep';
  try {
    statusLabel.className = 'active';
    const { cancelled } = await serial.sendGCode(content, (sent, total) => {
      statusLabel.textContent = `Sweep ${sent} / ${total}`;
    });
    statusLabel.textContent = cancelled ? 'Sweep cancelled' : 'Sweep complete';
    statusLabel.className   = '';
  } catch (err) {
    statusLabel.textContent = `Sweep error: ${err?.message ?? err}`;
    statusLabel.className   = '';
  } finally {
    btnServoSweep.textContent = 'Sweep S';
  }
});

function _updatePenModeVis() {
  const isServo = inputPenMode.value === 'servo';
  zUpCtrl.classList.toggle('hidden', isServo);
  zDownCtrl.classList.toggle('hidden', isServo);
  servoUpCtrl.classList.toggle('hidden', !isServo);
  servoDownCtrl.classList.toggle('hidden', !isServo);
  servoCompCtrl.classList.toggle('hidden', !isServo);
}

inputPenMode.addEventListener('change', _updatePenModeVis);

// Jog — uses GRBL's $J command (relative move, never touches work coordinates).
async function _jog(axis, dir) {
  if (!serial.isAvailable()) return;
  const step      = parseFloat(jogStepSelect.value) || 1;
  const feedRate  = step <= 0.1 ? 400 : step <= 1 ? 2000 : 5000;
  const d         = dir * step;

  // Apply axis swap (X↔Y, Z is never swapped).
  const physAxis = (jogSwapXY.checked && axis !== 'Z')
    ? (axis === 'X' ? 'Y' : 'X')
    : axis;

  // Build the GRBL jog command.
  // CoreXY mode: a single physical axis requires driving both GRBL motors.
  //   Physical X+ → motor A fwd + motor B fwd  → X+{d} Y+{d}
  //   Physical Y+ → motor A fwd + motor B back  → X+{d} Y-{d}
  let cmd;
  if (jogCoreXY.checked && physAxis !== 'Z') {
    const ds = d.toFixed(3);
    const dn = (-d).toFixed(3);
    cmd = physAxis === 'X'
      ? `$J=G21 G91 X${ds} Y${ds} F${feedRate}`
      : `$J=G21 G91 X${ds} Y${dn} F${feedRate}`;
  } else {
    cmd = `$J=G21 G91 ${physAxis}${d.toFixed(3)} F${feedRate}`;
  }

  await _plotterCommand(cmd);
}

btnJogXP.addEventListener('click', () => _jog('X',  1));
btnJogXM.addEventListener('click', () => _jog('X', -1));
btnJogYP.addEventListener('click', () => _jog('Y',  1));
btnJogYM.addEventListener('click', () => _jog('Y', -1));
btnJogZP.addEventListener('click', () => _jog('Z',  1));
btnJogZM.addEventListener('click', () => _jog('Z', -1));

// ---------------------------------------------------------------------------
// Serial Monitor
// ---------------------------------------------------------------------------

const MAX_MONITOR_LINES = 500;
const monitorCommandHistory = [];
let monitorHistoryIndex = -1;

function _appendMonitorLine(type, text) {
  const wasAtBottom =
    monitorLog.scrollHeight - monitorLog.scrollTop <= monitorLog.clientHeight + 4;

  const el = document.createElement('div');
  el.className = `monitor-line monitor-${type}`;
  if (type === 'rx') {
    if (text === 'ok') el.classList.add('monitor-ok');
    else if (text.startsWith('error') || text.startsWith('ALARM')) el.classList.add('monitor-err');
  }
  const prefix = type === 'tx' ? '> ' : type === 'rx' ? '< ' : '  ';
  el.textContent = prefix + text;

  if (monitorLog.children.length >= MAX_MONITOR_LINES) {
    monitorLog.removeChild(monitorLog.firstChild);
  }
  monitorLog.appendChild(el);

  if (wasAtBottom) monitorLog.scrollTop = monitorLog.scrollHeight;
}

function _updateMonitorConnStatus() {
  if (serial.isConnected()) {
    monitorConnStatus.textContent = '● connected';
    monitorConnStatus.classList.add('connected');
  } else {
    monitorConnStatus.textContent = '○ not connected';
    monitorConnStatus.classList.remove('connected');
  }
}

// Register the serial event listener so all tx/rx/info flows through the log.
serial.addMonitorListener((type, text) => {
  _appendMonitorLine(type, text);
  if (type === 'info') _updateMonitorConnStatus();
});

// Toggle open / close.
btnMonitorToggle.addEventListener('click', () => {
  const nowHidden = serialMonitor.classList.toggle('hidden');
  btnMonitorToggle.classList.toggle('active', !nowHidden);
  if (!nowHidden) {
    monitorLog.scrollTop = monitorLog.scrollHeight;
    _updateMonitorConnStatus();
    monitorInput.focus();
  }
});

btnMonitorClose.addEventListener('click', () => {
  serialMonitor.classList.add('hidden');
  btnMonitorToggle.classList.remove('active');
});

btnMonitorClear.addEventListener('click', () => {
  monitorLog.innerHTML = '';
});

// Send a command from the monitor input — auto-connects if needed.
async function _monitorSend() {
  const cmd = monitorInput.value.trim();
  if (!cmd) return;

  monitorCommandHistory.push(cmd);
  monitorHistoryIndex = -1;
  monitorInput.value = '';

  if (!serial.isAvailable()) {
    _appendMonitorLine('info', 'Web Serial not available in this browser');
    return;
  }
  if (!serial.isConnected()) {
    try {
      _appendMonitorLine('info', 'Connecting…');
      await serial.connect();
      _updateMonitorConnStatus();
    } catch (err) {
      _appendMonitorLine('info', `Connect failed: ${err?.message ?? err}`);
      return;
    }
  }
  try {
    await serial.sendCommand(cmd);
  } catch (err) {
    _appendMonitorLine('info', `Error: ${err?.message ?? err}`);
  }
}

btnMonitorSend.addEventListener('click', _monitorSend);
monitorInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    _monitorSend();
    return;
  }

  if (e.key === 'ArrowUp') {
    if (!monitorCommandHistory.length) return;
    e.preventDefault();
    if (monitorHistoryIndex === -1) monitorHistoryIndex = monitorCommandHistory.length - 1;
    else monitorHistoryIndex = Math.max(0, monitorHistoryIndex - 1);
    monitorInput.value = monitorCommandHistory[monitorHistoryIndex];
    monitorInput.setSelectionRange(monitorInput.value.length, monitorInput.value.length);
    return;
  }

  if (e.key === 'ArrowDown') {
    if (!monitorCommandHistory.length || monitorHistoryIndex === -1) return;
    e.preventDefault();
    if (monitorHistoryIndex >= monitorCommandHistory.length - 1) {
      monitorHistoryIndex = -1;
      monitorInput.value = '';
      return;
    }
    monitorHistoryIndex += 1;
    monitorInput.value = monitorCommandHistory[monitorHistoryIndex];
    monitorInput.setSelectionRange(monitorInput.value.length, monitorInput.value.length);
  }
});

// ---------------------------------------------------------------------------
/**
 * Rebuild the 3D visualization from stored frames using current settings.
 * Only meaningful in STOPPED state with captured frames.
 */
function _rerender() {
  if (recorder.getFrameCount() === 0) return;
  visualizer.updateConfig(getConfig());
  visualizer.replayFrames(recorder.getFrames());
}

btnRerender.addEventListener('click', _rerender);

// Reactive amp-scale: re-render immediately when slider moves in STOPPED state
// so the user sees the effect before exporting.
inputAmpScale.addEventListener('input', () => {
  if (appState === 'STOPPED') _rerender();
});

// ---------------------------------------------------------------------------
// Event: Data mode change
// ---------------------------------------------------------------------------
modeSelect.addEventListener('change', async () => {
  const newMode = modeSelect.value;
  if (newMode === currentMode) return;

  currentMode = newMode;
  _clearImportedPaths();
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
  _clearImportedPaths();
  _applyShapeSourceDefaults(currentSource, newShape);
  visualizer.setShape(newShape);

  // Apply saved preset for this combo, if any
  _applyPreset(currentSource, newShape);
  if (currentSource === 'noise') _applyNoiseConfig();
  _updatePresetUI();

  if (appState === 'STOPPED' && recorder.getFrameCount() > 0) {
    // Re-render existing frames in the new shape — no re-recording needed.
    _rerender();
  } else {
    recorder.reset();
    btnExport.disabled = true;
    btnExportAnaglyph.disabled = true;
    btnRerender.disabled = true;
    frameCounter.textContent = '0 frames';
    if (appState === 'STOPPED') setAppState('IDLE');
  }
});

// ---------------------------------------------------------------------------
// Event: Source change
// ---------------------------------------------------------------------------
sourceSelect.addEventListener('change', () => {
  currentSource = sourceSelect.value;
  _clearImportedPaths();

  // Show/hide noise panel
  noiseSection.classList.toggle('hidden', currentSource !== 'noise');
  micOnlyCtrls.forEach(el => el.classList.toggle('hidden', currentSource !== 'mic'));

  // Apply preset if saved for this combo; otherwise fall back to built-in defaults
  _applyPreset(currentSource, currentShape) || _applyShapeSourceDefaults(currentSource, currentShape);

  // Pre-configure noise when switching to it so live preview starts immediately
  if (currentSource === 'noise') {
    const cfg = getConfig();
    noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
    noise.reset();
  }

  _updatePresetUI();

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

// Smoothing — mic frequency mode only
inputSmoothing.addEventListener('input', () => {
  audio.setSmoothing(parseFloat(inputSmoothing.value));
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

btnCameraReset.addEventListener('click', () => {
  visualizer.resetCamera();
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
    const recordEveryN = Math.max(1, Math.round(RAF_FPS / (parseFloat(inputRecordFps.value) || 10)));
    if (recorder.isRecording() && tickCount % recordEveryN === 0) {
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
// Settings persistence (localStorage)
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'gcode-viz';

function _saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      source:    sourceSelect.value,
      shape:     shapeSelect.value,
      mode:      modeSelect.value,
      noiseType: noiseTypeSelect.value,
      noiseSeed: noiseSeedInput.value,
      noiseSpeed: noiseSpeedInput.value,
      noiseFreq:  noiseFreqInput.value,
      noiseOct:   noiseOctInput.value,
      noisePers:  noisePersInput.value,
      maxFrames:  inputMaxFrames.value,
      ampScale:   inputAmpScale.value,
      feedRate:   inputFeedRate.value,
      offsetX:    inputOffsetX.value,
      offsetY:    inputOffsetY.value,
      penUpZ:     inputPenUpZ.value,
      penDownZ:   inputPenDownZ.value,
      penMode:    inputPenMode.value,
      penUpS:     inputPenUpS.value,
      penDownS:   inputPenDownS.value,
      penYComp:   inputPenComp.value,
      calYMax:    inputCalYMax.value,
      calYStep:   inputCalStep.value,
      fftSize:    inputFftSize.value,
      recordFps:  inputRecordFps.value,
      smoothing:  inputSmoothing.value,
      cameraPos:  cameraPosInput.value,
      cameraTgt:  cameraTargetInput.value,
      jogSwapXY:  jogSwapXY.checked,
      jogCoreXY:  jogCoreXY.checked,
    }));
  } catch (_) { /* private browsing / quota */ }
}

function _loadSettings() {
  let s;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    s = JSON.parse(raw);
  } catch (_) { return; }

  const apply = (el, v) => { if (v != null) el.value = v; };
  apply(sourceSelect,      s.source);
  apply(shapeSelect,       s.shape);
  apply(modeSelect,        s.mode);
  apply(noiseTypeSelect,   s.noiseType);
  apply(noiseSeedInput,    s.noiseSeed);
  apply(noiseSpeedInput,   s.noiseSpeed);
  apply(noiseFreqInput,    s.noiseFreq);
  apply(noiseOctInput,     s.noiseOct);
  apply(noisePersInput,    s.noisePers);
  apply(inputMaxFrames,    s.maxFrames);
  apply(inputAmpScale,     s.ampScale);
  apply(inputFeedRate,     s.feedRate);
  apply(inputOffsetX,      s.offsetX);
  apply(inputOffsetY,      s.offsetY);
  apply(inputPenUpZ,       s.penUpZ);
  apply(inputPenDownZ,     s.penDownZ);
  apply(inputPenMode,      s.penMode);
  apply(inputPenUpS,       s.penUpS);
  apply(inputPenDownS,     s.penDownS);
  apply(inputPenComp,      s.penYComp);
  apply(inputCalYMax,      s.calYMax);
  apply(inputCalStep,      s.calYStep);
  apply(inputFftSize,      s.fftSize);
  apply(inputRecordFps,    s.recordFps);
  apply(inputSmoothing,    s.smoothing);
  apply(cameraPosInput,    s.cameraPos);
  apply(cameraTargetInput, s.cameraTgt);
  if (s.jogSwapXY != null) jogSwapXY.checked = s.jogSwapXY;
  if (s.jogCoreXY != null) jogCoreXY.checked = s.jogCoreXY;

  // Sync JS state variables to restored values
  if (s.source) currentSource = s.source;
  if (s.shape)  currentShape  = s.shape;
  if (s.mode)   currentMode   = s.mode;

  // Apply restored smoothing to audio module
  if (s.smoothing != null) audio.setSmoothing(parseFloat(s.smoothing));

  // Sync conditional UI visibility
  noiseSection.classList.toggle('hidden', currentSource !== 'noise');
  micOnlyCtrls.forEach(el => el.classList.toggle('hidden', currentSource !== 'mic'));
  _syncNoiseOctaveControls();
  _updatePenModeVis();

  // Sync output display elements for range sliders
  if (noiseSpeedVal) noiseSpeedVal.value = noiseSpeedInput.value;
  if (noiseFreqVal)  noiseFreqVal.value  = noiseFreqInput.value;
  if (noiseOctVal)   noiseOctVal.value   = noiseOctInput.value;
  if (noisePersVal)  noisePersVal.value  = noisePersInput.value;
}

// Save on any input or select change (event delegation — covers all controls).
['change', 'input'].forEach(evt =>
  document.addEventListener(evt, e => {
    if (e.target.matches('input, select')) _saveSettings();
  })
);

// ---------------------------------------------------------------------------
// Per-combination presets (localStorage)
// Separate from session state — user must explicitly save/clear.
// ---------------------------------------------------------------------------
const PRESETS_KEY = 'gcode-viz-presets';

function _presetKey() { return `${currentSource}:${currentShape}`; }

function _getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); } catch (_) { return {}; }
}

function _hasPreset(source, shape) {
  return Object.prototype.hasOwnProperty.call(_getPresets(), `${source}:${shape}`);
}

/** Snapshot current settings and store as the preset for the active combo. */
function _savePreset() {
  const presets = _getPresets();
  presets[_presetKey()] = {
    mode:      modeSelect.value,
    noiseType: noiseTypeSelect.value,
    noiseSeed: noiseSeedInput.value,
    noiseSpeed: noiseSpeedInput.value,
    noiseFreq:  noiseFreqInput.value,
    noiseOct:   noiseOctInput.value,
    noisePers:  noisePersInput.value,
    maxFrames:  inputMaxFrames.value,
    ampScale:   inputAmpScale.value,
    feedRate:   inputFeedRate.value,
    penUpZ:     inputPenUpZ.value,
    penDownZ:   inputPenDownZ.value,
    penMode:    inputPenMode.value,
    penUpS:     inputPenUpS.value,
    penDownS:   inputPenDownS.value,
    fftSize:    inputFftSize.value,
    recordFps:  inputRecordFps.value,
    smoothing:  inputSmoothing.value,
    cameraPos:  cameraPosInput.value,
    cameraTgt:  cameraTargetInput.value,
  };
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch (_) {}
  _updatePresetUI();
}

/** Remove the saved preset for the active combo. */
function _clearPreset() {
  const presets = _getPresets();
  delete presets[_presetKey()];
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch (_) {}
  _updatePresetUI();
}

/**
 * Apply the saved preset for a source+shape combo to the DOM.
 * Returns true if a preset was found and applied, false otherwise.
 */
function _applyPreset(source, shape) {
  const preset = _getPresets()[`${source}:${shape}`];
  if (!preset) return false;

  const apply = (el, v) => { if (v != null) el.value = v; };
  apply(modeSelect,        preset.mode);
  apply(noiseTypeSelect,   preset.noiseType);
  apply(noiseSeedInput,    preset.noiseSeed);
  apply(noiseSpeedInput,   preset.noiseSpeed);
  apply(noiseFreqInput,    preset.noiseFreq);
  apply(noiseOctInput,     preset.noiseOct);
  apply(noisePersInput,    preset.noisePers);
  apply(inputMaxFrames,    preset.maxFrames);
  apply(inputAmpScale,     preset.ampScale);
  apply(inputFeedRate,     preset.feedRate);
  apply(inputPenUpZ,       preset.penUpZ);
  apply(inputPenDownZ,     preset.penDownZ);
  apply(inputPenMode,      preset.penMode);
  apply(inputPenUpS,       preset.penUpS);
  apply(inputPenDownS,     preset.penDownS);
  apply(inputFftSize,      preset.fftSize);
  apply(inputRecordFps,    preset.recordFps);
  apply(inputSmoothing,    preset.smoothing);
  apply(cameraPosInput,    preset.cameraPos);
  apply(cameraTargetInput, preset.cameraTgt);

  if (preset.mode) currentMode = preset.mode;
  if (preset.smoothing != null) audio.setSmoothing(parseFloat(preset.smoothing));

  // Sync visible state
  _syncNoiseOctaveControls();
  _updatePenModeVis();
  if (noiseSpeedVal) noiseSpeedVal.value = noiseSpeedInput.value;
  if (noiseFreqVal)  noiseFreqVal.value  = noiseFreqInput.value;
  if (noiseOctVal)   noiseOctVal.value   = noiseOctInput.value;
  if (noisePersVal)  noisePersVal.value  = noisePersInput.value;

  // Apply camera if visualizer is ready
  const pos = _parseVec3(cameraPosInput.value);
  const tgt = _parseVec3(cameraTargetInput.value);
  if (pos && tgt && vizReady) visualizer.setCameraState(pos, tgt);

  _saveSettings();  // persist the now-active preset settings as session state
  return true;
}

/** Update the ★ indicator and Save button style for the current combo. */
function _updatePresetUI() {
  const has = _hasPreset(currentSource, currentShape);
  presetIndicator.textContent = has ? '★' : '';
  btnPresetSave.classList.toggle('active', has);
  btnPresetClear.style.visibility = has ? 'visible' : 'hidden';
}

btnPresetSave.addEventListener('click', _savePreset);
btnPresetClear.addEventListener('click', _clearPreset);

// ---------------------------------------------------------------------------
// Kick off rAF loop immediately (visualizer.init is called later on first
// Record click to satisfy AudioContext user-gesture requirement).
// Pre-init the visualizer with canvas so OrbitControls are available right away.
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  // Restore saved settings before init so getConfig() and currentShape reflect them.
  _loadSettings();
  // Ensure mic-only controls match initial source (handles fresh session with no saved state).
  micOnlyCtrls.forEach(el => el.classList.toggle('hidden', currentSource !== 'mic'));
  // Ensure pen mode controls match initial setting.
  _updatePenModeVis();
  // Show preset indicator for the restored combo.
  _updatePresetUI();

  // Pre-init the visualizer (no audio needed).
  visualizer.init(canvas, getConfig());
  // Apply saved/default shape — positions camera to shape default.
  visualizer.setShape(currentShape);

  // If the user had a custom camera saved, apply it now (overrides shape default).
  const savedPos = _parseVec3(cameraPosInput.value);
  const savedTgt = _parseVec3(cameraTargetInput.value);
  if (savedPos && savedTgt) visualizer.setCameraState(savedPos, savedTgt);

  vizReady = true;
  setAppState('IDLE');

  // Pre-configure noise with defaults so it's ready instantly on source switch.
  const cfg = getConfig();
  noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });

  // Hide serial-dependent UI if Web Serial API is not available.
  if (!serial.isAvailable()) {
    btnSerialSend.style.display  = 'none';
    btnFrame.style.display       = 'none';
    btnCalSweep.style.display    = 'none';
    btnMonitorToggle.style.display = 'none';
    document.getElementById('controls-plotter').style.display = 'none';
  }

  requestAnimationFrame(loop);
});

// Disconnect the serial port cleanly when the page unloads.
window.addEventListener('beforeunload', () => { serial.disconnect(); });
