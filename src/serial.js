/**
 * serial.js
 * Web Serial API wrapper for streaming G-code to a GRBL controller.
 *
 * Protocol: GRBL simple line-by-line streaming.
 *   - Send one line, wait for 'ok' before sending the next.
 *   - Non-ok lines (banners, messages) are silently skipped in the protocol
 *     flow but are still emitted to monitor listeners.
 *   - 'error:N' and 'ALARM:N' responses throw.
 *   - cancelSend() writes the GRBL real-time soft-reset byte (0x18).
 *
 * Monitor events:
 *   addMonitorListener(fn) — fn(type, text) where type is:
 *     'tx'   — line sent to the controller
 *     'rx'   — line received from the controller
 *     'info' — connection / status message from this module
 */

let _port    = null;
let _reader  = null;
let _writer  = null;
let _rxBuf   = '';
let _sending    = false;  // true while sendGCode() is running
let _cmdPending = false;  // true while sendCommand() is awaiting its ok
let _cancelReq  = false;

// ---------------------------------------------------------------------------
// Monitor event bus
// ---------------------------------------------------------------------------

const _listeners = [];

export function addMonitorListener(fn)    { _listeners.push(fn); }
export function removeMonitorListener(fn) {
  const i = _listeners.indexOf(fn);
  if (i >= 0) _listeners.splice(i, 1);
}

function _emit(type, text) {
  if (_listeners.length === 0) return;
  for (const fn of _listeners) fn(type, text);
}

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

/** True if the browser supports Web Serial (Chrome/Edge, HTTPS or localhost). */
export function isAvailable() { return 'serial' in navigator; }

/** True if a port is currently open. */
export function isConnected() { return _port !== null; }

/** True while sendGCode() is running (and can be cancelled). */
export function isSending()   { return _sending; }

/** True while any send or command is in flight (sendGCode or sendCommand). */
export function isBusy()      { return _sending || _cmdPending; }

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------

/**
 * Show the browser's port-picker and open the selected port at 115200 baud.
 * Throws if the user cancels the picker or the port fails to open.
 */
export async function connect() {
  _port = await navigator.serial.requestPort();
  await _port.open({ baudRate: 115200 });
  _writer = _port.writable.getWriter();
  _reader = _port.readable.getReader();
  _rxBuf  = '';
  _emit('info', 'Connected — 115200 baud');
}

/**
 * Close the port cleanly.
 * Safe to call even if already disconnected or while sending
 * (cancels the in-flight send first).
 */
export async function disconnect() {
  _cancelReq = true;
  try { if (_reader) await _reader.cancel(); } catch (_) {}
  try { if (_reader) _reader.releaseLock();  } catch (_) {}
  try { if (_writer) _writer.releaseLock();  } catch (_) {}
  try { if (_port)   await _port.close();    } catch (_) {}
  _port = null; _reader = null; _writer = null; _rxBuf = '';
  _sending = false; _cmdPending = false;
  _emit('info', 'Disconnected');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _write(text) {
  const trimmed = text.trim();
  if (trimmed) _emit('tx', trimmed);
  await _writer.write(new TextEncoder().encode(text));
}

/**
 * Consume incoming bytes until a line containing 'ok' is found.
 * Every received line (including 'ok', banners, errors) is emitted to
 * monitor listeners before protocol handling.
 *
 * @param {number} timeoutMs
 * @throws if an error/alarm response is received, the port closes, or timeout.
 */
async function _readUntilOk(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const nl = _rxBuf.indexOf('\n');
    if (nl >= 0) {
      const line = _rxBuf.slice(0, nl).trim();
      _rxBuf = _rxBuf.slice(nl + 1);
      if (line) _emit('rx', line);
      if (line === 'ok') return;
      if (line.startsWith('error')) throw new Error(`GRBL ${line}`);
      if (line.startsWith('ALARM')) throw new Error(`GRBL ${line}`);
      // Startup banner, [MSG:...], etc. — already emitted above; keep reading.
      continue;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Timeout waiting for GRBL response');

    // Race the reader against the wall-clock deadline so _cmdPending/_sending
    // are always released even if GRBL stops responding.
    const result = await Promise.race([
      _reader.read(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for GRBL response')), remaining)
      ),
    ]);

    if (result.done) throw new Error('Serial port closed during receive');
    _rxBuf += new TextDecoder().decode(result.value);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stream a G-code string to the connected GRBL controller.
 *
 * Comment-only lines (starting with ';') and blank lines are stripped before
 * transmission — GRBL doesn't need them and it speeds up the send.
 *
 * @param {string}   gcodeString  Full G-code content (multiline string).
 * @param {function} onProgress   Called as (sentLines, totalLines) after each 'ok'.
 * @returns {{ cancelled: boolean }}
 */
export async function sendGCode(gcodeString, onProgress) {
  if (!isConnected()) throw new Error('Not connected to plotter');
  if (_sending)       throw new Error('Already sending');
  if (_cmdPending)    throw new Error('Port is busy');

  _sending   = true;
  _cancelReq = false;

  // Strip in-line comments (everything from ';' onwards) and blank lines.
  const lines = gcodeString.split('\n')
    .map(l => { const ci = l.indexOf(';'); return (ci < 0 ? l : l.slice(0, ci)).trim(); })
    .filter(l => l.length > 0);

  let cancelled = false;
  try {
    for (let i = 0; i < lines.length; i++) {
      if (_cancelReq) { cancelled = true; break; }
      await _write(lines[i] + '\n');
      await _readUntilOk();
      if (onProgress) onProgress(i + 1, lines.length);
    }
  } finally {
    _sending = false;
  }

  return { cancelled };
}

/**
 * Abort an in-progress sendGCode().
 * Sends GRBL's real-time soft-reset (Ctrl-X, 0x18) to halt motion immediately.
 */
export function cancelSend() {
  _cancelReq = true;
  if (_writer) {
    _emit('info', 'Soft reset sent (0x18)');
    _writer.write(new Uint8Array([0x18])).catch(() => {});
  }
}

/**
 * Send a single GRBL command and wait for the 'ok' acknowledgement.
 * Use this for one-off commands like '$H', 'G92 X0 Y0', jog commands, etc.
 *
 * @param {string} cmd  Raw GRBL command (no newline needed).
 * @throws if the port is not open, GRBL responds with an error, or timeout.
 */
export async function sendCommand(cmd) {
  if (!isConnected()) throw new Error('Not connected to plotter');
  if (_sending || _cmdPending) throw new Error('Port is busy');
  _cmdPending = true;
  try {
    await _write(cmd + '\n');
    await _readUntilOk(10_000);
  } finally {
    _cmdPending = false;
  }
}
