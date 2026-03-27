/**
 * stores/gcode.js
 * Active plottable paths — written by WaveRecorder and GcodeHandler, read by all.
 */

import { writable, derived } from 'svelte/store';

export const activePaths       = writable([]);
export const stereoPaths       = writable(null);
export const importedPathCount = writable(0);
export const cameraAspect      = writable(1);
export const exportParams      = writable(null); // snapshot of generation params at capture time

/** True when there is something to plot. */
export const hasPlottablePaths = derived(
  [activePaths, importedPathCount],
  ([$paths, $imported]) => $paths.length > 0 || $imported > 0,
);
