import { renderLineArt, renderLineArtScene, MAX_SCENE_OBJECTS, transformPoint } from './lineArtRenderer.ts';
import { validateHeightField } from './heightField.ts';
import { parseOBJ, parseSTL, fitMesh, sliceMesh, voxelizeMesh, validateMesh } from './meshGeometry.ts';
import { createFunctionSurface } from './functionSurface.ts';
import { marchingSquares } from './_marchingSquares.js';

export const id = 'code-art';
export const label = 'Code Art';
export const params = [];

export const DEFAULT_CODE = `// Build plot paths with the helper functions below.
const sculpture = scene()
  .add(
    solid.sphere({ detail: 8 }).scale(0.8).translate(-0.9, 0, 0),
    solid.torus({ detail: 8 }).rotate(65, 0, 0).translate(0.9, 0, 0.2),
  );

return sculpture.render({
  position: [4.5, -6, 4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 45,
});`;

const SOLID_SHAPES = new Set(['sphere', 'cube', 'torus', 'cylinder', 'cone', 'heightfield', 'mesh', 'paths', 'boolean']);

class ShapeBuilder {
  constructor(shape, options = {}, transform = {}) {
    if (!SOLID_SHAPES.has(shape)) throw new RangeError(`Unknown 3D shape: ${shape}`);
    if (shape === 'heightfield') validateHeightField(options);
    this.spec = {
      ...options,
      shape,
      detail: options.detail ?? 10,
      position: transform.position ?? [0, 0, 0],
      rotation: transform.rotation ?? [0, 0, 0],
      scale: transform.scale ?? [1, 1, 1],
      ...(shape === 'heightfield' ? { heightfield: { ...options } } : {}),
    };
  }

  translate(x, y, z) {
    const delta = Array.isArray(x) ? x : [x ?? 0, y ?? 0, z ?? 0];
    if (delta.length !== 3 || delta.some(value => !Number.isFinite(value))) {
      throw new TypeError('Translation must contain three finite numbers');
    }
    return this._withTransform({
      position: this.spec.position.map((value, i) => value + (delta[i] ?? 0)),
    });
  }

  rotate(x, y, z) {
    const angles = Array.isArray(x) ? x : [x ?? 0, y ?? 0, z ?? 0];
    if (angles.length !== 3 || angles.some(value => !Number.isFinite(value))) {
      throw new TypeError('Rotation must contain three finite numbers');
    }
    return this._withTransform({
      rotation: this.spec.rotation.map((value, i) => value + (angles[i] ?? 0)),
    });
  }

  scale(x, y = x, z = x) {
    const factors = Array.isArray(x) ? x : [x, y, z];
    if (factors.length !== 3 || factors.some(value => !Number.isFinite(value) || value === 0)) {
      throw new RangeError('Shape scale values must be finite and non-zero');
    }
    return this._withTransform({
      scale: this.spec.scale.map((value, i) => value * (factors[i] ?? factors[0])),
    });
  }

  _withTransform(transform) {
    return new ShapeBuilder(this.spec.shape, this.spec.heightfield ?? this.spec, {
      position: transform.position ?? this.spec.position,
      rotation: transform.rotation ?? this.spec.rotation,
      scale: transform.scale ?? this.spec.scale,
    });
  }

  draw(style) {
    if (!['grid', 'edges', 'silhouette', 'none'].includes(style)) throw new RangeError('Unknown drawing style');
    return this._withOptions({ draw: style });
  }

  occluder() {
    return this.draw('none');
  }

  occlude(enabled = true) {
    if (typeof enabled !== 'boolean') throw new TypeError('occlude expects a boolean');
    return this._withOptions({ occlude: enabled });
  }

  withPaths(paths) {
    return this._withOptions({ paths });
  }

  _withOptions(options) {
    return new ShapeBuilder(this.spec.shape, {
      ...(this.spec.heightfield ?? this.spec), ...options,
    }, this.spec);
  }

  fit(min = [-1, -1, -1], max = [1, 1, 1]) {
    if (this.spec.shape !== 'mesh') throw new TypeError('fit() requires a mesh');
    if (this.spec.paths) throw new TypeError('Fit the mesh before attaching custom paths');
    return this._withOptions({ mesh: fitMesh(this.spec.mesh, min, max) });
  }

  slices({ axis = 'z', count = 32 } = {}) {
    if (this.spec.shape !== 'mesh') throw new TypeError('slices() requires a mesh');
    if (!['x', 'y', 'z'].includes(axis) || !Number.isInteger(count) || count < 2 || count > 256) {
      throw new RangeError('Slices require an x/y/z axis and count from 2 to 256');
    }
    const index = { x: 0, y: 1, z: 2 }[axis];
    const coordinates = this.spec.mesh.vertices.map(vertex => vertex[index]);
    const low = coordinates.reduce((a, b) => Math.min(a, b), Infinity);
    const high = coordinates.reduce((a, b) => Math.max(a, b), -Infinity);
    const normal = [0, 0, 0];
    normal[index] = 1;
    const paths = [];
    for (let i = 0; i < count; i++) {
      const point = [0, 0, 0];
      point[index] = low + (high - low) * i / (count - 1);
      paths.push(...sliceMesh(this.spec.mesh, { point, normal }));
    }
    if (!paths.length) throw new RangeError('Slice planes do not intersect the mesh');
    return this.withPaths(paths);
  }

  slice(plane) {
    if (this.spec.shape !== 'mesh') throw new TypeError('slice() requires a mesh');
    const paths = sliceMesh(this.spec.mesh, plane);
    if (!paths.length) throw new RangeError('Slice plane does not intersect the mesh');
    return new ShapeBuilder('paths', { paths, occlude: false }, this.spec);
  }

  voxelize(options) {
    if (this.spec.shape !== 'mesh') throw new TypeError('voxelize() requires a mesh');
    return voxelizeMesh(this.spec.mesh, options).map(center => (
      new ShapeBuilder('cube', { detail: 4, draw: 'edges' }, {
        position: transformPoint(center, this.spec),
        rotation: this.spec.rotation,
        scale: this.spec.scale.map(value => value * options.size / 2),
      })
    ));
  }
}

class SceneBuilder {
  constructor() {
    this.objects = [];
  }

  add(...shapes) {
    for (const shape of shapes.flat()) {
      if (!(shape instanceof ShapeBuilder)) {
        throw new TypeError('scene.add() expects shapes created by solid.*()');
      }
      if (this.objects.length >= MAX_SCENE_OBJECTS) throw new RangeError(`A scene can contain at most ${MAX_SCENE_OBJECTS} objects`);
      this.objects.push(shape.spec);
    }
    return this;
  }

  render(camera = {}) {
    return renderLineArtScene(this.objects, camera);
  }
}

function createScene() {
  return new SceneBuilder();
}

const solid = Object.freeze({
  sphere: options => new ShapeBuilder('sphere', options),
  cube: options => new ShapeBuilder('cube', options),
  torus: options => new ShapeBuilder('torus', options),
  cylinder: options => new ShapeBuilder('cylinder', options),
  heightfield: options => new ShapeBuilder('heightfield', options),
  cone: options => new ShapeBuilder('cone', options),
  cylinderBetween: (start, end, options) => between('cylinder', start, end, options),
  coneBetween: (start, end, options) => between('cone', start, end, options),
  union: (...shapes) => booleanShape('union', shapes),
  intersection: (...shapes) => booleanShape('intersection', shapes),
  difference: (...shapes) => booleanShape('difference', shapes),
  function: options => new ShapeBuilder('mesh', createFunctionSurface(options)),
});

function between(shape, start, end, options = {}) {
  for (const point of [start, end]) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
      throw new TypeError('Endpoints must contain three finite numbers');
    }
  }
  const delta = end.map((value, i) => value - start[i]);
  const length = Math.hypot(...delta);
  const radius = options.radius ?? 0.1;
  if (length < 1e-10 || !Number.isFinite(radius) || radius <= 0) throw new RangeError('Endpoint distance and radius must be positive');
  return new ShapeBuilder(shape, options)
    .scale(radius / 0.8, radius / 0.8, length / 2)
    .rotate(0, Math.acos(delta[2] / length) * 180 / Math.PI, Math.atan2(delta[1], delta[0]) * 180 / Math.PI)
    .translate(start.map((value, i) => (value + end[i]) / 2));
}

function booleanShape(operation, shapes) {
  if (shapes.length < 2 || shapes.some(shape => !(shape instanceof ShapeBuilder))) {
    throw new TypeError('Boolean operations require at least two solid shapes');
  }
  return new ShapeBuilder('boolean', { operation, children: shapes.map(shape => shape.spec) });
}

const mesh = Object.freeze({
  from: data => { validateMesh(data); return new ShapeBuilder('mesh', { mesh: data, draw: 'edges' }); },
  obj: text => new ShapeBuilder('mesh', { mesh: parseOBJ(text), draw: 'edges' }),
  stl: data => new ShapeBuilder('mesh', { mesh: parseSTL(data), draw: 'edges' }),
});

function paths3d(paths) {
  return new ShapeBuilder('paths', { paths, occlude: false });
}

function latLng(latitude, longitude, radius = 1) {
  if (![latitude, longitude, radius].every(Number.isFinite) || latitude < -90 || latitude > 90 || radius <= 0) {
    throw new RangeError('Latitude must be -90 to 90; longitude and positive radius must be finite');
  }
  const lat = latitude * Math.PI / 180, lng = longitude * Math.PI / 180;
  return [radius * Math.cos(lat) * Math.cos(lng), radius * Math.cos(lat) * Math.sin(lng), radius * Math.sin(lat)];
}

function random(seed = 1) {
  if (!Number.isInteger(seed)) throw new TypeError('Random seed must be an integer');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function primitive(shape, options = {}) {
  return renderLineArt({
    shape,
    detail: options.detail ?? 10,
    azimuth: options.azimuth ?? 35,
    elevation: options.elevation ?? 25,
    fov: options.fov ?? 45,
  });
}

function contours(field, size, threshold) {
  if (!Number.isInteger(size) || size < 2 || size > 512) {
    throw new RangeError('Contour grid size must be an integer from 2 to 512');
  }
  if (!(Array.isArray(field) || field instanceof Float32Array || field instanceof Float64Array)
      || field.length !== size * size) {
    throw new TypeError('Contour field must contain size * size values in an array, Float32Array, or Float64Array');
  }
  if (!Number.isFinite(threshold)) {
    throw new TypeError('Contour field values and threshold must be finite numbers');
  }
  for (const value of field) {
    if (!Number.isFinite(value)) throw new TypeError('Contour field values and threshold must be finite numbers');
  }
  return marchingSquares(field, size, threshold);
}

function combine(...pathGroups) {
  return pathGroups.flat();
}

function transform(paths, options = {}) {
  const amount = options.scale ?? 1;
  const angle = (options.rotate ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = options.translateX ?? 0;
  const ty = options.translateY ?? 0;

  return paths.map(path => path.map(({ nx, ny }) => ({
    nx: (nx * cos - ny * sin) * amount + tx,
    ny: (nx * sin + ny * cos) * amount + ty,
  })));
}

function circle(options = {}) {
  const radius = options.radius ?? 0.5;
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const steps = Math.min(2000, Math.max(12, Math.round(options.steps ?? 120)));
  return [Array.from({ length: steps + 1 }, (_, i) => {
    const angle = 2 * Math.PI * i / steps;
    return { nx: x + radius * Math.cos(angle), ny: y + radius * Math.sin(angle) };
  })];
}

function polyline(points, options = {}) {
  if (!Array.isArray(points)) throw new TypeError('polyline(points) expects an array of points');
  const path = points.map(point => Array.isArray(point)
    ? { nx: point[0], ny: point[1] }
    : { nx: point.nx, ny: point.ny });
  if (options.close && path.length > 0) path.push({ ...path[0] });
  return [path];
}

const API = Object.freeze({
  sphere: options => primitive('sphere', options),
  cube: options => primitive('cube', options),
  torus: options => primitive('torus', options),
  cylinder: options => primitive('cylinder', options),
  combine,
  transform,
  circle,
  polyline,
  contours,
  scene: createScene,
  solid,
  mesh,
  paths3d,
  latLng,
  random,
});

function validatePaths(paths) {
  if (!Array.isArray(paths)) throw new TypeError('Your code must return an array of paths');
  if (paths.length > 20000) throw new RangeError('Output exceeds the 20,000 path limit');

  let pointCount = 0;
  for (const path of paths) {
    if (!Array.isArray(path)) throw new TypeError('Each path must be an array of points');
    pointCount += path.length;
    if (pointCount > 500000) throw new RangeError('Output exceeds the 500,000 point limit');
    for (const point of path) {
      if (!Number.isFinite(point?.nx) || !Number.isFinite(point?.ny)) {
        throw new TypeError('Each point must have finite nx and ny coordinates');
      }
    }
  }
  return paths;
}

export function generate({ code = DEFAULT_CODE, assets = {} } = {}) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new TypeError('Enter JavaScript code that returns an array of paths');
  }
  if (code.length > 100000) throw new RangeError('Code exceeds the 100,000 character limit');

  const execute = new Function(
    'api',
    'assets',
    `"use strict";\nconst { sphere, cube, torus, cylinder, combine, transform, circle, polyline, contours, scene, solid, mesh, paths3d, latLng, random } = api;\n${code}`,
  );
  return validatePaths(execute(API, assets));
}
