import { test, expect } from '@playwright/test';
import { Vector3, Euler } from 'three';
import { renderLineArtScene } from '../src/lib/genart/lineArtRenderer.ts';
import { createHeightField } from '../src/lib/genart/heightField.ts';
import { generate } from '../src/lib/genart/codeArtSandbox.js';
import { codeArtExamples } from '../src/lib/genart/codeArtExamples.js';

function object(shape, overrides = {}) {
  return {
    shape,
    detail: 5,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
}

function worldPoint(point, solid) {
  // Three's ZYX Euler order applies the same X, then Y, then Z rotations.
  return new Vector3(...point)
    .multiply(new Vector3(...solid.scale))
    .applyEuler(new Euler(...solid.rotation.map(angle => angle * Math.PI / 180), 'ZYX'))
    .add(new Vector3(...solid.position));
}

function referenceProjection(solid, camera) {
  const eye = new Vector3(...camera.position);
  const forward = new Vector3(...camera.target).sub(eye).normalize();
  const right = forward.clone().cross(new Vector3(...camera.up)).normalize();
  const up = right.clone().cross(forward);
  const project = point => {
    const relative = worldPoint(point, solid).sub(eye);
    return {
      nx: relative.dot(right) / relative.dot(forward),
      ny: relative.dot(up) / relative.dot(forward),
    };
  };
  const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => project([x, y, z]))));
  const minX = Math.min(...corners.map(p => p.nx));
  const maxX = Math.max(...corners.map(p => p.nx));
  const minY = Math.min(...corners.map(p => p.ny));
  const maxY = Math.max(...corners.map(p => p.ny));
  const fit = 1.84 / Math.max(maxX - minX, maxY - minY);
  return point => {
    const projected = project(point);
    return {
      nx: (projected.nx - (minX + maxX) / 2) * fit,
      ny: (projected.ny - (minY + maxY) / 2) * fit,
    };
  };
}

const camera = { position: [4.5, -6, 4], target: [0, 0, 0], up: [0, 0, 1], fov: 45 };
const distance = (a, b) => Math.hypot(a.nx - b.nx, a.ny - b.ny);

for (const [name, solid] of [
  ['unit cube', object('cube')],
  ['rotated courtyard block', object('cube', {
    scale: [0.24, 0.24, 0.5], rotation: [0, 0, 12], position: [0.65, 0.55, 0.15],
  })],
  ['tilted and mirrored cube', object('cube', {
    scale: [-0.7, 0.4, 1.2], rotation: [12, 18, 8],
  })],
]) {
  test(`${name} preserves every grid line on all visible faces without silhouette stubs`, () => {
    const paths = renderLineArtScene([solid], camera);
    const project = referenceProjection(solid, camera);
    const eye = new Vector3(...camera.position);
    const expected = [];
    for (let axis = 0; axis < 3; axis++) {
      const remaining = [0, 1, 2].filter(value => value !== axis);
      for (const side of [-1, 1]) {
        const centre = [0, 0, 0];
        centre[axis] = side;
        const normal = worldPoint(centre, solid).sub(new Vector3(...solid.position)).normalize();
        if (normal.dot(eye.clone().sub(worldPoint(centre, solid))) <= 0) continue;
        for (const direction of [0, 1]) {
          for (let line = 0; line <= 10; line++) {
            const start = [...centre];
            const end = [...centre];
            start[remaining[direction]] = -1;
            end[remaining[direction]] = 1;
            start[remaining[1 - direction]] = end[remaining[1 - direction]] = -1 + line / 5;
            expected.push([project(start), project(end)]);
          }
        }
      }
    }
    expect(expected).toHaveLength(66);
    for (const [start, end] of expected) {
      expect(paths.some(path => (
        (distance(path[0], start) < 1e-5 && distance(path.at(-1), end) < 1e-5)
        || (distance(path[0], end) < 1e-5 && distance(path.at(-1), start) < 1e-5)
      )), `missing complete grid line ${JSON.stringify([start, end])}`).toBe(true);
    }
    const shortestGrid = Math.min(...expected.map(([start, end]) => distance(start, end)));
    for (const path of paths) {
      expect(distance(path[0], path.at(-1))).toBeGreaterThanOrEqual(shortestGrid - 1e-5);
    }
  });
}

for (const shape of ['cube', 'sphere', 'cylinder', 'torus']) {
  test(`${shape} completely occludes a smaller object behind its surface`, () => {
    const front = object(shape);
    const x = shape === 'torus' ? 0.68 : 0;
    const view = { position: [x, 0, 6], target: [x, 0, 0], up: [0, 1, 0] };
    const hidden = object('cube', { position: [x, 0, -2], scale: [0.04, 0.04, 0.04] });
    expect(renderLineArtScene([front, hidden], view)).toEqual(renderLineArtScene([front], view));
  });
}

test('the torus hole does not occlude objects visible through it', () => {
  const torus = object('torus');
  const throughHole = object('cube', { position: [0, 0, -2], scale: [0.1, 0.1, 0.1] });
  const view = { position: [0, 0, 6], target: [0, 0, 0], up: [0, 1, 0] };
  const ring = renderLineArtScene([torus], view);
  const scene = renderLineArtScene([torus, throughHole], view);
  expect(scene.length).toBeGreaterThan(ring.length);
  expect(scene.some(path => path.every(p => Math.hypot(p.nx, p.ny) < 0.15))).toBe(true);
});

test('a foreground cube clips rear grid lines precisely at its silhouette', () => {
  const rear = object('cube');
  const front = object('cube', { position: [0, -2, 0], scale: [0.25, 0.25, 0.5] });
  const view = { position: [0, -6, 0], target: [0, 0, 0], up: [0, 0, 1] };
  const paths = renderLineArtScene([rear, front], view);
  const silhouette = (0.25 / 3.75) * (0.92 / (1 / 5));
  for (const [left, right] of [[-0.92, -silhouette], [silhouette, 0.92]]) {
    expect(paths.some(path => (
      Math.abs(path[0].ny) < 1e-6 && Math.abs(path.at(-1).ny) < 1e-6
      && Math.abs(Math.min(path[0].nx, path.at(-1).nx) - left) < 1e-5
      && Math.abs(Math.max(path[0].nx, path.at(-1).nx) - right) < 1e-5
    ))).toBe(true);
  }
});

test('rays along a cube face do not hide its silhouette', () => {
  const solid = object('cube');
  const view = { ...camera, position: [1, -6, 4] };
  const paths = renderLineArtScene([solid], view);
  const project = referenceProjection(solid, view);
  const start = project([1, -1, -1]);
  const end = project([1, -1, 1]);
  expect(paths.some(path => (
    distance(path[0], start) < 1e-5 && distance(path.at(-1), end) < 1e-5
  ))).toBe(true);
});

test('flat height fields retain exactly the requested parallel or grid lines', () => {
  for (const style of ['parallel', 'grid']) {
    const field = object('heightfield', {
      heightfield: { height: () => 0, lines: 12, samples: 24, style },
      rotation: [12, 18, 8], scale: [-1.2, 0.8, 1], position: [0.2, 0, 0.3],
    });
    const paths = renderLineArtScene([field], camera);
    expect(paths).toHaveLength(style === 'grid' ? 24 : 12);
    expect(paths.every(path => distance(path[0], path.at(-1)) > 0.5)).toBe(true);
  }
});

test('height-field BVH detects ridge occlusion without hiding points on the same surface', () => {
  let calls = 0;
  const field = createHeightField({
    height: (x, y) => { calls++; return Math.max(0, 1 - Math.abs(y) * 4); },
    samples: 32,
  });
  const eye = [0, -3, 1];
  const rayTo = point => point.map((value, i) => value - eye[i]);
  expect(field.occludes(eye, rayTo([0, 0.8, 0]))).toBe(true);
  expect(field.occludes(eye, rayTo([0, -0.8, 0]))).toBe(false);
  expect(field.occludes(eye, rayTo([0, 0, 1]))).toBe(false);
  expect(field.occludes([3, 0, 1], [0, 0, -2])).toBe(false);
  expect(calls).toBe(33 ** 2);
});

test('height fields and analytic solids occlude each other in a shared scene', () => {
  const water = object('heightfield', {
    heightfield: { height: () => 0, samples: 16, lines: 10, style: 'grid' },
  });
  const view = { position: [0, 0, 6], target: [0, 0, 0], up: [0, 1, 0] };
  const below = object('sphere', { position: [0, 0, -2], scale: [0.2, 0.2, 0.2] });
  expect(renderLineArtScene([water, below], view)).toEqual(renderLineArtScene([water], view));
  const cover = object('cube', { position: [0, 0, 1], scale: [2, 2, 0.1] });
  expect(renderLineArtScene([cover, water], view)).toEqual(renderLineArtScene([cover], view));
});

test('height fields reject invalid options and non-finite heights explicitly', () => {
  for (const options of [
    {}, { height: 3 }, { height: () => 0, x: [1, -1] },
    { height: () => 0, y: [0, Infinity] }, { height: () => 0, lines: 1 },
    { height: () => 0, lines: 201 }, { height: () => 0, samples: 257 },
    { height: () => 0, samples: 12.5 }, { height: () => 0, style: 'invalid' },
    { height: () => NaN }, { height: () => Infinity }, { height: () => '1' },
  ]) {
    expect(() => createHeightField(options)).toThrow();
  }
  expect(() => createHeightField({ height: () => { throw new Error('bad formula'); } })).toThrow('bad formula');
  expect(() => generate({ code: 'return solid.heightfield({});' })).toThrow(/height/);
});

test('height-field builder preserves its formula and options through chained transforms', () => {
  const code = `return scene().add(solid.heightfield({
    height: (x, y) => x * y * 0.1, lines: 12, samples: 24, style: 'grid'
  }).scale(0.8, 1.2, -0.5).rotate(12, 18, 8).translate(0.2, 0, 0.3))
    .render(${JSON.stringify(camera)});`;
  const expected = renderLineArtScene([object('heightfield', {
    heightfield: { height: (x, y) => x * y * 0.1, lines: 12, samples: 24, style: 'grid' },
    scale: [0.8, 1.2, -0.5], rotation: [12, 18, 8], position: [0.2, 0, 0.3],
  })], camera);
  expect(generate({ code })).toEqual(expected);
});

test('droplet example produces bounded, finite plotter paths', () => {
  const example = codeArtExamples.find(item => item.id === 'droplet-ripples');
  const paths = generate({ code: example.code });
  expect(paths.length).toBeGreaterThanOrEqual(90);
  expect(paths.length).toBeLessThan(1000);
  expect(paths.flat().length).toBeLessThan(100000);
  expect(paths.flat().every(point => (
    Number.isFinite(point.nx) && Number.isFinite(point.ny)
    && Math.abs(point.nx) <= 0.92001 && Math.abs(point.ny) <= 0.92001
  ))).toBe(true);
});
