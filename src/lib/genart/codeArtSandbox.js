import 'ses';
import { DEFAULT_CODE, createAPI, validatePaths } from './codeArt.js';

let lockdownComplete = false;
let safeAPI;

function ensureLockdown() {
  if (lockdownComplete) return;
  globalThis.lockdown();
  lockdownComplete = true;
}

function protectResult(value) {
  if (typeof value === 'function') {
    globalThis.harden(value);
    return value;
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype && prototype !== Object.prototype) globalThis.harden(prototype);
  }
  return value;
}

function makeSafeAPI(value) {
  if (typeof value === 'function') {
    return globalThis.harden((...args) => protectResult(value(...args)));
  }
  if (!value || typeof value !== 'object') return value;

  const safeObject = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    safeObject[key] = makeSafeAPI(item);
  }
  return globalThis.harden(safeObject);
}

function copyAssets(assets) {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) {
    throw new TypeError('Code Art assets must be an object');
  }

  const safeAssets = Object.create(null);
  for (const [name, value] of Object.entries(assets)) {
    if (typeof value !== 'string' && !(value instanceof ArrayBuffer)) {
      throw new TypeError(`Code Art asset "${name}" must be text or an ArrayBuffer`);
    }
    safeAssets[name] = value;
  }
  return Object.freeze(safeAssets);
}

export function generate({ code = DEFAULT_CODE, assets = {} } = {}) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new TypeError('Enter JavaScript code that returns an array of paths');
  }
  if (code.length > 100000) throw new RangeError('Code exceeds the 100,000 character limit');

  ensureLockdown();
  safeAPI ??= makeSafeAPI(createAPI());

  const compartment = new globalThis.Compartment({
    globals: {
      api: safeAPI,
      assets: copyAssets(assets),
      ArrayBuffer,
      DataView,
      Float32Array,
      Float64Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Uint8Array,
      Uint8ClampedArray,
      Uint16Array,
      Uint32Array,
      BigInt64Array,
      BigUint64Array,
    },
    __options__: true,
  });
  const result = compartment.evaluate(
    `(() => { "use strict";\nconst { sphere, cube, torus, cylinder, combine, transform, circle, polyline, contours, scene, solid, mesh, paths3d, latLng, random } = api;\n${code}\n})()`,
  );
  return validatePaths(result);
}
