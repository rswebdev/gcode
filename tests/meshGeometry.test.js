import { test, expect } from '@playwright/test';
import {
  createMeshGeometry,
  fitMesh,
  parseOBJ,
  parseSTL,
  sliceMesh,
  validateMesh,
  voxelizeMesh,
} from '../src/lib/genart/meshGeometry.ts';

const cube = {
  vertices: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ],
  faces: [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ],
};

function binarySTL() {
  const buffer = new ArrayBuffer(134);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((point, index) => {
    const offset = 84 + index * 12;
    point.forEach((value, axis) => view.setFloat32(offset + axis * 4, value, true));
  });
  return buffer;
}

test('OBJ parses slash references, negative indices and triangulates polygons', () => {
  const mesh = parseOBJ(`
    v 0 0 0
    v 2 0 0
    v 2 2 0
    v 0 2 0
    vt 0 0
    f -4/1 -3/1 -2/1 -1/1
  `);
  expect(mesh.vertices).toHaveLength(4);
  expect(mesh.faces).toHaveLength(2);
  expect(mesh.faces.flat().every(index => index >= 0 && index < 4)).toBe(true);
  expect(() => parseOBJ(`v 0 0 0
f 1 2 3`)).toThrow(/out of range/i);
});

test('ASCII and binary STL are parsed into validated triangle meshes', () => {
  const ascii = `solid one
 facet normal 0 0 1
 outer loop
 vertex 0 0 0
 vertex 1 0 0
 vertex 0 1 0
 endloop
 endfacet
endsolid`;
  expect(parseSTL(ascii).faces).toEqual([[0, 1, 2]]);
  expect(parseSTL(new TextEncoder().encode(ascii).buffer).faces).toEqual([[0, 1, 2]]);
  expect(parseSTL(binarySTL()).faces).toEqual([[0, 1, 2]]);
  expect(() => parseSTL(new ArrayBuffer(90))).toThrow();
});

test('OBJ triangulates concave polygons without filling the notch', () => {
  const source = `v 0 0 0
v 2 0 0
v 2 1 0
v 1 1 0
v 1 2 0
v 0 2 0
f 1 2 3 4 5 6`;
  const geometry = createMeshGeometry(parseOBJ(source));
  expect(geometry.occludes([0.5, 1.5, 1], [0, 0, -2])).toBe(true);
  expect(geometry.occludes([1.5, 1.5, 1], [0, 0, -2])).toBe(false);
});

test('OBJ polygon triangulation preserves the source winding for silhouettes', () => {
  const vertices = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n';
  for (const [face, sign] of [['f 1 2 3 4', 1], ['f 4 3 2 1', -1]]) {
    const mesh = parseOBJ(vertices + face);
    for (const indices of mesh.faces) {
      const [a,b,c] = indices.map(i => mesh.vertices[i]);
      expect(((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))*sign).toBeGreaterThan(0);
    }
  }
});

test('fitMesh preserves aspect ratio and centers the mesh in target bounds', () => {
  const source = {
    vertices: [[10, 0, 0], [14, 0, 0], [10, 2, 0]],
    faces: [[0, 1, 2]],
  };
  const fitted = fitMesh(source);
  const geometry = createMeshGeometry(fitted);
  expect(geometry.bounds.min[0]).toBeCloseTo(-1);
  expect(geometry.bounds.max[0]).toBeCloseTo(1);
  expect(geometry.bounds.min[1]).toBeCloseTo(-0.5);
  expect(geometry.bounds.max[1]).toBeCloseTo(0.5);
  expect(geometry.bounds.min[2]).toBeCloseTo(0);
});

test('geometry exposes unique edges, segment occlusion and closed-mesh containment', () => {
  const geometry = createMeshGeometry(cube);
  expect(geometry.paths).toHaveLength(18);
  expect(geometry.bounds).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
  expect(geometry.occludes([-2, 0.13, 0.17], [4, 0, 0])).toBe(true);
  expect(geometry.occludes([-2, 2, 0], [4, 0, 0])).toBe(false);
  expect(geometry.occludes([-2, 0, 0], [1, 0, 0])).toBe(false);
  expect(geometry.contains([0, 0, 0])).toBe(true);
  expect(geometry.contains([1, 0, 0])).toBe(true);
  expect(geometry.contains([1.01, 0, 0])).toBe(false);
});

test('plane slices stitch into continuous loops and omit coplanar triangulation seams', () => {
  const middle = sliceMesh(cube, { point: [0, 0, 0], normal: [0, 0, 1] });
  expect(middle).toHaveLength(1);
  expect(middle[0].length).toBe(9);
  expect(middle[0][0]).toEqual(middle[0].at(-1));
  expect(middle[0].every(point => Math.abs(point[2]) < 1e-9)).toBe(true);
  const top = sliceMesh(cube, { point: [0, 0, 1], normal: [0, 0, 1] });
  expect(top).toHaveLength(1);
  expect(top[0].length).toBe(5);
  expect(top[0][0]).toEqual(top[0].at(-1));
});

test('voxelization returns occupied surface/interior cells and rejects oversized grids', () => {
  const voxels = voxelizeMesh(cube, { size: 1 });
  expect(voxels).toHaveLength(8);
  expect(voxels).toContainEqual([-0.5, -0.5, -0.5]);
  expect(voxels).toContainEqual([0.5, 0.5, 0.5]);
  expect(() => voxelizeMesh(cube, { size: 0.05 })).toThrow(/maxVoxels/i);
  expect(() => voxelizeMesh(cube, { size: 1, maxVoxels: 0 })).toThrow(/maxVoxels/i);
});

test('voxelization includes open surfaces on the maximum grid boundary', () => {
  const planes = {
    vertices: [[0,0,0],[1,0,0],[0,1,0], [0,0,3],[1,0,3],[0,1,3]],
    faces: [[0,1,2],[3,4,5]],
  };
  const voxels = voxelizeMesh(planes, {size:1});
  expect(voxels).toContainEqual([0.5,0.5,0.5]);
  expect(voxels).toContainEqual([0.5,0.5,2.5]);
  expect(voxels).not.toContainEqual([0.5,0.5,1.5]);
});

test('mesh validation rejects non-finite, invalid-index, degenerate and excessive meshes', () => {
  expect(() => validateMesh({ vertices: [[0, 0, 0], [1, 0, 0], [0, Infinity, 0]], faces: [[0, 1, 2]] })).toThrow(/finite/i);
  expect(() => validateMesh({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 3]] })).toThrow(/index/i);
  expect(() => validateMesh({ vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], faces: [[0, 1, 2]] })).toThrow(/degenerate/i);
  const huge = { vertices: cube.vertices, faces: Array.from({ length: 100_001 }, () => [0, 1, 2]) };
  expect(() => validateMesh(huge)).toThrow(/100000/i);
});
