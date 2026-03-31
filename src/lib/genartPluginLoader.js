/**
 * genartPluginLoader.js
 *
 * Runtime plugin installation for Generative Art algorithms.
 * Independent of the visualization plugin system (pluginLoader.js).
 *
 * Plugin contract — a JS module with a default export:
 *
 *   export default {
 *     id:     'my-art',      // unique string, must not conflict with built-ins
 *     label:  'My Art',      // display name
 *     params: [              // parameter descriptors (drive sidebar UI)
 *       { id: 'seed',  label: 'Seed',  type: 'number', min: 0, max: 99999, default: 42 },
 *       { id: 'count', label: 'Count', type: 'range',  min: 1, max: 100, step: 1, default: 20 },
 *       // type: 'range' | 'number' | 'select' | 'toggle'
 *       // 'select' requires: options: [{value, label}, ...]
 *     ],
 *     // Returns paths in NDC coordinates [-1, +1].
 *     generate(params): Array<Array<{nx: number, ny: number}>>
 *   };
 *
 * @typedef {{ id: string, label: string, type: 'range'|'number'|'select'|'toggle',
 *             min?: number, max?: number, step?: number,
 *             options?: {value:string,label:string}[],
 *             default: any }} GenArtParam
 */

import { writable } from 'svelte/store';

const STORAGE_KEY = 'gcode-genart-user-plugins';

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function _load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(e => e && typeof e.id === 'string' && typeof e.code === 'string')
      : [];
  } catch { return []; }
}

function _save(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// In-memory plugin registry (user-installed only — built-ins are separate)
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} */
const _registry = new Map();

// ---------------------------------------------------------------------------
// Reactive store — exposes user-installed plugin objects
// ---------------------------------------------------------------------------

/**
 * Reactive list of user-installed generative art plugins.
 * Built-in algorithms (lsystem, flowfield, …) are NOT included here.
 * @type {import('svelte/store').Writable<object[]>}
 */
export const userGenartPlugins = writable([]);

/**
 * IDs of user-installed plugins (for tracking which are deletable).
 * @type {import('svelte/store').Writable<string[]>}
 */
export const userGenartIds = writable(_load().map(e => e.id));

/** Built-in IDs are populated once by GenArt.svelte after importing alg modules. */
const _reservedIds = new Set();

/** Call this from GenArt.svelte to register built-in algorithm IDs. */
export function registerBuiltinIds(ids) {
  for (const id of ids) _reservedIds.add(id);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _refreshStores() {
  userGenartPlugins.set(Array.from(_registry.values()));
  userGenartIds.set(Array.from(_registry.keys()));
}

async function _importCode(code) {
  const blob = new Blob([code], { type: 'text/javascript' });
  const url  = URL.createObjectURL(blob);
  try {
    // vite-ignore: intentional dynamic import of a runtime blob URL
    const mod = await import(/* @vite-ignore */ url);
    const plugin = mod.default;
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('Plugin must use "export default { id, label, params, generate }"');
    }
    if (typeof plugin.id !== 'string' || !plugin.id) throw new Error('Plugin id must be a non-empty string');
    if (!plugin.label) throw new Error('Plugin label is required');
    if (!Array.isArray(plugin.params)) throw new Error('Plugin params must be an array');
    if (typeof plugin.generate !== 'function') throw new Error('Plugin must export a generate(params) function');

    // Deep-validate each param entry.
    const SUPPORTED_TYPES = new Set(['range', 'number', 'select', 'toggle']);
    const seenIds = new Set();
    for (const param of plugin.params) {
      if (!param || typeof param !== 'object') {
        throw new Error(`Plugin "${plugin.id}": every param must be an object`);
      }
      if (typeof param.id !== 'string' || !param.id) {
        throw new Error(`Plugin "${plugin.id}": param.id must be a non-empty string (got ${JSON.stringify(param.id)})`);
      }
      if (seenIds.has(param.id)) {
        throw new Error(`Plugin "${plugin.id}": duplicate param id "${param.id}"`);
      }
      seenIds.add(param.id);
      if (!SUPPORTED_TYPES.has(param.type)) {
        throw new Error(`Plugin "${plugin.id}" param "${param.id}": unsupported type "${param.type}" (must be one of: ${[...SUPPORTED_TYPES].join(', ')})`);
      }
      if (param.type === 'range' || param.type === 'number') {
        if (typeof param.min !== 'number' || typeof param.max !== 'number' || typeof param.step !== 'number') {
          throw new Error(`Plugin "${plugin.id}" param "${param.id}": range/number params require numeric min, max, and step`);
        }
      }
      if (param.type === 'select') {
        if (!Array.isArray(param.options) || param.options.length === 0) {
          throw new Error(`Plugin "${plugin.id}" param "${param.id}": select params require a non-empty options array`);
        }
      }
    }

    return plugin;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install a generative art plugin from its source code.
 * Throws on validation failure or storage error.
 * @param {string} code  ES module source with a default-export plugin object
 * @returns {Promise<{id:string,label:string}>}
 */
export async function installGenartPlugin(code) {
  const plugin = await _importCode(code);

  if (_reservedIds.has(plugin.id)) {
    throw new Error(`installGenartPlugin: "${plugin.id}" conflicts with a built-in algorithm id`);
  }

  try {
    const entries = _load().filter(e => e.id !== plugin.id);
    entries.push({ id: plugin.id, code });
    _save(entries);
  } catch {
    throw new Error(`installGenartPlugin: failed to persist "${plugin.id}" — storage may be full`);
  }

  _registry.set(plugin.id, plugin);
  _refreshStores();
  return { id: plugin.id, label: plugin.label };
}

/**
 * Remove a user-installed plugin by id.
 * No-ops if the id is a built-in.
 * @param {string} id
 */
export function uninstallGenartPlugin(id) {
  if (_reservedIds.has(id)) return;

  try {
    _save(_load().filter(e => e.id !== id));
  } catch {
    console.warn(`[genartPluginLoader] Failed to persist uninstall of "${id}"`);
    return;
  }

  _registry.delete(id);
  _refreshStores();
}

/**
 * Re-register all user-installed plugins from localStorage.
 * Call once on app boot (fire-and-forget).
 * @returns {Promise<void>}
 */
export async function restoreGenartPlugins() {
  const entries = _load();
  const restored = [];
  let dirty = false;

  for (const { id, code } of entries) {
    try {
      const plugin = await _importCode(code);
      if (_reservedIds.has(plugin.id)) {
        throw new Error(`restoreGenartPlugins: "${plugin.id}" conflicts with a built-in id`);
      }
      _registry.set(plugin.id, plugin);
      restored.push({ id: plugin.id, code });
      dirty ||= plugin.id !== id;
    } catch (err) {
      console.warn(`[genartPluginLoader] Failed to restore plugin "${id}":`, err);
      dirty = true;
    }
  }

  if (dirty) _save(restored);
  _refreshStores();
}
