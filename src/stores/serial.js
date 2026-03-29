/**
 * stores/serial.js
 * Serial connection state and monitor log — written by serial.js listeners,
 * read by SerialTransmission.svelte.
 */

import { writable } from 'svelte/store';
import * as serial from '../lib/serial.js';

export const connected = writable(false);
export const sending   = writable(false);
export const available = writable(serial.isAvailable());

const MAX_LOG = 500;
let _seq = 0;

/** @type {Array<{id:number, type:string, text:string}>} */
const _logBuf = [];
export const log = writable(_logBuf);

export function appendLog(type, text) {
  _logBuf.push({ id: _seq++, type, text });
  if (_logBuf.length > MAX_LOG) _logBuf.shift();
  // Notify subscribers with the same array reference — Svelte calls all
  // subscribers unconditionally on set(), so reactivity is preserved.
  log.set(_logBuf);
}

export function clearLog() {
  _logBuf.length = 0;
  log.set(_logBuf);
}

// Register once so all components share the same listener.
serial.addMonitorListener((type, text) => {
  appendLog(type, text);
  if (type === 'info') {
    connected.set(serial.isConnected());
    sending.set(serial.isSending());
  }
});
