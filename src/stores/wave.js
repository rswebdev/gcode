/**
 * stores/wave.js
 * Wave recorder app state — shared between WaveRecorder (writes) and other modules (reads).
 */

import { writable } from 'svelte/store';

export const appState   = writable('IDLE');   // 'IDLE' | 'RECORDING' | 'STOPPED'
export const frameCount = writable(0);
