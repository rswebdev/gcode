import { renderLineArt, renderLineArtScene } from './lineArtRenderer.ts';
import { validateHeightField } from './heightField.ts';

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

const SOLID_SHAPES = new Set(['sphere', 'cube', 'torus', 'cylinder', 'heightfield']);

class ShapeBuilder {
  constructor(shape, options = {}, transform = {}) {
    if (!SOLID_SHAPES.has(shape)) throw new RangeError(`Unknown 3D shape: ${shape}`);
    if (shape === 'heightfield') validateHeightField(options);
    this.spec = {
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
    return new ShapeBuilder(this.spec.shape, this.spec.heightfield ?? { detail: this.spec.detail }, {
      position: transform.position ?? this.spec.position,
      rotation: transform.rotation ?? this.spec.rotation,
      scale: transform.scale ?? this.spec.scale,
    });
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
      if (this.objects.length >= 20) throw new RangeError('A scene can contain at most 20 objects');
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
});

function primitive(shape, options = {}) {
  return renderLineArt({
    shape,
    detail: options.detail ?? 10,
    azimuth: options.azimuth ?? 35,
    elevation: options.elevation ?? 25,
    fov: options.fov ?? 45,
  });
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
  scene: createScene,
  solid,
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

export function generate({ code = DEFAULT_CODE } = {}) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new TypeError('Enter JavaScript code that returns an array of paths');
  }
  if (code.length > 100000) throw new RangeError('Code exceeds the 100,000 character limit');

  const execute = new Function(
    'api',
    `"use strict";\nconst { sphere, cube, torus, cylinder, combine, transform, circle, polyline, scene, solid } = api;\n${code}`,
  );
  return validatePaths(execute(API));
}
