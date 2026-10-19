type Vec3 = [number, number, number];

export interface HeightFieldOptions {
  x?: [number, number];
  y?: [number, number];
  lines?: number;
  samples?: number;
  style?: 'parallel' | 'grid';
  height: (x: number, y: number) => number;
}

interface Bounds {
  min: Vec3;
  max: Vec3;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  children: Bounds[];
}

export function validateHeightField(options: HeightFieldOptions): void {
  if (!options || typeof options.height !== 'function') {
    throw new TypeError('Height field requires a height(x, y) function');
  }
  for (const range of [options.x ?? [-1, 1], options.y ?? [-1, 1]]) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) {
      throw new RangeError('Height field ranges must contain two increasing finite numbers');
    }
  }
  for (const [name, value, min, max] of [
    ['lines', options.lines ?? 70, 2, 200],
    ['samples', options.samples ?? 160, 8, 256],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`Height field ${name} must be an integer between ${min} and ${max}`);
    }
  }
  if (options.style !== undefined && !['parallel', 'grid'].includes(options.style)) {
    throw new RangeError('Height field style must be parallel or grid');
  }
}

export function createHeightField(options: HeightFieldOptions) {
  validateHeightField(options);
  const [xmin, xmax] = options.x ?? [-1, 1];
  const [ymin, ymax] = options.y ?? [-1, 1];
  const samples = options.samples ?? 160;
  const lines = options.lines ?? 70;
  const stepX = (xmax - xmin) / samples;
  const stepY = (ymax - ymin) / samples;
  const heights = new Float64Array((samples + 1) ** 2);
  const index = (x: number, y: number) => y * (samples + 1) + x;
  for (let y = 0; y <= samples; y++) {
    for (let x = 0; x <= samples; x++) {
      const height = options.height(xmin + x * stepX, ymin + y * stepY);
      if (!Number.isFinite(height)) {
        throw new TypeError(`Height field height must be finite at (${xmin + x * stepX}, ${ymin + y * stepY})`);
      }
      heights[index(x, y)] = height;
    }
  }
  const vertex = (x: number, y: number): Vec3 => [
    xmin + x * stepX, ymin + y * stepY, heights[index(x, y)],
  ];
  const evaluate = (x: number, y: number): Vec3 => {
    const gx = Math.max(0, Math.min(samples, (x - xmin) / stepX));
    const gy = Math.max(0, Math.min(samples, (y - ymin) / stepY));
    const ix = Math.min(samples - 1, Math.floor(gx));
    const iy = Math.min(samples - 1, Math.floor(gy));
    const u = gx - ix;
    const v = gy - iy;
    const a = heights[index(ix, iy)];
    const b = heights[index(ix + 1, iy)];
    const c = heights[index(ix, iy + 1)];
    const d = heights[index(ix + 1, iy + 1)];
    // Plot curves use exactly the same piecewise-planar surface as occlusion.
    const z = u + v <= 1
      ? a + u * (b - a) + v * (c - a)
      : d + (1 - u) * (c - d) + (1 - v) * (b - d);
    return [x, y, z];
  };
  const build = (x0: number, x1: number, y0: number, y1: number): Bounds => {
    const children: Bounds[] = [];
    if (x1 - x0 > 4 || y1 - y0 > 4) {
      const xs = x1 - x0 > 4 ? [x0, Math.floor((x0 + x1) / 2), x1] : [x0, x1];
      const ys = y1 - y0 > 4 ? [y0, Math.floor((y0 + y1) / 2), y1] : [y0, y1];
      for (let j = 1; j < ys.length; j++) {
        for (let i = 1; i < xs.length; i++) children.push(build(xs[i - 1], xs[i], ys[j - 1], ys[j]));
      }
    }
    let low = Infinity;
    let high = -Infinity;
    if (children.length) {
      for (const child of children) {
        low = Math.min(low, child.min[2]);
        high = Math.max(high, child.max[2]);
      }
    } else {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          low = Math.min(low, heights[index(x, y)]);
          high = Math.max(high, heights[index(x, y)]);
        }
      }
    }
    return {
      x0, x1, y0, y1, children,
      min: [xmin + x0 * stepX, ymin + y0 * stepY, low],
      max: [xmin + x1 * stepX, ymin + y1 * stepY, high],
    };
  };
  const root = build(0, samples, 0, samples);
  const occludes = (origin: Vec3, direction: Vec3): boolean => {
    const triangleHit = (a: Vec3, b: Vec3, c: Vec3): boolean => {
      const e1 = b.map((value, i) => value - a[i]);
      const e2 = c.map((value, i) => value - a[i]);
      const p = [
        direction[1] * e2[2] - direction[2] * e2[1],
        direction[2] * e2[0] - direction[0] * e2[2],
        direction[0] * e2[1] - direction[1] * e2[0],
      ];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-14) return false;
      const t = origin.map((value, i) => value - a[i]);
      const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) / det;
      if (u < -1e-10 || u > 1 + 1e-10) return false;
      const q = [
        t[1] * e1[2] - t[2] * e1[1],
        t[2] * e1[0] - t[0] * e1[2],
        t[0] * e1[1] - t[1] * e1[0],
      ];
      const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) / det;
      if (v < -1e-10 || u + v > 1 + 1e-10) return false;
      const distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      return distance > 1e-8 && distance < 1 - 1e-8;
    };
    const visit = (node: Bounds): boolean => {
      let near = 1e-8;
      let far = 1 - 1e-8;
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(direction[axis]) < 1e-14) {
          if (origin[axis] < node.min[axis] - 1e-10 || origin[axis] > node.max[axis] + 1e-10) return false;
        } else {
          const a = (node.min[axis] - origin[axis]) / direction[axis];
          const b = (node.max[axis] - origin[axis]) / direction[axis];
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
          if (near > far + 1e-12) return false;
        }
      }
      if (node.children.length) return node.children.some(visit);
      for (let y = node.y0; y < node.y1; y++) {
        for (let x = node.x0; x < node.x1; x++) {
          const a = vertex(x, y);
          const b = vertex(x + 1, y);
          const c = vertex(x, y + 1);
          const d = vertex(x + 1, y + 1);
          if (triangleHit(a, b, c) || triangleHit(b, d, c)) return true;
        }
      }
      return false;
    };
    return visit(root);
  };
  const curves = [];
  for (let line = 0; line < lines; line++) {
    const y = ymin + (ymax - ymin) * line / (lines - 1);
    curves.push({ samples, evaluate: (t: number) => evaluate(xmin + (xmax - xmin) * t, y) });
    if (options.style === 'grid') {
      const x = xmin + (xmax - xmin) * line / (lines - 1);
      curves.push({ samples, evaluate: (t: number) => evaluate(x, ymin + (ymax - ymin) * t) });
    }
  }
  return { curves, occludes, evaluate, bounds: { min: root.min, max: root.max } };
}
