/**
 * stores/serial.js
 * Serial connection state and monitor log — written by serial.js listeners,
 * read by SerialTransmission.svelte.
 */

import { writable, derived } from 'svelte/store';
import * as serial from '../lib/serial.js';

export const connected = writable(false);
export const sending   = writable(false);
export const available = writable(serial.isAvailable());

const MAX_LOG = 500;
export const log = writable(/** @type {Array<{type:string,text:string}>} */ ([]));

export function appendLog(type, text) {
  log.update(entries => {
    const next = [...entries, { type, text }];
    return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
  });
}

export function clearLog() {
  log.set([]);
}

// Register once so all components share the same listener.
serial.addMonitorListener((type, text) => {
  appendLog(type, text);
  if (type === 'info') {
    connected.set(serial.isConnected());
    sending.set(serial.isSending());
  }
});
