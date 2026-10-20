export function buildQuantizedGap(back, front, backZ, frontZ, width, hatchStep) {
  const positions = [];
  const hatches = [];
  const dx = width / (back.length - 1);
  const lerp = (a, b, t) => a + (b - a) * t;

  function positiveRange(a, b) {
    if (a <= 0 && b <= 0) return null;
    return [
      a < 0 ? a / (a - b) : 0,
      b < 0 ? a / (a - b) : 1,
    ];
  }

  for (let i = 0; i < back.length - 1; i++) {
    const range = positiveRange(back[i] - front[i], back[i + 1] - front[i + 1]);
    if (!range) continue;
    const edge = (heights, z, t) => [
      (i + t) * dx - width / 2,
      lerp(heights[i], heights[i + 1], t),
      z,
    ];
    const b0 = edge(back, backZ, range[0]);
    const b1 = edge(back, backZ, range[1]);
    const f0 = edge(front, frontZ, range[0]);
    const f1 = edge(front, frontZ, range[1]);
    positions.push(...b0, ...f0, ...b1, ...b1, ...f0, ...f1);
  }

  const yMin = front.reduce((min, y) => Math.min(min, y), Infinity);
  const yMax = back.reduce((max, y) => Math.max(max, y), -Infinity);
  const samePoint = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-9);
  const compare = (a, b) => a[0] - b[0] || a[2] - b[2];
  for (let y = yMin; y <= yMax + 1e-6; y += hatchStep) {
    const segments = [];
    // Slice the rendered triangles, rather than approximating a non-planar
    // gap with a straight hatch that can float above or below its surface.
    for (let i = 0; i < positions.length; i += 9) {
      const vertices = [0, 3, 6].map(offset => positions.slice(i + offset, i + offset + 3));
      if (vertices.every(point => Math.abs(point[1] - y) < 1e-9)) continue;
      const hits = [];
      const addHit = point => {
        if (!hits.some(hit => samePoint(hit, point))) hits.push(point);
      };
      for (let edge = 0; edge < 3; edge++) {
        const a = vertices[edge];
        const b = vertices[(edge + 1) % 3];
        if (Math.abs(a[1] - y) < 1e-9) addHit(a);
        if ((a[1] < y && b[1] > y) || (a[1] > y && b[1] < y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          addHit([lerp(a[0], b[0], t), y, lerp(a[2], b[2], t)]);
        }
      }
      if (hits.length === 2) segments.push(hits.sort(compare));
    }
    segments.sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
    let path = [];
    let previous;
    const finish = () => {
      if (path.length >= 6) hatches.push(path);
      path = [];
    };
    for (const [start, end] of segments) {
      if (previous && samePoint(previous[0], start) && samePoint(previous[1], end)) continue;
      if (path.length && samePoint(path.slice(-3), start)) {
        path.push(...end);
      } else {
        finish();
        path.push(...start, ...end);
      }
      previous = [start, end];
    }
    finish();
  }

  return { positions, hatches };
}
