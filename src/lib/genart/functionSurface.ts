import { createHeightField, type HeightFieldOptions } from './heightField';
import type { MeshData, Vec3 } from './meshGeometry';

export interface FunctionSurfaceOptions extends HeightFieldOptions {
  z: [number, number];
  side?: 'below' | 'above';
}

export function createFunctionSurface(options: FunctionSurfaceOptions) {
  if (!options || !Array.isArray(options.z) || options.z.length !== 2
    || !options.z.every(Number.isFinite) || options.z[0] >= options.z[1]) {
    throw new RangeError('Function surface z must contain two increasing finite bounds');
  }
  if (options.side !== undefined && !['below', 'above'].includes(options.side)) {
    throw new RangeError('Function surface side must be below or above');
  }
  if (typeof options.height !== 'function') throw new TypeError('Function surface requires height(x, y)');
  const samples = options.samples ?? 100;
  if (!Number.isInteger(samples) || samples < 8 || samples > 128) {
    throw new RangeError('Function surface samples must be an integer between 8 and 128');
  }
  const height = (x: number, y: number) => {
    const value = options.height(x, y);
    if (typeof value !== 'number' || Number.isNaN(value)) throw new TypeError(`Function surface height is invalid at (${x}, ${y})`);
    return Math.max(options.z[0], Math.min(options.z[1], value));
  };
  const field = createHeightField({ ...options, samples, height });
  const mesh: MeshData = { vertices: [], faces: [] };
  const [xmin, xmax] = options.x ?? [-1, 1];
  const [ymin, ymax] = options.y ?? [-1, 1];
  const base = options.side === 'above' ? options.z[1] : options.z[0];
  const top: Vec3[] = [];
  // Reuse the sampled surface, including clipping of infinities, without calling height again.
  const rows = createHeightFieldRows(field, samples, xmin, xmax, ymin, ymax);
  top.push(...rows);
  mesh.vertices = [...top, ...top.map(([x, y]): Vec3 => [x, y, base])];
  const offset = top.length;
  const add = (a: number, b: number, c: number) => {
    const p = mesh.vertices[a], q = mesh.vertices[b], r = mesh.vertices[c];
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-14) mesh.faces.push([a, b, c]);
  };
  for (let y = 0; y < samples; y++) for (let x = 0; x < samples; x++) {
    const a = y * (samples + 1) + x, b = a + 1, c = a + samples + 1, d = c + 1;
    add(a, b, c); add(b, d, c);
    add(a + offset, c + offset, b + offset); add(b + offset, c + offset, d + offset);
  }
  const boundary = [
    ...Array.from({ length: samples }, (_, x) => x),
    ...Array.from({ length: samples }, (_, y) => y * (samples + 1) + samples),
    ...Array.from({ length: samples }, (_, x) => samples * (samples + 1) + samples - x),
    ...Array.from({ length: samples }, (_, y) => (samples - y) * (samples + 1)),
  ];
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    add(a, a + offset, b); add(b, a + offset, b + offset);
  }
  if (!mesh.faces.length) throw new RangeError('Function surface has no area');
  const lineCount = options.lines ?? 70;
  const directions = options.style === 'grid' ? 2 : 1;
  const paths = field.curves.map((curve, index) => {
    const line = Math.floor(index / directions);
    const coordinate = samples * line / (lineCount - 1);
    const fraction = coordinate - Math.floor(coordinate);
    const times = [0];
    for (let cell = 0; cell < samples; cell++) {
      // Include diagonal crossings, so no plotted chord cuts through the volume.
      if (fraction > 1e-10 && fraction < 1 - 1e-10) times.push((cell + 1 - fraction) / samples);
      times.push((cell + 1) / samples);
    }
    return times.map(t => curve.evaluate(t));
  });
  return { mesh, paths };
}

function createHeightFieldRows(
  field: ReturnType<typeof createHeightField>, samples: number,
  xmin: number, xmax: number, ymin: number, ymax: number,
): Vec3[] {
  return Array.from({ length: (samples + 1) ** 2 }, (_, i) => {
    const x = i % (samples + 1);
    const y = Math.floor(i / (samples + 1));
    return field.evaluate(xmin + (xmax - xmin) * x / samples, ymin + (ymax - ymin) * y / samples);
  });
}
