import { createHeightField, type HeightFieldOptions } from './heightField';

type Vec3 = [number, number, number];

export interface LineArtPoint {
  nx: number;
  ny: number;
}

interface Surface {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  periodicU?: boolean;
  evaluate: (u: number, v: number) => Vec3;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

interface SurfaceCurve {
  evaluate: (t: number) => Vec3;
  samples: number;
}

interface RenderOptions {
  shape: string;
  detail: number;
  azimuth: number;
  elevation: number;
  fov: number;
}

export interface SceneObject {
  shape: string;
  detail: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  heightfield?: HeightFieldOptions;
}

export interface SceneCamera {
  position?: Vec3;
  target?: Vec3;
  up?: Vec3;
  azimuth?: number;
  elevation?: number;
  fov?: number;
}

const MAX_SCENE_OBJECTS = 20;
const PROJECTION_SIZE = 720;
const WORLD_UP: Vec3 = [0, 0, 1];

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, amount: number): Vec3 {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  if (length < 1e-12) throw new Error('Cannot normalize a zero-length vector');
  return scale(a, 1 / length);
}

function cubeSurfaces(): Surface[] {
  const min = -1;
  const max = 1;
  return [
    { uMin: min, uMax: max, vMin: min, vMax: max, evaluate: (u, v) => [1, u, v] },
    { uMin: min, uMax: max, vMin: min, vMax: max, evaluate: (u, v) => [-1, u, v] },
    { uMin: min, uMax: max, vMin: min, vMax: max, evaluate: (u, v) => [u, 1, v] },
    { uMin: min, uMax: max, vMin: min, vMax: max, evaluate: (u, v) => [u, -1, v] },
    { uMin: min, uMax: max, vMin: min, vMax: max, evaluate: (u, v) => [u, v, 1] },
    { uMin: min, uMax: max, vMin: min, vMax: max, evaluate: (u, v) => [u, v, -1] },
  ];
}

function transformPoint(point: Vec3, object: SceneObject): Vec3 {
  let [x, y, z] = [
    point[0] * object.scale[0],
    point[1] * object.scale[1],
    point[2] * object.scale[2],
  ];
  const [rx, ry, rz] = object.rotation.map(degrees => degrees * Math.PI / 180);

  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];

  return [x + object.position[0], y + object.position[1], z + object.position[2]];
}

function transformSurfaces(surfaces: Surface[], object: SceneObject): Surface[] {
  return surfaces.map(surface => ({
    ...surface,
    evaluate: (u, v) => transformPoint(surface.evaluate(u, v), object),
  }));
}

function createSurfaces(shape: string): Surface[] {
  const circle = Math.PI * 2;
  if (shape === 'cube') return cubeSurfaces();

  if (shape === 'torus') {
    return [{
      uMin: 0,
      uMax: circle,
      vMin: 0,
      vMax: circle,
      periodicU: true,
      evaluate: (u, v) => {
        const radius = 0.68 + 0.32 * Math.cos(v);
        return [radius * Math.cos(u), radius * Math.sin(u), 0.32 * Math.sin(v)];
      },
    }];
  }

  if (shape === 'cylinder') {
    const radius = 0.8;
    return [
      {
        uMin: 0,
        uMax: circle,
        vMin: -1,
        vMax: 1,
        periodicU: true,
        evaluate: (u, v) => [radius * Math.cos(u), radius * Math.sin(u), v],
      },
      ...([-1, 1].map(z => ({
        uMin: 0,
        uMax: circle,
        vMin: 0,
        vMax: 1,
        periodicU: true,
        evaluate: (u: number, v: number): Vec3 => [
          radius * v * Math.cos(u),
          radius * v * Math.sin(u),
          z,
        ],
      }))),
    ];
  }

  return [{
    uMin: 0,
    uMax: circle,
    vMin: -Math.PI / 2,
    vMax: Math.PI / 2,
    periodicU: true,
    evaluate: (u, v) => {
      const radius = Math.cos(v);
      return [radius * Math.cos(u), radius * Math.sin(u), Math.sin(v)];
    },
  }];
}

function interpolateRange(min: number, max: number, step: number, count: number): number {
  return min + (max - min) * step / count;
}

function sampleSurfaceCurves(surfaces: Surface[], detail: number): SurfaceCurve[] {
  const paths: SurfaceCurve[] = [];
  const lineCount = Math.max(4, detail * 2);
  const sampleCount = Math.max(48, detail * 16);

  for (const surface of surfaces) {
    for (let line = 0; line <= lineCount; line++) {
      const v = interpolateRange(surface.vMin, surface.vMax, line, lineCount);
      paths.push({
        evaluate: t => surface.evaluate(interpolateRange(surface.uMin, surface.uMax, t, 1), v),
        samples: sampleCount,
      });
    }
    for (let line = 0; line <= lineCount; line++) {
      if (surface.periodicU && line === lineCount) continue;
      const u = interpolateRange(surface.uMin, surface.uMax, line, lineCount);
      paths.push({
        evaluate: t => surface.evaluate(u, interpolateRange(surface.vMin, surface.vMax, t, 1)),
        samples: sampleCount,
      });
    }
  }
  return paths;
}

function createCamera(camera: SceneCamera) {
  const target: Vec3 = camera.target ?? [0, 0, 0];
  const az = (camera.azimuth ?? 35) * Math.PI / 180;
  const el = (camera.elevation ?? 25) * Math.PI / 180;
  const eye: Vec3 = camera.position ?? [
    target[0] + 4.2 * Math.cos(el) * Math.cos(az),
    target[1] + 4.2 * Math.cos(el) * Math.sin(az),
    target[2] + 4.2 * Math.sin(el),
  ];
  const forward = normalize(subtract(target, eye));
  const upAxis = camera.up ?? WORLD_UP;
  const right = normalize(cross(forward, upAxis));
  const up = normalize(cross(right, forward));

  const project = (point: Vec3): ProjectedPoint | null => {
    const relative = subtract(point, eye);
    const depth = dot(relative, forward);
    if (depth <= 0.01) return null;
    const projectionScale = 1 / (depth * Math.tan((camera.fov ?? 45) * Math.PI / 360));
    const nx = dot(relative, right) * projectionScale;
    const ny = dot(relative, up) * projectionScale;
    return {
      x: (nx + 1) * 0.5 * (PROJECTION_SIZE - 1),
      y: (1 - ny) * 0.5 * (PROJECTION_SIZE - 1),
    };
  };
  return { eye, project };
}

function sphereInterval(origin: Vec3, direction: Vec3, radius: number): [number, number] | null {
  const a = dot(direction, direction);
  if (a === 0) return dot(origin, origin) < radius * radius ? [-Infinity, Infinity] : null;
  const b = dot(origin, direction);
  const discriminant = b * b - a * (dot(origin, origin) - radius * radius);
  if (discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  return [(-b - root) / a, (-b + root) / a];
}

function slabInterval(origin: number, direction: number): [number, number] | null {
  if (Math.abs(direction) < 1e-12) {
    return Math.abs(origin) < 1 - 1e-10 ? [-Infinity, Infinity] : null;
  }
  const a = (-1 - origin) / direction;
  const b = (1 - origin) / direction;
  return [Math.min(a, b), Math.max(a, b)];
}

function polynomialValue(coefficients: number[], t: number): number {
  return coefficients.reduceRight((value, coefficient) => value * t + coefficient, 0);
}

function polynomialRoots(coefficients: number[], min: number, max: number): number[] {
  if (coefficients.length === 1) return [];
  if (coefficients.length === 2) {
    const root = -coefficients[0] / coefficients[1];
    return root > min && root < max ? [root] : [];
  }
  const derivative = coefficients.slice(1).map((value, i) => value * (i + 1));
  const boundaries = [min, ...polynomialRoots(derivative, min, max), max];
  const roots: number[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    let low = boundaries[i - 1];
    let high = boundaries[i];
    const start = polynomialValue(coefficients, low);
    const end = polynomialValue(coefficients, high);
    if (start === 0) roots.push(low);
    if ((start < 0) === (end < 0)) continue;
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (low + high) / 2;
      if ((polynomialValue(coefficients, middle) < 0) === (start < 0)) low = middle;
      else high = middle;
    }
    roots.push((low + high) / 2);
  }
  return roots;
}

function torusOccludes(origin: Vec3, direction: Vec3, min: number, max: number): boolean {
  const major = 0.68;
  const minor = 0.32;
  const a = dot(direction, direction);
  const b = 2 * dot(origin, direction);
  const c = dot(origin, origin) + major * major - minor * minor;
  const radialA = direction[0] ** 2 + direction[1] ** 2;
  const radialB = 2 * (origin[0] * direction[0] + origin[1] * direction[1]);
  const radius4 = 4 * major * major;
  // A quartic ray/torus intersection has an interior hit iff its minimum is negative.
  const derivative = [
    2 * b * c - radius4 * radialB,
    2 * (b * b + 2 * a * c - radius4 * radialA),
    6 * a * b,
    4 * a * a,
  ];
  const candidates = [min, ...polynomialRoots(derivative, min, max), max];
  return candidates.some(t => {
    const x = origin[0] + direction[0] * t;
    const y = origin[1] + direction[1] * t;
    const z = origin[2] + direction[2] * t;
    return (Math.hypot(x, y) - major) ** 2 + z * z < minor * minor - 1e-12;
  });
}

function createVisibilityTest(
  objects: SceneObject[],
  eye: Vec3,
  fields: (ReturnType<typeof createHeightField> | null)[],
): (point: Vec3) => boolean {
  const occluders = objects.map((object, index) => {
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const inverseRows = axes.map(axis => {
      const transformed = subtract(transformPoint(axis, object), object.position);
      return scale(transformed, 1 / dot(transformed, transformed));
    });
    const toLocal = (point: Vec3): Vec3 => {
      const relative = subtract(point, object.position);
      return [dot(relative, inverseRows[0]), dot(relative, inverseRows[1]), dot(relative, inverseRows[2])];
    };
    return { shape: object.shape, origin: toLocal(eye), toLocal, field: fields[index] };
  });

  return point => !occluders.some(({ shape, origin, toLocal, field }) => {
    const direction = subtract(toLocal(point), origin);
    if (field) return field.occludes(origin, direction);
    // Exclude the line's own surface, not a screen-space neighbourhood around it.
    let near = 1e-8;
    let far = 1 - 1e-8;
    const intersect = (interval: [number, number] | null): boolean => {
      if (!interval) return false;
      near = Math.max(near, interval[0]);
      far = Math.min(far, interval[1]);
      return far > near;
    };
    if (shape === 'cube') {
      return [0, 1, 2].every(axis => intersect(slabInterval(origin[axis], direction[axis])));
    }
    if (shape === 'cylinder') {
      return intersect(slabInterval(origin[2], direction[2]))
        && intersect(sphereInterval([origin[0], origin[1], 0], [direction[0], direction[1], 0], 0.8));
    }
    if (!intersect(sphereInterval(origin, direction, 1))) return false;
    return shape === 'sphere' || torusOccludes(origin, direction, near, far);
  });
}

function visiblePaths(
  paths: SurfaceCurve[],
  project: (point: Vec3) => ProjectedPoint | null,
  isVisible: (point: Vec3) => boolean,
): ProjectedPoint[][] {
  const visible: ProjectedPoint[][] = [];

  for (const path of paths) {
    let current: ProjectedPoint[] = [];
    let previous: number | null = null;
    let previousVisible = false;
    const flush = () => {
      if (current.length > 1 && current.some(point => (
        Math.hypot(point.x - current[0].x, point.y - current[0].y) > 0.001
      ))) visible.push(current);
      current = [];
    };
    const append = (t: number) => {
      const world = path.evaluate(t);
      const point = project(world);
      if (!point) {
        flush();
        previous = null;
        previousVisible = false;
        return;
      }
      const pointVisible = isVisible(world);
      if (previous !== null && previousVisible !== pointVisible) {
        let low = previous;
        let high = t;
        for (let i = 0; i < 20; i++) {
          const middle = (low + high) / 2;
          if (isVisible(path.evaluate(middle)) === previousVisible) low = middle;
          else high = middle;
        }
        const boundary = project(path.evaluate((low + high) / 2));
        if (previousVisible) {
          if (boundary) current.push(boundary);
          flush();
        } else {
          current = boundary ? [boundary] : [];
        }
      }
      if (pointVisible) {
        if (!previousVisible && current.length === 0) current.push(point);
        else {
          const last = current[current.length - 1];
          if (t === 1 || !last || Math.hypot(last.x - point.x, last.y - point.y) > 0.2) current.push(point);
        }
      }
      previous = t;
      previousVisible = pointVisible;
    };

    for (let i = 1; i <= path.samples; i++) {
      const start = project(path.evaluate((i - 1) / path.samples));
      const end = project(path.evaluate(i / path.samples));
      if (!start || !end) {
        flush();
        previous = null;
        previousVisible = false;
        continue;
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 1));
      for (let step = 0; step <= steps; step++) {
        if (i > 1 && step === 0) continue;
        append((i - 1 + step / steps) / path.samples);
      }
    }
    flush();
  }
  return visible;
}

export function renderLineArt(options: RenderOptions): LineArtPoint[][] {
  return renderLineArtScene([{
    shape: options.shape,
    detail: options.detail,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }], {
    azimuth: options.azimuth,
    elevation: options.elevation,
    fov: options.fov,
  });
}

export function renderLineArtScene(objects: SceneObject[], cameraOptions: SceneCamera = {}): LineArtPoint[][] {
  if (objects.length > MAX_SCENE_OBJECTS) {
    throw new RangeError(`A scene can contain at most ${MAX_SCENE_OBJECTS} objects`);
  }
  for (const object of objects) {
    if (!Number.isFinite(object.detail)) throw new TypeError('Scene object detail must be finite');
    if (!['sphere', 'cube', 'torus', 'cylinder', 'heightfield'].includes(object.shape)) {
      throw new RangeError(`Unknown 3D shape: ${object.shape}`);
    }
    for (const vector of [object.position, object.rotation, object.scale]) {
      if (vector.length !== 3 || vector.some(value => !Number.isFinite(value))) {
        throw new TypeError('Scene transforms must contain three finite numbers');
      }
    }
    if (object.scale.some(value => value === 0)) {
      throw new RangeError('Scene scale values must be non-zero');
    }
  }
  const cameraVectors = [cameraOptions.position, cameraOptions.target, cameraOptions.up].filter(Boolean);
  for (const vector of cameraVectors) {
    if (vector.length !== 3 || vector.some(value => !Number.isFinite(value))) {
      throw new TypeError('Camera vectors must contain three finite numbers');
    }
  }
  const fov = cameraOptions.fov ?? 45;
  if (!Number.isFinite(fov) || fov <= 1 || fov >= 179) {
    throw new RangeError('Camera field of view must be between 1 and 179 degrees');
  }

  const geometry = objects.map(object => {
    if (object.shape === 'heightfield') {
      if (!object.heightfield) throw new TypeError('Height field options are required');
      const field = createHeightField(object.heightfield);
      return {
        field,
        paths: field.curves.map(curve => ({
          ...curve,
          evaluate: (t: number) => transformPoint(curve.evaluate(t), object),
        })),
      };
    }
    const surfaces = transformSurfaces(createSurfaces(object.shape), object);
    const detail = Math.min(18, Math.max(4, Math.round(object.detail)));
    return { field: null, paths: sampleSurfaceCurves(surfaces, detail) };
  });
  const paths = geometry.flatMap(object => object.paths);
  const { eye, project } = createCamera(cameraOptions);
  const visible = visiblePaths(paths, project, createVisibilityTest(objects, eye, geometry.map(item => item.field)));

  if (visible.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const path of visible) {
    for (const point of path) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (extent < 1e-8) return [];
  const fit = 1.84 / extent;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return visible.map(path => path.map(point => ({
    nx: (point.x - centerX) * fit,
    ny: (centerY - point.y) * fit,
  })));
}
