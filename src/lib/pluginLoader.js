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
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(e => e && typeof e.id === 'string' && typeof e.code === 'string')
      : [];
  }
  catch { return []; }
}

function _save(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
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

/** IDs of built-in shapes — user plugins may not shadow or uninstall these. */
const _reservedIds = new Set(getPlugins().map(p => p.id));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Evaluate plugin source code via Blob URL and return the default export.
 *
 * SECURITY NOTE: Plugin code executes in the main app context with full origin
 * privileges (localStorage access, network requests, DOM access). This is
 * intentional for a local-only tool where the user controls what they install.
 * If this app is ever hosted or shared, replace this with a sandboxed execution
 * model — e.g. run plugin code inside a CSP-restricted Worker or sandboxed
 * <iframe>, pass only a serialisable subset of `ctx` via postMessage, and
 * receive back serialisable geometry data rather than live Three.js objects.
 */
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

  if (_reservedIds.has(plugin.id)) {
    throw new Error(`installPlugin: "${plugin.id}" conflicts with a built-in shape id`);
  }

  registerPlugin(plugin); // throws if id/label missing

  // Upsert: replace any existing entry with the same id, then append
  try {
    const entries = _load().filter(e => e.id !== plugin.id);
    entries.push({ id: plugin.id, code });
    _save(entries);
  } catch {
    unregisterPlugin(plugin.id);
    throw new Error(`installPlugin: failed to persist "${plugin.id}" — storage may be full or unavailable`);
  }

  _refreshStores();
  return { id: plugin.id, label: plugin.label };
}

/**
 * Unregister a user-installed plugin and remove it from localStorage.
 * Built-in plugins cannot be permanently removed this way.
 * @param {string} id
 */
export function uninstallPlugin(id) {
  if (_reservedIds.has(id)) return;
  unregisterPlugin(id);

  try {
    _save(_load().filter(e => e.id !== id));
  } catch {
    console.warn(`[pluginLoader] Failed to persist uninstall of "${id}" — will re-appear on reload`);
  }

  _refreshStores();
}

/**
 * Re-register all user-installed plugins persisted in localStorage.
 * Call once during app boot (fire-and-forget — failures are logged, not thrown).
 * @returns {Promise<void>}
 */
export async function restorePlugins() {
  const entries = _load();
  const restored = [];
  let dirty = false;
  for (const { id, code } of entries) {
    try {
      const plugin = await _importCode(code);
      if (_reservedIds.has(plugin.id)) {
        throw new Error(`restorePlugins: "${plugin.id}" conflicts with a built-in shape id`);
      }
      registerPlugin(plugin);
      restored.push({ id: plugin.id, code });
      dirty ||= plugin.id !== id;
    } catch (err) {
      console.warn(`[pluginLoader] Failed to restore plugin "${id}":`, err);
      dirty = true;
    }
  }
  if (dirty) _save(restored);
  _refreshStores();
}
