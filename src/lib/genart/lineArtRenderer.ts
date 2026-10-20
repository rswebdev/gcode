import { createHeightField, type HeightFieldOptions } from './heightField';
import { createMeshGeometry, validateMesh, type MeshData } from './meshGeometry';
import { createSceneIndex, unionBounds, type Box } from './sceneSpatial';

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
  accepts?: (point: Vec3) => boolean;
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
  mesh?: MeshData;
  paths?: Vec3[][];
  draw?: 'grid' | 'edges' | 'silhouette' | 'none';
  occlude?: boolean;
  operation?: 'union' | 'intersection' | 'difference';
  children?: SceneObject[];
}

export interface SceneCamera {
  position?: Vec3;
  target?: Vec3;
  up?: Vec3;
  azimuth?: number;
  elevation?: number;
  fov?: number;
  fit?: boolean;
  aspect?: number;
  near?: number;
  far?: number;
}

export const MAX_SCENE_OBJECTS = 12000;
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

export function transformPoint(point: Vec3, object: SceneObject): Vec3 {
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

function createSurfaces(shape: string): Surface[] {
  const circle = Math.PI * 2;
  if (shape === 'cube') return cubeSurfaces();
  if (shape === 'cone') {
    return [{
      uMin: 0, uMax: circle, vMin: -1, vMax: 1, periodicU: true,
      evaluate: (u, v) => [0.4 * (1 - v) * Math.cos(u), 0.4 * (1 - v) * Math.sin(u), v],
    }, {
      uMin: 0, uMax: circle, vMin: 0, vMax: 1, periodicU: true,
      evaluate: (u, v) => [0.8 * v * Math.cos(u), 0.8 * v * Math.sin(u), -1],
    }];
  }

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
  const direction = subtract(target, eye);
  if (Math.hypot(...direction) < 1e-12) {
    throw new RangeError('Camera position must differ from target; change the camera position');
  }
  const forward = normalize(direction);
  const upAxis = camera.up ?? WORLD_UP;
  const upLength = Math.hypot(...upAxis);
  if (upLength < 1e-12) {
    throw new RangeError('Camera up vector must be non-zero; change the up vector');
  }
  const rightAxis = cross(forward, scale(upAxis, 1 / upLength));
  if (Math.hypot(...rightAxis) < 1e-12) {
    throw new RangeError('Camera view direction must not be parallel to the up vector; change the camera position or up vector');
  }
  const right = normalize(rightAxis);
  const up = normalize(cross(right, forward));

  const project = (point: Vec3): ProjectedPoint | null => {
    const relative = subtract(point, eye);
    const depth = dot(relative, forward);
    if (depth < (camera.near ?? 0.01) || depth > (camera.far ?? Infinity)) return null;
    const projectionScale = 1 / (depth * Math.tan((camera.fov ?? 45) * Math.PI / 360));
    const aspect = camera.aspect ?? 1;
    const nx = dot(relative, right) * projectionScale / Math.max(1, aspect);
    const ny = dot(relative, up) * projectionScale * Math.min(1, aspect);
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
  if (discriminant <= 1e-12 * Math.max(1, b * b, a * Math.abs(dot(origin, origin) - radius * radius))) return null;
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
  while (coefficients.length > 1 && Math.abs(coefficients.at(-1)!) < 1e-16) coefficients = coefficients.slice(0, -1);
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

function inverseTransform(object: SceneObject): (point: Vec3) => Vec3 {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const rows = axes.map(axis => {
    const transformed = subtract(transformPoint(axis, object), object.position);
    return scale(transformed, 1 / dot(transformed, transformed));
  });
  return point => {
    const relative = subtract(point, object.position);
    return [dot(relative, rows[0]), dot(relative, rows[1]), dot(relative, rows[2])];
  };
}

function pathCurves(paths: Vec3[][]): SurfaceCurve[] {
  return paths.filter(path => path.length > 1).map(path => ({
    samples: (path.length - 1) * Math.max(1, Math.ceil(48 / (path.length - 1))),
    evaluate: t => {
      const index = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
      const fraction = t * (path.length - 1) - index;
      return [0, 1, 2].map(axis => (
        path[index][axis] + (path[index + 1][axis] - path[index][axis]) * fraction
      )) as Vec3;
    },
  }));
}

function circleCurve(radius: number, z: number): SurfaceCurve {
  return {
    samples: 192,
    evaluate: t => [radius * Math.cos(t * Math.PI * 2), radius * Math.sin(t * Math.PI * 2), z],
  };
}

function primitiveCurves(object: SceneObject, eye: Vec3): SurfaceCurve[] {
  const style = object.draw ?? 'grid';
  if (style === 'none') return [];
  if (style === 'grid') return sampleSurfaceCurves(createSurfaces(object.shape), Math.min(18, Math.max(4, Math.round(object.detail))));
  if (object.shape === 'cube') {
    const edges: Vec3[][] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        const others = [0, 1, 2].filter(value => value !== axis);
        const p: Vec3 = [0, 0, 0];
        p[axis] = -1;
        p[others[0]] = a;
        p[others[1]] = b;
        if (style === 'silhouette') {
          const frontA = a * eye[others[0]] > 1;
          const frontB = b * eye[others[1]] > 1;
          if (frontA === frontB) continue;
        }
        const q: Vec3 = [...p];
        q[axis] = 1;
        edges.push([p, q]);
      }
    }
    return pathCurves(edges);
  }
  if (object.shape === 'sphere') {
    const length = Math.hypot(...eye);
    if (length <= 1) return [];
    const normal = normalize(eye);
    const u = normalize(cross(normal, Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));
    const v = cross(normal, u);
    const center = scale(normal, 1 / length);
    const radius = Math.sqrt(1 - 1 / (length * length));
    return [{
      samples: 192,
      evaluate: t => [0, 1, 2].map(axis => (
        center[axis] + radius * (u[axis] * Math.cos(t * Math.PI * 2) + v[axis] * Math.sin(t * Math.PI * 2))
      )) as Vec3,
    }];
  }
  if (object.shape === 'cylinder' || object.shape === 'cone') {
    const cone = object.shape === 'cone';
    const curves: SurfaceCurve[] = [circleCurve(0.8, -1)];
    if (!cone) curves.push(circleCurve(0.8, 1));
    const radial = Math.hypot(eye[0], eye[1]);
    const tangent = cone ? 0.4 * (1 - eye[2]) : 0.8;
    if (radial > Math.abs(tangent)) {
      const angle = Math.atan2(eye[1], eye[0]);
      const offset = Math.acos(tangent / radial);
      for (const a of [angle - offset, angle + offset]) {
        curves.push(...pathCurves([[
          [0.8 * Math.cos(a), 0.8 * Math.sin(a), -1],
          cone ? [0, 0, 1] : [0.8 * Math.cos(a), 0.8 * Math.sin(a), 1],
        ]]));
      }
    }
    return curves;
  }
  // Torus outlines are extracted from a fine surface mesh.
  const surface = createSurfaces('torus')[0];
  const mesh: MeshData = { vertices: [], faces: [] };
  const count = 64;
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
    mesh.vertices.push(surface.evaluate(x * Math.PI * 2 / count, y * Math.PI * 2 / count));
  }
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
    const a = y * count + x;
    const b = y * count + (x + 1) % count;
    const c = ((y + 1) % count) * count + x;
    const d = ((y + 1) % count) * count + (x + 1) % count;
    mesh.faces.push([a, b, c], [b, d, c]);
  }
  return meshCurves(mesh, eye, true);
}

function meshCurves(mesh: MeshData, eye: Vec3, silhouette: boolean): SurfaceCurve[] {
  const edges = new Map<string, { a: number; b: number; fronts: boolean[] }>();
  for (const [a, b, c] of mesh.faces) {
    const normal = cross(subtract(mesh.vertices[b], mesh.vertices[a]), subtract(mesh.vertices[c], mesh.vertices[a]));
    const front = dot(normal, subtract(eye, mesh.vertices[a])) > 0;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(p, q)}:${Math.max(p, q)}`;
      const edge = edges.get(key) ?? { a: p, b: q, fronts: [] };
      edge.fronts.push(front);
      edges.set(key, edge);
    }
  }
  return pathCurves([...edges.values()]
    .filter(edge => !silhouette || edge.fronts.length === 1 || edge.fronts.some(value => value !== edge.fronts[0]))
    .map(edge => [mesh.vertices[edge.a], mesh.vertices[edge.b]]));
}

function primitiveContains(shape: string, point: Vec3): boolean {
  const [x, y, z] = point;
  if (shape === 'cube') return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 1 - 1e-10;
  if (shape === 'sphere') return dot(point, point) < 1 - 1e-10;
  if (shape === 'torus') return (Math.hypot(x, y) - 0.68) ** 2 + z * z < 0.32 ** 2 - 1e-10;
  const radius = shape === 'cone' ? 0.4 * (1 - z) : 0.8;
  return Math.abs(z) < 1 - 1e-10 && x * x + y * y < radius * radius - 1e-10;
}

function primitiveRoots(shape: string, origin: Vec3, direction: Vec3): number[] {
  const [x, y, z] = origin;
  const [dx, dy, dz] = direction;
  if (shape === 'cube') return [0, 1, 2].flatMap(axis => (
    Math.abs(direction[axis]) < 1e-14 ? [] : [-1, 1].map(side => (side - origin[axis]) / direction[axis])
  ));
  if (shape === 'sphere') return sphereInterval(origin, direction, 1) ?? [];
  if (shape === 'torus') {
    const a = dot(direction, direction);
    const b = 2 * dot(origin, direction);
    const c = dot(origin, origin) + 0.68 ** 2 - 0.32 ** 2;
    return polynomialRoots([
      c * c - 4 * 0.68 ** 2 * (x * x + y * y),
      2 * b * c - 8 * 0.68 ** 2 * (x * dx + y * dy),
      b * b + 2 * a * c - 4 * 0.68 ** 2 * (dx * dx + dy * dy),
      2 * a * b, a * a,
    ], 0, 1);
  }
  const cone = shape === 'cone';
  const radial = polynomialRoots([
    x * x + y * y - (cone ? 0.16 * (1 - z) ** 2 : 0.64),
    2 * (x * dx + y * dy) + (cone ? 0.32 * (1 - z) * dz : 0),
    dx * dx + dy * dy - (cone ? 0.16 * dz * dz : 0),
  ], 0, 1);
  return [...radial, ...(Math.abs(dz) < 1e-14 ? [] : [(-1 - z) / dz, (1 - z) / dz])];
}

function interiorHit(
  roots: number[], origin: Vec3, direction: Vec3, contains: (point: Vec3) => boolean,
): boolean {
  const boundaries = [1e-8, ...roots.filter(t => t > 1e-8 && t < 1 - 1e-8).sort((a, b) => a - b), 1 - 1e-8];
  return boundaries.slice(1).some((end, i) => {
    const start = boundaries[i];
    if (end - start < 1e-12) return false;
    const t = (start + end) / 2;
    return contains([origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t]);
  });
}

interface CompiledObject {
  bounds: Box;
  paths: SurfaceCurve[];
  occludes: (origin: Vec3, direction: Vec3) => boolean;
  contains: (point: Vec3) => boolean;
  roots: (origin: Vec3, direction: Vec3) => number[];
}

function compileObject(object: SceneObject, eye: Vec3): CompiledObject {
  const toLocal = inverseTransform(object);
  const localEye = toLocal(eye);
  const localRay = (origin: Vec3, direction: Vec3): [Vec3, Vec3] => {
    const start = toLocal(origin);
    const end = toLocal([origin[0] + direction[0], origin[1] + direction[1], origin[2] + direction[2]]);
    return [start, subtract(end, start)];
  };
  let localBounds: Box = { min: [-1, -1, -1], max: [1, 1, 1] };
  let curves: SurfaceCurve[];
  let contains = (point: Vec3) => primitiveContains(object.shape, point);
  let roots = (origin: Vec3, direction: Vec3) => primitiveRoots(object.shape, origin, direction);
  let occludes = (origin: Vec3, direction: Vec3) => interiorHit(roots(origin, direction), origin, direction, contains);
  if (object.shape === 'boolean') {
    const children = object.children!.map(child => compileObject({
      ...child, draw: object.draw ?? child.draw,
    }, localEye));
    localBounds = unionBounds(children.map(child => child.bounds));
    contains = point => {
      const inside = children.map(child => child.contains(point));
      if (object.operation === 'union') return inside.some(Boolean);
      if (object.operation === 'intersection') return inside.every(Boolean);
      return inside[0] && !inside.slice(1).some(Boolean);
    };
    roots = (origin, direction) => children.flatMap(child => child.roots(origin, direction));
    curves = children.flatMap(child => child.paths).map(curve => ({
      ...curve,
      accepts: point => {
        if (curve.accepts && !curve.accepts(point)) return false;
        const values: boolean[] = [];
        for (const x of [-1e-6, 0, 1e-6]) for (const y of [-1e-6, 0, 1e-6]) for (const z of [-1e-6, 0, 1e-6]) {
          if (x || y || z) values.push(contains([point[0] + x, point[1] + y, point[2] + z]));
        }
        return values.some(Boolean) && values.some(value => !value);
      },
    }));
  } else if (object.shape === 'heightfield') {
    const field = createHeightField(object.heightfield!);
    localBounds = field.bounds;
    curves = field.curves;
    occludes = field.occludes;
  } else if (object.shape === 'mesh') {
    const mesh = createMeshGeometry(object.mesh!);
    localBounds = mesh.bounds;
    curves = object.draw === 'silhouette'
      ? meshCurves(object.mesh!, localEye, true)
      : pathCurves(mesh.paths);
    contains = mesh.contains;
    occludes = mesh.occludes;
  } else if (object.shape === 'paths') {
    curves = [];
    const points = object.paths!.flat();
    localBounds = unionBounds(points.map(point => ({ min: point, max: point })));
    occludes = () => false;
    contains = () => false;
  } else {
    curves = primitiveCurves(object, localEye);
    // Keep the established analytic checks for the common primitives.
    if (object.shape !== 'cone') occludes = (origin, direction) => {
      let near = 1e-8;
      let far = 1 - 1e-8;
      const intersect = (interval: [number, number] | null): boolean => {
        if (!interval) return false;
        near = Math.max(near, interval[0]);
        far = Math.min(far, interval[1]);
        return far > near;
      };
      if (object.shape === 'cube') return [0, 1, 2].every(axis => intersect(slabInterval(origin[axis], direction[axis])));
      if (object.shape === 'cylinder') return intersect(slabInterval(origin[2], direction[2]))
        && intersect(sphereInterval([origin[0], origin[1], 0], [direction[0], direction[1], 0], 0.8));
      if (!intersect(sphereInterval(origin, direction, 1))) return false;
      return object.shape === 'sphere' || torusOccludes(origin, direction, near, far);
    };
  }
  if (object.paths) {
    curves = pathCurves(object.paths);
    if (object.shape === 'sphere') {
      curves = curves.map((curve, i) => {
        const onSurface = object.paths![i].every(point => Math.abs(dot(point, point) - 1) < 1e-8);
        return onSurface ? { ...curve, evaluate: t => normalize(curve.evaluate(t)) } : curve;
      });
    }
  }
  if (object.draw === 'none') curves = [];
  const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => (
    transformPoint([
      x < 0 ? localBounds.min[0] : localBounds.max[0],
      y < 0 ? localBounds.min[1] : localBounds.max[1],
      z < 0 ? localBounds.min[2] : localBounds.max[2],
    ], object)
  ))));
  if (corners.some(point => !point.every(Number.isFinite))) throw new RangeError('Scene transforms exceed finite coordinate range');
  return {
    bounds: unionBounds(corners.map(point => ({ min: point, max: point }))),
    paths: curves.map(curve => ({
      ...curve,
      evaluate: t => transformPoint(curve.evaluate(t), object),
      accepts: curve.accepts ? point => curve.accepts!(toLocal(point)) : undefined,
    })),
    contains: point => contains(toLocal(point)),
    roots: (origin, direction) => roots(...localRay(origin, direction)),
    occludes: object.occlude === false ? () => false : (origin, direction) => occludes(...localRay(origin, direction)),
  };
}

function visiblePaths(
  paths: SurfaceCurve[],
  project: (point: Vec3) => ProjectedPoint | null,
  isVisible: (point: Vec3) => boolean,
): ProjectedPoint[][] {
  const visible: ProjectedPoint[][] = [];
  let pointCount = 0;
  let sampleCount = 0;

  for (const path of paths) {
    let current: ProjectedPoint[] = [];
    let previous: number | null = null;
    let previousVisible = false;
    const flush = () => {
      if (current.length > 1 && current.some(point => (
        Math.hypot(point.x - current[0].x, point.y - current[0].y) > 0.001
      ))) {
        visible.push(current);
        pointCount += current.length;
        if (visible.length > 20000) throw new RangeError('Output exceeds the 20,000 path limit');
        if (pointCount > 500000) throw new RangeError('Output exceeds the 500,000 point limit');
      }
      current = [];
    };
    const visibleAt = (t: number) => {
      const point = path.evaluate(t);
      return !!project(point) && (!path.accepts || path.accepts(point)) && isVisible(point);
    };
    const append = (t: number) => {
      if (++sampleCount > 10000000) throw new RangeError('Scene exceeds the 10,000,000 visibility-sample limit');
      const world = path.evaluate(t);
      const point = project(world);
      const pointVisible = !!point && (!path.accepts || path.accepts(world)) && isVisible(world);
      if (previous !== null && previousVisible !== pointVisible) {
        let low = previous;
        let high = t;
        for (let i = 0; i < 20; i++) {
          const middle = (low + high) / 2;
          if (visibleAt(middle) === previousVisible) low = middle;
          else high = middle;
        }
        const boundary = project(path.evaluate(previousVisible ? low : high));
        if (previousVisible) {
          if (boundary) current.push(boundary);
          flush();
        } else {
          current = boundary ? [boundary] : [];
        }
      }
      if (pointVisible && point) {
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
      const steps = start && end
        ? Math.min(4096, Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y))))
        : 1;
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
  let objectCount = 0;
  let triangleCount = 0;
  function validateObject(object: SceneObject, depth = 0, booleanChild = false): void {
    objectCount++;
    if (objectCount > MAX_SCENE_OBJECTS || depth > 16) throw new RangeError('Scene exceeds 12,000 objects or 16 nesting levels');
    if (!Number.isFinite(object.detail)) throw new TypeError('Scene object detail must be finite');
    if (!['sphere', 'cube', 'torus', 'cylinder', 'cone', 'heightfield', 'mesh', 'paths', 'boolean'].includes(object.shape)) {
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
    if (object.draw !== undefined && !['grid', 'edges', 'silhouette', 'none'].includes(object.draw)) {
      throw new RangeError('Drawing style must be grid, edges, silhouette, or none');
    }
    if (object.occlude !== undefined && typeof object.occlude !== 'boolean') throw new TypeError('occlude must be a boolean');
    if (booleanChild && ['heightfield', 'mesh', 'paths'].includes(object.shape)) {
      throw new TypeError('Boolean operations require closed analytic solids');
    }
    if (object.shape === 'mesh') {
      validateMesh(object.mesh!);
      triangleCount += object.mesh!.faces.length;
    }
    if (object.shape === 'heightfield') triangleCount += 2 * (object.heightfield?.samples ?? 160) ** 2;
    if (triangleCount > 1000000) throw new RangeError('Scene exceeds the 1,000,000 mesh-triangle limit');
    if (object.shape === 'heightfield' && !object.heightfield) throw new TypeError('Height field options are required');
    if (object.paths !== undefined) {
      if (!Array.isArray(object.paths) || !object.paths.length || object.paths.length > 20000) {
        throw new RangeError('3D paths must contain 1 to 20,000 paths');
      }
      let points = 0;
      for (const path of object.paths) {
        if (!Array.isArray(path) || path.length < 2) throw new TypeError('3D paths need at least two points');
        points += path.length;
        if (points > 500000) throw new RangeError('3D paths exceed 500,000 points');
        for (const point of path) {
          if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
            throw new TypeError('3D points must contain three finite numbers');
          }
        }
      }
    }
    if (object.shape === 'paths' && !object.paths) throw new TypeError('3D paths are required');
    if (object.shape === 'boolean') {
      if (!['union', 'intersection', 'difference'].includes(object.operation!) || !object.children || object.children.length < 2) {
        throw new TypeError('Boolean operations require an operation and at least two solids');
      }
      for (const child of object.children) validateObject(child, depth + 1, true);
    }
  }
  objects.forEach(object => validateObject(object));
  const cameraVectors = [cameraOptions.position, cameraOptions.target, cameraOptions.up].filter(Boolean);
  for (const vector of cameraVectors) {
    if (vector.length !== 3 || vector.some(value => !Number.isFinite(value))) {
      throw new TypeError('Camera vectors must contain three finite numbers');
    }
  }
  const fov = cameraOptions.fov ?? 45;
  if (![cameraOptions.azimuth ?? 35, cameraOptions.elevation ?? 25].every(Number.isFinite)) {
    throw new RangeError('Camera azimuth and elevation must be finite numbers');
  }
  if (!Number.isFinite(fov) || fov <= 1 || fov >= 179) {
    throw new RangeError('Camera field of view must be between 1 and 179 degrees');
  }
  if (cameraOptions.fit !== undefined && typeof cameraOptions.fit !== 'boolean') throw new TypeError('Camera fit must be a boolean');
  for (const value of [cameraOptions.aspect ?? 1, cameraOptions.near ?? 0.01]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Camera aspect and near must be positive finite numbers');
  }
  if (cameraOptions.far !== undefined && (!Number.isFinite(cameraOptions.far) || cameraOptions.far <= (cameraOptions.near ?? 0.01))) {
    throw new RangeError('Camera far must be finite and greater than near');
  }
  const { eye, project } = createCamera(cameraOptions);
  let curveCount = 0;
  const geometry = objects.map(object => {
    const compiled = compileObject(object, eye);
    curveCount += compiled.paths.length;
    if (curveCount > 100000) throw new RangeError('Scene exceeds the 100,000 source-curve limit');
    return compiled;
  });
  const index = createSceneIndex(geometry.filter((_, i) => objects[i].occlude !== false && objects[i].shape !== 'paths'));
  const isVisible = (point: Vec3) => !index(eye, subtract(point, eye), item => item.occludes(eye, subtract(point, eye)));
  const visible = visiblePaths(geometry.flatMap(object => object.paths), project, isVisible);
  const pointCount = visible.reduce((total, path) => total + path.length, 0);
  if (pointCount > 500000) throw new RangeError('Output exceeds the 500,000 point limit');

  if (visible.length === 0) return [];
  if (cameraOptions.fit === false) return visible.map(path => path.map(point => ({
    nx: point.x * 2 / (PROJECTION_SIZE - 1) - 1,
    ny: 1 - point.y * 2 / (PROJECTION_SIZE - 1),
  })));
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
