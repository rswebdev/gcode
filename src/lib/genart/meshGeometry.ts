import { ShapeUtils, Vector2 } from 'three';

export type Vec3 = [number, number, number];
export type MeshData = { vertices: Vec3[]; faces: [number, number, number][] };

type Bounds = { min: Vec3; max: Vec3 };
type Triangle = { a: Vec3; b: Vec3; c: Vec3; face: [number, number, number]; bounds: Bounds; center: Vec3 };
type BVHNode = Bounds & { left?: BVHNode; right?: BVHNode; triangles?: Triangle[] };

const MAX_TRIANGLES = 100_000;
const MAX_VERTICES = MAX_TRIANGLES * 3;
const EPS = 1e-10;

const finiteVec = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lengthSq = (a: Vec3): number => dot(a, a);
const pointKey = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;

export function validateMesh(data: MeshData): void {
  if (!data || !Array.isArray(data.vertices) || !Array.isArray(data.faces)) {
    throw new TypeError('Mesh must contain vertices and faces arrays');
  }
  if (data.vertices.length < 3 || data.vertices.length > MAX_VERTICES) {
    throw new RangeError(`Mesh vertices must contain between 3 and ${MAX_VERTICES} entries`);
  }
  if (data.faces.length < 1 || data.faces.length > MAX_TRIANGLES) {
    throw new RangeError(`Mesh faces must contain between 1 and ${MAX_TRIANGLES} triangles`);
  }
  for (let i = 0; i < data.vertices.length; i++) {
    if (!finiteVec(data.vertices[i])) throw new TypeError(`Mesh vertex ${i} must contain three finite numbers`);
  }
  for (let i = 0; i < data.faces.length; i++) {
    const face = data.faces[i];
    if (!Array.isArray(face) || face.length !== 3 || !face.every(Number.isInteger)) {
      throw new TypeError(`Mesh face ${i} must contain three integer indices`);
    }
    if (face.some(index => index < 0 || index >= data.vertices.length)) {
      throw new RangeError(`Mesh face ${i} contains an out-of-range vertex index`);
    }
    if (new Set(face).size !== 3) throw new RangeError(`Mesh face ${i} repeats a vertex index`);
    const [a, b, c] = face.map(index => data.vertices[index]) as [Vec3, Vec3, Vec3];
    if (!(lengthSq(cross(sub(b, a), sub(c, a))) > 0)) {
      throw new RangeError(`Mesh face ${i} is degenerate`);
    }
  }
}

function compactMesh(vertices: Vec3[], faces: [number, number, number][]): MeshData {
  const unique: Vec3[] = [];
  const indexByPoint = new Map<string, number>();
  const remap: number[] = [];
  for (const vertex of vertices) {
    const key = pointKey(vertex);
    let index = indexByPoint.get(key);
    if (index === undefined) {
      index = unique.length;
      unique.push(vertex);
      indexByPoint.set(key, index);
    }
    remap.push(index);
  }
  return { vertices: unique, faces: faces.map(face => face.map(index => remap[index]) as [number, number, number]) };
}

export function parseOBJ(text: string): MeshData {
  if (typeof text !== 'string') throw new TypeError('OBJ input must be text');
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];
  const lines = text.split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber].replace(/#.*/, '').trim();
    if (!line) continue;
    const [kind, ...tokens] = line.split(/\s+/);
    if (kind === 'v') {
      if (tokens.length < 3) throw new SyntaxError(`OBJ vertex on line ${lineNumber + 1} needs three coordinates`);
      const vertex = tokens.slice(0, 3).map(Number);
      if (!vertex.every(Number.isFinite)) throw new SyntaxError(`Invalid OBJ vertex on line ${lineNumber + 1}`);
      vertices.push(vertex as Vec3);
      if (vertices.length > MAX_VERTICES) throw new RangeError('OBJ exceeds the mesh vertex limit');
    } else if (kind === 'f') {
      if (tokens.length < 3) throw new SyntaxError(`OBJ face on line ${lineNumber + 1} needs at least three vertices`);
      const polygon: number[] = tokens.map(token => {
        const raw = token.split('/')[0];
        if (!/^[+-]?\d+$/.test(raw)) throw new SyntaxError(`Invalid OBJ face index on line ${lineNumber + 1}`);
        const value = Number(raw);
        if (value === 0) throw new SyntaxError(`OBJ indices are never zero (line ${lineNumber + 1})`);
        const index = value > 0 ? value - 1 : vertices.length + value;
        if (index < 0 || index >= vertices.length) throw new RangeError(`OBJ face index out of range on line ${lineNumber + 1}`);
        return index;
      });
      const normal: Vec3 = [0, 0, 0];
      for (let i = 0; i < polygon.length; i++) {
        const a = vertices[polygon[i]], b = vertices[polygon[(i + 1) % polygon.length]];
        normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
        normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
        normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const axis = [0, 1, 2].sort((a, b) => Math.abs(normal[b]) - Math.abs(normal[a]))[0];
      const axes = [0, 1, 2].filter(value => value !== axis);
      const triangles = polygon.length === 3 ? [[0, 1, 2]] : ShapeUtils.triangulateShape(
        polygon.map(index => new Vector2(vertices[index][axes[0]], vertices[index][axes[1]])), [],
      );
      if (triangles.length !== polygon.length - 2) throw new SyntaxError(`Invalid OBJ polygon on line ${lineNumber + 1}`);
      for (const triangle of triangles) {
        const face: [number, number, number] = [polygon[triangle[0]], polygon[triangle[1]], polygon[triangle[2]]];
        const a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
        if (dot(cross(sub(b, a), sub(c, a)), normal) < 0) [face[1], face[2]] = [face[2], face[1]];
        faces.push(face);
        if (faces.length > MAX_TRIANGLES) throw new RangeError('OBJ exceeds the 100000 triangle limit');
      }
    }
  }
  const mesh = { vertices, faces };
  validateMesh(mesh);
  return mesh;
}

export function parseSTL(input: string | ArrayBuffer): MeshData {
  if (typeof input === 'string') {
    const vertices: Vec3[] = [];
    for (const line of input.split(/\r?\n/)) {
      const match = line.trim().match(/^vertex\s+(\S+)\s+(\S+)\s+(\S+)(?:\s|$)/i);
      if (!match) continue;
      const vertex = match.slice(1).map(Number);
      if (!vertex.every(Number.isFinite)) throw new SyntaxError('ASCII STL contains a non-finite vertex');
      vertices.push(vertex as Vec3);
      if (vertices.length > MAX_TRIANGLES * 3) throw new RangeError('STL exceeds the 100000 triangle limit');
    }
    if (!vertices.length || vertices.length % 3 !== 0) {
      throw new SyntaxError('ASCII STL must contain complete three-vertex facets');
    }
    const faces: [number, number, number][] = [];
    for (let i = 0; i < vertices.length; i += 3) faces.push([i, i + 1, i + 2]);
    const mesh = compactMesh(vertices, faces);
    validateMesh(mesh);
    return mesh;
  }
  if (!(input instanceof ArrayBuffer)) throw new TypeError('STL input must be text or an ArrayBuffer');
  const prefix = new TextDecoder().decode(input.slice(0, 256)).trimStart();
  if (/^solid(?:\s|$)/i.test(prefix)) {
    const view = input.byteLength >= 84 ? new DataView(input) : null;
    const binaryLength = view ? 84 + view.getUint32(80, true) * 50 : -1;
    if (input.byteLength !== binaryLength) return parseSTL(new TextDecoder().decode(input));
  }
  if (input.byteLength < 84) throw new SyntaxError('Binary STL header is incomplete');
  const view = new DataView(input);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount < 1 || triangleCount > MAX_TRIANGLES) throw new RangeError('Binary STL triangle count is invalid or exceeds 100000');
  if (input.byteLength !== 84 + triangleCount * 50) throw new SyntaxError('Binary STL size does not match its triangle count');
  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];
  for (let i = 0; i < triangleCount; i++) {
    const offset = 84 + i * 50 + 12;
    const start = vertices.length;
    for (let j = 0; j < 3; j++) {
      const base = offset + j * 12;
      vertices.push([
        view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true),
      ]);
    }
    faces.push([start, start + 1, start + 2]);
  }
  const mesh = compactMesh(vertices, faces);
  validateMesh(mesh);
  return mesh;
}

export function fitMesh(data: MeshData, min: Vec3 = [-1, -1, -1], max: Vec3 = [1, 1, 1]): MeshData {
  validateMesh(data);
  if (!finiteVec(min) || !finiteVec(max) || min.some((value, axis) => value >= max[axis])) {
    throw new RangeError('Fit bounds must be finite, three-dimensional, and increasing');
  }
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const vertex of data.vertices) for (let axis = 0; axis < 3; axis++) {
    low[axis] = Math.min(low[axis], vertex[axis]);
    high[axis] = Math.max(high[axis], vertex[axis]);
  }
  const sourceCenter = low.map((value, axis) => (value + high[axis]) / 2) as Vec3;
  const targetCenter = min.map((value, axis) => (value + max[axis]) / 2) as Vec3;
  const scale = Math.min(...[0, 1, 2].filter(axis => high[axis] > low[axis])
    .map(axis => (max[axis] - min[axis]) / (high[axis] - low[axis])));
  return {
    vertices: data.vertices.map(vertex => vertex.map((value, axis) => targetCenter[axis] + (value - sourceCenter[axis]) * scale) as Vec3),
    faces: data.faces.map(face => [...face] as [number, number, number]),
  };
}

function boundsOfPoints(points: Vec3[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], point[axis]);
    max[axis] = Math.max(max[axis], point[axis]);
  }
  return { min, max };
}

function unionBounds(items: Triangle[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const item of items) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], item.bounds.min[axis]);
    max[axis] = Math.max(max[axis], item.bounds.max[axis]);
  }
  return { min, max };
}

function buildBVH(triangles: Triangle[]): BVHNode {
  const bounds = unionBounds(triangles);
  if (triangles.length <= 8) return { ...bounds, triangles };
  const spans = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const axis = spans.indexOf(Math.max(...spans));
  triangles.sort((a, b) => a.center[axis] - b.center[axis] || a.face[0] - b.face[0] || a.face[1] - b.face[1]);
  const middle = Math.floor(triangles.length / 2);
  return { ...bounds, left: buildBVH(triangles.slice(0, middle)), right: buildBVH(triangles.slice(middle)) };
}

function rayBox(origin: Vec3, direction: Vec3, bounds: Bounds, minT = 0, maxT = Infinity): boolean {
  let near = minT;
  let far = maxT;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-15) {
      if (origin[axis] < bounds.min[axis] - EPS || origin[axis] > bounds.max[axis] + EPS) return false;
    } else {
      const a = (bounds.min[axis] - origin[axis]) / direction[axis];
      const b = (bounds.max[axis] - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return false;
    }
  }
  return far >= minT;
}

function rayTriangle(origin: Vec3, direction: Vec3, triangle: Triangle): number | undefined {
  const e1 = sub(triangle.b, triangle.a);
  const e2 = sub(triangle.c, triangle.a);
  const p = cross(direction, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return undefined;
  const invDet = 1 / det;
  const tVec = sub(origin, triangle.a);
  const u = dot(tVec, p) * invDet;
  if (u < -1e-10 || u > 1 + 1e-10) return undefined;
  const q = cross(tVec, e1);
  const v = dot(direction, q) * invDet;
  if (v < -1e-10 || u + v > 1 + 1e-10) return undefined;
  const t = dot(e2, q) * invDet;
  return t;
}

function pointOnTriangle(point: Vec3, triangle: Triangle): boolean {
  const normal = cross(sub(triangle.b, triangle.a), sub(triangle.c, triangle.a));
  const normSq = lengthSq(normal);
  if (Math.abs(dot(sub(point, triangle.a), normal)) > 1e-9 * Math.sqrt(normSq)) return false;
  const v0 = sub(triangle.b, triangle.a);
  const v1 = sub(triangle.c, triangle.a);
  const v2 = sub(point, triangle.a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  const u = (d11 * d20 - d01 * d21) / denom;
  const v = (d00 * d21 - d01 * d20) / denom;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
}

export function createMeshGeometry(data: MeshData): {
  paths: Vec3[][];
  bounds: Bounds;
  occludes(origin: Vec3, direction: Vec3): boolean;
  contains(point: Vec3): boolean;
} {
  validateMesh(data);
  const bounds = boundsOfPoints(data.vertices);
  const triangles: Triangle[] = data.faces.map(face => {
    const [a, b, c] = face.map(index => data.vertices[index]) as [Vec3, Vec3, Vec3];
    return {
      a, b, c, face,
      bounds: boundsOfPoints([a, b, c]),
      center: mul(add(add(a, b), c), 1 / 3),
    };
  });
  const root = buildBVH([...triangles]);
  const edgeMap = new Map<string, Vec3[]>();
  for (const triangle of triangles) {
    for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
      const first = pointKey(a) < pointKey(b) ? a : b;
      const second = first === a ? b : a;
      const key = `${pointKey(first)}|${pointKey(second)}`;
      if (!edgeMap.has(key)) edgeMap.set(key, [first, second]);
    }
  }
  const paths = [...edgeMap.values()].sort((a, b) => `${pointKey(a[0])}|${pointKey(a[1])}`.localeCompare(`${pointKey(b[0])}|${pointKey(b[1])}`));
  const occludes = (origin: Vec3, direction: Vec3): boolean => {
    if (!finiteVec(origin) || !finiteVec(direction)) throw new TypeError('Ray origin and direction must be finite Vec3 values');
    if (lengthSq(direction) === 0) throw new RangeError('Ray direction must be non-zero');
    const visit = (node: BVHNode): boolean => {
      if (!rayBox(origin, direction, node, 1e-8, 1 - 1e-8)) return false;
      if (node.triangles) {
        return node.triangles.some(triangle => {
          const t = rayTriangle(origin, direction, triangle);
          return t !== undefined && t > 1e-8 && t < 1 - 1e-8;
        });
      }
      return Boolean((node.left && visit(node.left)) || (node.right && visit(node.right)));
    };
    return visit(root);
  };
  const contains = (point: Vec3): boolean => {
    if (!finiteVec(point)) throw new TypeError('Point must be a finite Vec3');
    if (point.some((value, axis) => value < bounds.min[axis] - 1e-9 || value > bounds.max[axis] + 1e-9)) return false;
    const onSurface = (node: BVHNode): boolean => {
      if (point.some((value, axis) => value < node.min[axis] - 1e-9 || value > node.max[axis] + 1e-9)) return false;
      if (node.triangles) return node.triangles.some(triangle => pointOnTriangle(point, triangle));
      return Boolean((node.left && onSurface(node.left)) || (node.right && onSurface(node.right)));
    };
    if (onSurface(root)) return true;
    const direction: Vec3 = [1, 0.3713906763541037, 0.529817324329192];
    const hits: number[] = [];
    const visit = (node: BVHNode): void => {
      if (!rayBox(point, direction, node)) return;
      if (node.triangles) {
        for (const triangle of node.triangles) {
          const t = rayTriangle(point, direction, triangle);
          if (t !== undefined && t > 1e-9) hits.push(t);
        }
      } else {
        if (node.left) visit(node.left);
        if (node.right) visit(node.right);
      }
    };
    visit(root);
    hits.sort((a, b) => a - b);
    let distinct = 0, previous = -Infinity;
    for (const hit of hits) if (Math.abs(hit - previous) > 1e-8) {
      distinct++;
      previous = hit;
    }
    return distinct % 2 === 1;
  };
  return { paths, bounds, occludes, contains };
}

export function sliceMesh(data: MeshData, plane: { point: Vec3; normal: Vec3 }): Vec3[][] {
  validateMesh(data);
  if (!plane || !finiteVec(plane.point) || !finiteVec(plane.normal) || lengthSq(plane.normal) === 0) {
    throw new TypeError('Slice plane requires a finite point and non-zero normal');
  }
  const normalLength = Math.sqrt(lengthSq(plane.normal));
  const normal = mul(plane.normal, 1 / normalLength);
  const scale = data.vertices.reduce((max, vertex) => Math.max(max, Math.sqrt(lengthSq(vertex))), 1);
  const tolerance = 1e-9 * scale;
  const signed = (point: Vec3) => dot(sub(point, plane.point), normal);
  const segments: [Vec3, Vec3][] = [];
  const coplanarEdges = new Map<string, { points: [Vec3, Vec3]; count: number }>();
  const edgeKey = (a: Vec3, b: Vec3) => pointKey(a) < pointKey(b) ? `${pointKey(a)}|${pointKey(b)}` : `${pointKey(b)}|${pointKey(a)}`;
  for (const face of data.faces) {
    const vertices = face.map(index => data.vertices[index]) as [Vec3, Vec3, Vec3];
    const distances = vertices.map(signed);
    if (distances.every(value => Math.abs(value) <= tolerance)) {
      for (const [a, b] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]] as [Vec3, Vec3][]) {
        const key = edgeKey(a, b);
        const existing = coplanarEdges.get(key);
        if (existing) existing.count++;
        else coplanarEdges.set(key, { points: [a, b], count: 1 });
      }
      continue;
    }
    const points: Vec3[] = [];
    for (let edge = 0; edge < 3; edge++) {
      const next = (edge + 1) % 3;
      const da = distances[edge], db = distances[next];
      if (Math.abs(da) <= tolerance) points.push(vertices[edge]);
      if ((da < -tolerance && db > tolerance) || (da > tolerance && db < -tolerance)) {
        points.push(add(vertices[edge], mul(sub(vertices[next], vertices[edge]), da / (da - db))));
      }
    }
    const unique = new Map(points.map(point => [pointKey(point), point]));
    const intersections = [...unique.values()];
    if (intersections.length >= 2) {
      let best: [Vec3, Vec3] | undefined;
      let farthest = 0;
      for (let i = 0; i < intersections.length; i++) for (let j = i + 1; j < intersections.length; j++) {
        const distance = lengthSq(sub(intersections[i], intersections[j]));
        if (distance > farthest) { farthest = distance; best = [intersections[i], intersections[j]]; }
      }
      if (best && farthest > tolerance * tolerance) segments.push(best);
    }
  }
  for (const edge of coplanarEdges.values()) if (edge.count === 1) segments.push(edge.points);
  const nodeFor = new Map<string, { point: Vec3; edges: number[] }>();
  const edgePairs = new Set<string>();
  const graphEdges: [string, string][] = [];
  for (const [a, b] of segments) {
    const keyA = a.map(value => Math.round(value / tolerance)).join(',');
    const keyB = b.map(value => Math.round(value / tolerance)).join(',');
    if (keyA === keyB) continue;
    const pair = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    if (edgePairs.has(pair)) continue;
    edgePairs.add(pair);
    graphEdges.push([keyA, keyB]);
    if (!nodeFor.has(keyA)) nodeFor.set(keyA, { point: a, edges: [] });
    if (!nodeFor.has(keyB)) nodeFor.set(keyB, { point: b, edges: [] });
  }
  graphEdges.forEach(([a, b], index) => {
    nodeFor.get(a)!.edges.push(index);
    nodeFor.get(b)!.edges.push(index);
  });
  const edgeUsed = new Set<number>();
  const paths: Vec3[][] = [];
  const otherEnd = (edge: [string, string], key: string) => edge[0] === key ? edge[1] : edge[0];
  const walk = (start: string, firstEdge: number): Vec3[] => {
    const path = [nodeFor.get(start)!.point];
    let current = start, edgeIndex: number | undefined = firstEdge;
    while (edgeIndex !== undefined && !edgeUsed.has(edgeIndex)) {
      edgeUsed.add(edgeIndex);
      current = otherEnd(graphEdges[edgeIndex], current);
      path.push(nodeFor.get(current)!.point);
      edgeIndex = nodeFor.get(current)!.edges
        .filter(index => !edgeUsed.has(index))
        .sort((a, b) => {
          const ka = otherEnd(graphEdges[a], current), kb = otherEnd(graphEdges[b], current);
          return ka.localeCompare(kb);
        })[0];
    }
    return path;
  };
  const keys = [...nodeFor.keys()].sort();
  for (const key of keys) {
    const node = nodeFor.get(key)!;
    if (node.edges.length === 2) continue;
    for (const edge of node.edges.slice().sort((a, b) => a - b)) {
      if (!edgeUsed.has(edge)) paths.push(walk(key, edge));
    }
  }
  for (let edge = 0; edge < graphEdges.length; edge++) {
    if (!edgeUsed.has(edge)) paths.push(walk(graphEdges[edge][0], edge));
  }
  return paths.filter(path => path.length >= 2);
}

function triangleBoxOverlap(a: Vec3, b: Vec3, c: Vec3, center: Vec3, half: Vec3): boolean {
  const vertices = [sub(a, center), sub(b, center), sub(c, center)];
  const edges = [sub(vertices[1], vertices[0]), sub(vertices[2], vertices[1]), sub(vertices[0], vertices[2])];
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], cross(edges[0], edges[1])];
  for (const edge of edges) {
    axes.push(cross(edge, [1, 0, 0]), cross(edge, [0, 1, 0]), cross(edge, [0, 0, 1]));
  }
  for (const axis of axes) {
    const norm = lengthSq(axis);
    if (norm < 1e-24) continue;
    const projections = vertices.map(vertex => dot(vertex, axis));
    const radius = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
    if (Math.min(...projections) > radius + 1e-12 || Math.max(...projections) < -radius - 1e-12) return false;
  }
  return true;
}

function isClosedMesh(data: MeshData): boolean {
  const edgeCounts = new Map<string, number>();
  for (const face of data.faces) for (const [aIndex, bIndex] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
    const a = pointKey(data.vertices[aIndex]);
    const b = pointKey(data.vertices[bIndex]);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }
  return [...edgeCounts.values()].every(count => count === 2);
}

/** Open meshes produce surface voxels only; interior filling is done for closed meshes. */
export function voxelizeMesh(data: MeshData, options: { size: number; maxVoxels?: number }): Vec3[] {
  validateMesh(data);
  if (!options || !Number.isFinite(options.size) || options.size <= 0) {
    throw new RangeError('Voxel size must be a positive finite number');
  }
  const maxVoxels = options.maxVoxels ?? 10_000;
  if (!Number.isSafeInteger(maxVoxels) || maxVoxels < 1 || maxVoxels > 1_000_000) {
    throw new RangeError('maxVoxels must be an integer between 1 and 1000000');
  }
  const bounds = boundsOfPoints(data.vertices);
  const dimensions = bounds.min.map((value, axis) => Math.max(1, Math.ceil((bounds.max[axis] - value) / options.size))) as Vec3;
  const total = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(total) || total > maxVoxels) {
    throw new RangeError(`Voxel grid requires ${total} cells, exceeding maxVoxels (${maxVoxels})`);
  }
  const occupied = new Set<number>();
  const index = (x: number, y: number, z: number) => (z * dimensions[1] + y) * dimensions[0] + x;
  let candidates = 0;
  const workLimit = Math.max(1_000_000, maxVoxels * 200);
  for (const face of data.faces) {
    const [a, b, c] = face.map(vertex => data.vertices[vertex]) as [Vec3, Vec3, Vec3];
    const triMin = [0, 1, 2].map(axis => Math.min(a[axis], b[axis], c[axis]));
    const triMax = [0, 1, 2].map(axis => Math.max(a[axis], b[axis], c[axis]));
    const low = triMin.map((value, axis) => Math.max(0, Math.min(
      dimensions[axis] - 1, Math.floor((value - bounds.min[axis]) / options.size - 1e-10),
    ))) as Vec3;
    const high = triMax.map((value, axis) => Math.min(dimensions[axis] - 1, Math.floor((value - bounds.min[axis]) / options.size))) as Vec3;
    for (let z = low[2]; z <= high[2]; z++) for (let y = low[1]; y <= high[1]; y++) for (let x = low[0]; x <= high[0]; x++) {
      if (++candidates > workLimit) throw new RangeError('Voxelization exceeds its triangle-cell work limit');
      const center: Vec3 = [
        bounds.min[0] + (x + 0.5) * options.size,
        bounds.min[1] + (y + 0.5) * options.size,
        bounds.min[2] + (z + 0.5) * options.size,
      ];
      const half: Vec3 = [options.size / 2, options.size / 2, options.size / 2];
      if (triangleBoxOverlap(a, b, c, center, half)) occupied.add(index(x, y, z));
    }
  }
  if (isClosedMesh(data)) {
    const geometry = createMeshGeometry(data);
    for (let z = 0; z < dimensions[2]; z++) for (let y = 0; y < dimensions[1]; y++) for (let x = 0; x < dimensions[0]; x++) {
      const cell = index(x, y, z);
      if (occupied.has(cell)) continue;
      const center: Vec3 = [
        bounds.min[0] + (x + 0.5) * options.size,
        bounds.min[1] + (y + 0.5) * options.size,
        bounds.min[2] + (z + 0.5) * options.size,
      ];
      if (geometry.contains(center)) occupied.add(cell);
    }
  }
  return [...occupied].sort((a, b) => a - b).map(cell => {
    const x = cell % dimensions[0];
    const y = Math.floor(cell / dimensions[0]) % dimensions[1];
    const z = Math.floor(cell / (dimensions[0] * dimensions[1]));
    return [
      bounds.min[0] + (x + 0.5) * options.size,
      bounds.min[1] + (y + 0.5) * options.size,
      bounds.min[2] + (z + 0.5) * options.size,
    ] as Vec3;
  });
}
