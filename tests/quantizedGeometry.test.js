import { test, expect } from '@playwright/test';
import { buildQuantizedGap } from '../src/lib/quantizedGeometry.js';
import { Triangle, Vector3 } from 'three';

const gap = (back, front) => buildQuantizedGap(back, front, 0, 2, 20, 0.3);
const points = positions => Array.from({ length: positions.length / 3 }, (_, i) => positions.slice(i * 3, i * 3 + 3));

test('quantized fills meet both ridge heights at their actual depths', () => {
  const { positions, hatches } = gap([2, 2], [0, 0]);
  expect(points(positions)).toEqual([
    [-10, 2, 0], [-10, 0, 2], [10, 2, 0],
    [10, 2, 0], [-10, 0, 2], [10, 0, 2],
  ]);
  expect(hatches.length).toBeGreaterThan(0);
  for (const hatch of hatches) {
    for (const [x, y, z] of points(hatch)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(2);
      expect(z).toBeCloseTo(2 - y, 10);
    }
  }
});

test('quantized fills retain narrow features between the former 64 subsamples', () => {
  const back = new Float32Array(512);
  back[4] = 2;
  const { positions, hatches } = gap(back, new Float32Array(512));
  expect(positions.length).toBeGreaterThan(0);
  expect(hatches.length).toBeGreaterThan(0);
  const vertices = points(positions);
  expect(vertices.some(([, y, z]) => y === 2 && z === 0)).toBe(true);
  for (const [x] of vertices) {
    expect(x).toBeGreaterThanOrEqual(3 * 20 / 511 - 10);
    expect(x).toBeLessThanOrEqual(5 * 20 / 511 - 10);
  }
});

test('crossing ridges clip fills and hatches at the exact intersection', () => {
  const { positions, hatches } = gap([2, -2], [0, 0]);
  expect(positions.length).toBeGreaterThan(0);
  for (const [x, y] of points(positions)) {
    expect(x).toBeLessThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
  }
  for (const hatch of hatches) {
    for (const [x, y, z] of points(hatch)) {
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(-x / 5 + 1e-10);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(2);
    }
  }
});

test('hatches do not connect separate gap regions across a foreground ridge', () => {
  const { hatches } = gap([2, 2, -2, 2, 2], [0, 0, 0, 0, 0]);
  expect(hatches.length).toBeGreaterThan(0);
  for (const hatch of hatches) {
    const xs = points(hatch).map(([x]) => x);
    expect(Math.max(...xs) <= -2.5 || Math.min(...xs) >= 2.5).toBe(true);
  }
});

test('equal or foreground-higher ridges produce no colored gap', () => {
  for (const [back, front] of [
    [[0, 0], [0, 0]],
    [[-2, -1], [0, 0]],
  ]) {
    expect(gap(back, front)).toEqual({ positions: [], hatches: [] });
  }
});

test('entire hatch segments lie on the rendered triangles for non-planar gaps', () => {
  const { positions, hatches } = gap([3, 1, 4], [-1, 0, 2]);
  const triangles = [];
  for (let i = 0; i < positions.length; i += 9) {
    triangles.push(new Triangle(...[0, 3, 6].map(offset => (
      new Vector3(...positions.slice(i + offset, i + offset + 3))
    ))));
  }
  expect(hatches.length).toBeGreaterThan(0);
  for (const hatch of hatches) {
    const vertices = points(hatch);
    for (let i = 1; i < vertices.length; i++) {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const point = new Vector3(...vertices[i - 1]).lerp(new Vector3(...vertices[i]), fraction);
        const distance = Math.min(...triangles.map(triangle => (
          triangle.closestPointToPoint(point, new Vector3()).distanceTo(point)
        )));
        expect(distance).toBeLessThan(1e-9);
      }
    }
  }
});
