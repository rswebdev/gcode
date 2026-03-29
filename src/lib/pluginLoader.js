/**
 * pluginLoader.js
 *
 * Runtime plugin installation system for visualization plugins.
 * Plugins are ES modules that export a default plugin object conforming to the
 * visualizer plugin contract (see visualizer.js for the full interface).
 *
 * Minimal plugin template:
 *
 *   export default {
 *     id: 'my-shape',
 *     label: 'My Shape',
 *     cameraPosition: { pos: [0, 15, 20], lookAt: [0, 0, 10] },
 *     buildPerFrame(frameData, frameIndex, isLive, ctx) {
 *       const data = ctx.toMono(frameData);
 *       const N = data.length;
 *       const pos = new Float32Array(N * 3);
 *       const zStep = ctx.constants.SCENE_DEPTH / ctx.cfg.maxFrames;
 *       for (let i = 0; i < N; i++) {
 *         pos[i*3]   = (i / (N-1)) * ctx.constants.SCENE_W - ctx.constants.SCENE_W / 2;
 *         pos[i*3+1] = data[i] * 4 * ctx.cfg.ampScale;
 *         pos[i*3+2] = frameIndex * zStep;
 *       }
 *       return [ctx.makeLine(pos, frameIndex, isLive)];
 *     },
 *   };
 */

import { writable } from 'svelte/store';
import { registerPlugin, unregisterPlugin, getPlugins } from './visualizer.js';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gcode-viz-user-plugins';

/** @returns {{ id: string, code: string }[]} */
function _load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function _save(entries) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
  catch { /* quota / private-mode — silently ignore */ }
}

// ---------------------------------------------------------------------------
// Reactive stores
// ---------------------------------------------------------------------------

/**
 * Reactive list of all registered plugins (built-ins + user-installed).
 * Mirrors visualizer.getPlugins(); updated on every install / uninstall.
 * @type {import('svelte/store').Writable<{id:string,label:string}[]>}
 */
export const pluginList = writable(getPlugins());

/**
 * IDs of user-installed plugins (subset of pluginList).
 * Populated from localStorage on module load and kept in sync.
 * @type {import('svelte/store').Writable<string[]>}
 */
export const userPluginIds = writable(_load().map(e => e.id));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Evaluate plugin source code via Blob URL and return the default export. */
async function _importCode(code) {
  const blob = new Blob([code], { type: 'text/javascript' });
  const url  = URL.createObjectURL(blob);
  try {
    // vite-ignore: intentional dynamic import of a runtime blob URL
    const mod = await import(/* @vite-ignore */ url);
    if (!mod.default || typeof mod.default !== 'object') {
      throw new Error('Plugin file must use "export default { id, label, … }"');
    }
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function _refreshStores() {
  pluginList.set(getPlugins());
  userPluginIds.set(_load().map(e => e.id));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load, register, and persist a plugin from its source code string.
 * Throws if the code is invalid or the export is not a well-formed plugin.
 * @param {string} code  ES module source with a default-export plugin object
 * @returns {Promise<{id:string,label:string}>}  metadata of the installed plugin
 */
export async function installPlugin(code) {
  const plugin = await _importCode(code);

  registerPlugin(plugin); // throws if id/label missing

  // Upsert: replace any existing entry with the same id, then append
  const entries = _load().filter(e => e.id !== plugin.id);
  entries.push({ id: plugin.id, code });
  _save(entries);

  _refreshStores();
  return { id: plugin.id, label: plugin.label };
}

/**
 * Unregister a user-installed plugin and remove it from localStorage.
 * Built-in plugins cannot be permanently removed this way.
 * @param {string} id
 */
export function uninstallPlugin(id) {
  unregisterPlugin(id);

  const entries = _load().filter(e => e.id !== id);
  _save(entries);

  _refreshStores();
}

/**
 * Re-register all user-installed plugins persisted in localStorage.
 * Call once during app boot (fire-and-forget — failures are logged, not thrown).
 * @returns {Promise<void>}
 */
export async function restorePlugins() {
  const entries = _load();
  for (const { id, code } of entries) {
    try {
      const plugin = await _importCode(code);
      registerPlugin(plugin);
    } catch (err) {
      console.warn(`[pluginLoader] Failed to restore plugin "${id}":`, err);
    }
  }
  _refreshStores();
}
