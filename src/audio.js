/**
 * audio.js
 * Web Audio API wrapper. Handles microphone access, AnalyserNode setup,
 * and per-tick frame extraction for all three Z-axis modes.
 */

let audioContext = null;
let analyser = null;
let leftAnalyser = null;
let rightAnalyser = null;
let source = null;
let stream = null;

// Pre-allocated reusable buffers — callers must copy if they need to keep data.
let timeBuf = null;
let freqBuf = null;
let leftBuf = null;
let rightBuf = null;

const MIN_DB = -100;
const MAX_DB = 0;

let _smoothingFreq = 0.5;

/** Set the smoothingTimeConstant used in frequency mode (0 = raw, 0.95 = very smooth). */
export function setSmoothing(v) {
  _smoothingFreq = Math.max(0, Math.min(0.95, v));
}

/**
 * Initialise microphone capture and AnalyserNodes.
 * Must be called inside a user-gesture handler.
 * @param {{ fftSize: number }} config
 * @returns {Promise<{ sampleRate: number }>}
 */
export async function init(config) {
  const fftSize = snapToPowerOfTwo(config.fftSize || 512);

  stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  audioContext = new AudioContext();
  source = audioContext.createMediaStreamSource(stream);

  // Mono analyser for time and frequency modes.
  analyser = audioContext.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.0;

  // Stereo splitter with two separate analysers.
  const splitter = audioContext.createChannelSplitter(2);
  leftAnalyser = audioContext.createAnalyser();
  rightAnalyser = audioContext.createAnalyser();
  leftAnalyser.fftSize = fftSize;
  rightAnalyser.fftSize = fftSize;
  leftAnalyser.smoothingTimeConstant = 0.0;
  rightAnalyser.smoothingTimeConstant = 0.0;

  source.connect(analyser);
  source.connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);

  // Frequency mode benefits from light smoothing.
  analyser.smoothingTimeConstant = 0.0; // will be overridden per-mode in getFrequencyFrame

  // Allocate buffers.
  timeBuf = new Float32Array(analyser.fftSize);
  freqBuf = new Float32Array(analyser.frequencyBinCount);
  leftBuf = new Float32Array(leftAnalyser.fftSize);
  rightBuf = new Float32Array(rightAnalyser.fftSize);

  return { sampleRate: audioContext.sampleRate };
}

/**
 * Returns raw time-domain waveform data in [-1, 1].
 * The returned buffer is reused — copy it if you need to keep the data.
 * @returns {Float32Array}
 */
export function getTimeFrame() {
  if (!analyser) return new Float32Array(0);
  analyser.smoothingTimeConstant = 0.0;
  analyser.getFloatTimeDomainData(timeBuf);
  return timeBuf;
}

/**
 * Returns normalised frequency-domain data in [0, 1].
 * The returned buffer is reused — copy it if you need to keep the data.
 * @returns {Float32Array}
 */
export function getFrequencyFrame() {
  if (!analyser) return new Float32Array(0);
  analyser.smoothingTimeConstant = _smoothingFreq;
  analyser.getFloatFrequencyData(freqBuf);
  for (let i = 0; i < freqBuf.length; i++) {
    freqBuf[i] = Math.max(0, Math.min(1, (freqBuf[i] - MIN_DB) / (MAX_DB - MIN_DB)));
  }
  return freqBuf;
}

/**
 * Returns stereo time-domain frames for both channels.
 * The returned buffers are reused — copy if you need to keep the data.
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
export function getStereoFrame() {
  if (!leftAnalyser) return { left: new Float32Array(0), right: new Float32Array(0) };
  leftAnalyser.getFloatTimeDomainData(leftBuf);
  rightAnalyser.getFloatTimeDomainData(rightBuf);
  return { left: leftBuf, right: rightBuf };
}

/**
 * Returns current frame data for the given mode.
 * Returned arrays/buffers are reused — copy if you need to keep data.
 * @param {'time'|'frequency'|'stereo'} mode
 * @returns {Float32Array | { left: Float32Array, right: Float32Array }}
 */
export function getFrame(mode) {
  switch (mode) {
    case 'frequency': return getFrequencyFrame();
    case 'stereo':    return getStereoFrame();
    default:          return getTimeFrame();
  }
}

/** @returns {boolean} */
export function isReady() {
  return audioContext !== null && analyser !== null;
}

/**
 * Stop all audio tracks and close the AudioContext.
 */
export async function destroy() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }
  analyser = leftAnalyser = rightAnalyser = source = null;
  timeBuf = freqBuf = leftBuf = rightBuf = null;
}

// ---------------------------------------------------------------------------

function snapToPowerOfTwo(n) {
  return Math.pow(2, Math.round(Math.log2(Math.max(32, Math.min(2048, n)))));
}
