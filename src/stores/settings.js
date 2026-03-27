/**
 * stores/settings.js
 * All persistent UI settings, auto-saved to localStorage.
 * Replaces the DOM-value reading and _saveSettings/_loadSettings in the old main.js.
 */

import { writable } from 'svelte/store';

const SETTINGS_KEY = 'gcode-viz';
const PRESETS_KEY  = 'gcode-viz-presets';

const DEFAULTS = {
  // Recording
  maxFrames:   64,
  ampScale:    2.0,
  fftSize:     512,
  recordFps:   10,
  smoothing:   0.5,
  // Data
  mode:        'time',
  source:      'noise',
  shape:       'terrain',
  // Noise
  noiseType:   'perlin',
  noiseSeed:   42,
  noiseSpeed:  0.005,
  noiseFreq:   2,
  noiseOct:    4,
  noisePers:   0.5,
  // G-code
  feedRate:    3000,
  offsetX:     0,
  offsetY:     0,
  penMode:     'z',
  penUpZ:      5,
  penDownZ:    0,
  penUpS:      80,
  penDownS:    50,
  penYComp:    0,
  // Calibration
  calYMax:     260,
  calYStep:    20,
  // Import
  importScale: 1.0,
  // Camera
  cameraPos:   '0 8 28',
  cameraTgt:   '0 0 10',
  // Jog
  jogSwapXY:   false,
  jogCoreXY:   false,
};

function _load() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function _save(value) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch (_) { /* private browsing / quota */ }
}

function createSettingsStore() {
  const { subscribe, set, update } = writable(_load());

  return {
    subscribe,
    set(value) {
      _save(value);
      set(value);
    },
    update(fn) {
      update(current => {
        const next = fn(current);
        _save(next);
        return next;
      });
    },
    patch(partial) {
      update(current => {
        const next = { ...current, ...partial };
        _save(next);
        return next;
      });
    },
  };
}

export const settings = createSettingsStore();

// ---------------------------------------------------------------------------
// Per-source × per-shape presets (separate from session settings)
// ---------------------------------------------------------------------------

export function getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); } catch (_) { return {}; }
}

export function hasPreset(source, shape) {
  return Object.prototype.hasOwnProperty.call(getPresets(), `${source}:${shape}`);
}

export function savePreset(key, data) {
  const presets = getPresets();
  presets[key] = data;
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch (_) {}
}

export function clearPreset(key) {
  const presets = getPresets();
  delete presets[key];
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch (_) {}
}

export function loadPreset(key) {
  return getPresets()[key] ?? null;
}
