/**
 * recorder.js
 * Simple state machine that accumulates deep-copied audio frames.
 * Zero external dependencies.
 */

let recording = false;
let frames = [];
let maxFrames = 64;
let currentMode = 'time';

/**
 * @param {{ maxFrames: number, mode: string }} config
 */
export function configure(config) {
  if (config.maxFrames !== undefined) maxFrames = config.maxFrames;
  if (config.mode !== undefined) currentMode = config.mode;
}

/**
 * Start recording. Clears any previously accumulated frames.
 */
export function start() {
  frames = [];
  recording = true;
}

/**
 * Stop recording.
 * @returns {Array} The accumulated frames array.
 */
export function stop() {
  recording = false;
  return frames;
}

/**
 * Add a frame. Deep-copies the data so callers can reuse their buffers.
 * No-op when not recording or when maxFrames is reached.
 * @param {Float32Array | { left: Float32Array, right: Float32Array }} frameData
 */
export function addFrame(frameData) {
  if (!recording) return;
  if (frames.length >= maxFrames) return;

  if (frameData instanceof Float32Array) {
    frames.push(Float32Array.from(frameData));
  } else if (frameData && frameData.left instanceof Float32Array) {
    frames.push({
      left: Float32Array.from(frameData.left),
      right: Float32Array.from(frameData.right),
    });
  }
}

/** @returns {Array} */
export function getFrames() {
  return frames;
}

/** @returns {number} */
export function getFrameCount() {
  return frames.length;
}

/** @returns {boolean} */
export function isRecording() {
  return recording;
}

/** @returns {boolean} */
export function isFull() {
  return frames.length >= maxFrames;
}

/**
 * Clear all frames and set recording to false.
 */
export function reset() {
  frames = [];
  recording = false;
}
