import { test, expect } from '@playwright/test';
import { generate } from '../src/lib/genart/codeArt.js';
import { createSceneIndex } from '../src/lib/genart/sceneSpatial.ts';
import { createFunctionSurface } from '../src/lib/genart/functionSurface.ts';
import { codeArtExamples } from '../src/lib/genart/codeArtExamples.js';
import { createMeshGeometry } from '../src/lib/genart/meshGeometry.ts';

const camera = `{position:[4,-6,4],target:[0,0,0],up:[0,0,1]}`;
function render(expression, view = camera, prelude = '') {
  return generate({ code: `${prelude}\nreturn scene().add(${expression}).render(${view});` });
}
function checkPaths(paths) {
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.every(path => path.length >= 2 && path.every(p => Number.isFinite(p.nx) && Number.isFinite(p.ny)))).toBe(true);
}

test('edge cubes draw nine complete visible edges instead of surface grids', () => {
  expect(render(`solid.cube().draw('edges')`)).toHaveLength(9);
  expect(render(`solid.cube().draw('silhouette')`)).toHaveLength(6);
});

test('sphere silhouette stays a complete ring under nonuniform and mirrored transforms', () => {
  const paths = render(`solid.sphere().draw('silhouette').scale(-1,0.6,1.2).rotate(15,20,12)`);
  expect(paths).toHaveLength(1);
  expect(Math.hypot(paths[0][0].nx - paths[0].at(-1).nx, paths[0][0].ny - paths[0].at(-1).ny)).toBeLessThan(1e-6);
});

test('cylinder, cone and torus support silhouette and grid drawings', () => {
  for (const primitive of ['cylinder', 'cone', 'torus']) {
    for (const draw of ['grid', 'silhouette']) checkPaths(render(`solid.${primitive}().draw('${draw}')`));
  }
});

test('custom 3D paths share occlusion and can replace solid grid paths', () => {
  const view = `{position:[0,-6,0],target:[0,0,0],up:[0,0,1],fit:false}`;
  const line = `paths3d([[[-2,1,0],[2,1,0]]])`;
  const clipped = render(`${line},solid.cube().occluder()`, view);
  expect(clipped).toHaveLength(2);
  expect(render(`${line},solid.cube().occluder().occlude(false)`, view)).toHaveLength(1);
  const surface = render(`solid.sphere().withPaths([Array.from({length:121},(_,i)=>latLng(0,i*3))])`);
  checkPaths(surface);
  expect(surface.length).toBeLessThan(4);
});

test('endpoint helpers align the base and tip with arbitrary endpoints', () => {
  const view = `{position:[4,-6,4],target:[0,0,0],up:[0,0,1],fit:false}`;
  const actual = render(`solid.cylinderBetween([1,2,3],[2,3,4],{radius:0.2,draw:'edges'})`, view);
  const explicit = render(`solid.cylinder({draw:'edges'}).scale(0.25,0.25,Math.sqrt(3)/2)
    .rotate(0,Math.acos(1/Math.sqrt(3))*180/Math.PI,45).translate(1.5,2.5,3.5)`, view);
  expect(actual).toEqual(explicit);
  checkPaths(render(`solid.coneBetween([0,0,-1],[0,0,1],{radius:0.5,draw:'silhouette'})`));
  expect(() => render(`solid.cylinderBetween([0,0,0],[0,0,0])`)).toThrow(/distance/);
});

test('CSG creates real holes, removes internal union paths and handles nested transforms', () => {
  const view = `{position:[0,0,6],target:[0,0,0],up:[0,1,0],fit:false}`;
  const ray = `paths3d([[[0,0,-3],[0.1,0,-3]]])`;
  const block = `solid.cube().occluder()`;
  const cut = `solid.cylinder().scale(0.5,0.5,2)`;
  expect(render(`${ray},${block}`, view)).toHaveLength(0);
  expect(render(`${ray},solid.difference(${block},${cut}).occluder()`, view)).toHaveLength(1);
  const merged = render(`solid.union(solid.cube({draw:'edges'}),solid.cube({draw:'edges'}).scale(0.3))`);
  expect(merged).toEqual(render(`solid.cube({draw:'edges'})`));
  checkPaths(render(`solid.difference(
    solid.intersection(solid.sphere(),solid.cube().scale(0.8)),
    solid.cylinder().scale(0.5,0.5,2)
  ).rotate(10,20,30).scale(-1,0.8,1)`));
  expect(() => render(`solid.union(solid.heightfield({height:()=>0}),solid.cube())`)).toThrow(/analytic/);
});

test('CSG supports axial cylinders with zero quadratic coefficient and cone cuts', () => {
  const view = `{position:[0,0,6],target:[0,0,0],up:[0,1,0],fit:false}`;
  expect(render(`paths3d([[[0,0,-3],[0.01,0,-3]]]),
    solid.difference(solid.cube(),solid.cylinder().scale(0.5,0.5,2)).occluder()`, view)).toHaveLength(1);
  checkPaths(render(`solid.difference(solid.cube(),solid.cone().scale(0.8,0.8,2))`));
});

test('bounded functions clamp infinities and add a closed occluding volume', () => {
  const options = { x: [-2, 2], y: [-2, 2], z: [-4, 1], samples: 16, lines: 12, height: (x, y) => -1 / (x*x+y*y) };
  const result = createFunctionSurface(options);
  expect(result.mesh.vertices.every(point => point.every(Number.isFinite))).toBe(true);
  expect(result.mesh.vertices.every(point => point[2] >= -4 && point[2] <= 1)).toBe(true);
  checkPaths(render(`solid.function({x:[-2,2],y:[-2,2],z:[-4,1],samples:24,lines:20,height:(x,y)=>-1/(x*x+y*y)})`));
  expect(() => createFunctionSurface({ ...options, height: () => NaN })).toThrow(/invalid/);
  expect(() => createFunctionSurface({ ...options, side: 'bad' })).toThrow(/side/);
});

test('bounded function paths remain on mesh triangles without hiding themselves', () => {
  for (const side of ['above', 'below']) {
    const surface = createFunctionSurface({
      x: [-1,1], y: [-1,1], z: [-1,1], samples: 16, lines: 13,
      style: 'grid', side, height: (x,y) => 0.3 * Math.cos(4*x) * Math.sin(4*y),
    });
    const mesh = createMeshGeometry(surface.mesh);
    const eye = [0,0,5];
    for (const path of surface.paths) {
      for (let i=1; i<path.length; i++) {
        const point = path[i].map((value,axis) => (value+path[i-1][axis])/2);
        const direction = point.map((value,axis) => value-eye[axis]);
        if (side === 'below') expect(mesh.occludes(eye,direction)).toBe(false);
      }
    }
  }
});

test('camera framing preserves field of view and clips near/far planes', () => {
  const view = `{position:[0,-6,0],target:[0,0,0],up:[0,0,1],fit:false,fov:90}`;
  const paths = render(`paths3d([[[-1,0,0],[1,0,0]]])`, view);
  expect(paths[0][0].nx).toBeCloseTo(-1/6, 6);
  expect(paths[0].at(-1).nx).toBeCloseTo(1/6, 6);
  expect(render(`paths3d([[[-1,0,0],[1,0,0]]])`, view.replace('fov:90', 'far:5'))).toEqual([]);
  expect(render(`paths3d([[[-1,0,0],[1,0,0]]])`, view.replace('fov:90', 'near:7'))).toEqual([]);
  expect(() => render(`solid.cube()`, `{near:2,far:1}`)).toThrow(/far/);
});

test('degenerate camera bases report actionable range errors', () => {
  const cases = [
    ['{position:[1,2,3],target:[1,2,3]}', /change the camera position/],
    ['{position:[0,0,6],up:[0,0,1]}', /change the camera position or up vector/],
    ['{position:[0,0,-6],up:[0,0,2]}', /change the camera position or up vector/],
    ['{position:[2,2,2],up:[1,1,1]}', /parallel/],
    ['{elevation:90}', /parallel/],
    ['{up:[0,0,0]}', /change the up vector/],
  ];
  for (const [view, message] of cases) {
    expect(() => render('solid.cube()', view)).toThrow(RangeError);
    expect(() => render('solid.cube()', view)).toThrow(message);
  }
  checkPaths(render('solid.cube()', '{position:[0,0,6],up:[0,1,0]}'));
  checkPaths(render('solid.cube()', '{position:[2,2,2],up:[0,0,2]}'));
});

test('camera angles reject non-finite values before constructing the basis', () => {
  for (const angle of ['azimuth', 'elevation']) {
    for (const value of ['NaN', 'Infinity', '-Infinity']) {
      for (const position of ['', 'position:[4,-6,4],']) {
        const view = `{${position}${angle}:${value}}`;
        expect(() => render('solid.cube()', view)).toThrow(RangeError);
        expect(() => render('solid.cube()', view)).toThrow(/azimuth and elevation must be finite/);
      }
    }
  }
  checkPaths(render('solid.cube()', '{azimuth:0,elevation:0}'));
});

test('scene index prunes thousands of unrelated objects and supports empty scenes', () => {
  const items = Array.from({length:10000}, (_,i) => ({
    bounds:{min:[i*3,-1,-1],max:[i*3+1,1,1]}, id:i,
  }));
  const index = createSceneIndex(items);
  let candidates = 0;
  expect(index([0.5,-3,0],[0,6,0], () => {candidates++; return false;})).toBe(false);
  expect(candidates).toBe(1);
  expect(createSceneIndex([])([0,0,0],[1,0,0],()=>true)).toBe(false);
  const prelude = `const blocks = []; for(let x=0;x<25;x++) for(let y=0;y<25;y++)
    blocks.push(solid.cube({draw:'edges'}).scale(0.04).translate((x-12)*0.1,(y-12)*0.1,0));`;
  checkPaths(render('...blocks', camera, prelude));
});

test('resource limits and seeded randomness are explicit and deterministic', () => {
  expect(() => render(`...Array.from({length:12001},()=>solid.cube())`)).toThrow(/12000|12,000/);
  expect(() => render(`paths3d([[[0,0,0],[1,NaN,0]]])`)).toThrow(/finite/);
  const source = `const rng=random(42);return polyline([[rng(),rng()],[rng(),rng()]]);`;
  expect(generate({code:source})).toEqual(generate({code:source}));
});

for (const example of codeArtExamples) {
  test(`example ${example.id} generates finite, bounded paths`, () => {
    const paths = generate({ code: example.code });
    checkPaths(paths);
    expect(paths.length).toBeLessThanOrEqual(20000);
    expect(paths.flat().length).toBeLessThanOrEqual(500000);
    const bound = example.dimension === 2 ? 1 : 0.92001;
    expect(paths.every(path => path.every(p => Math.abs(p.nx) <= bound && Math.abs(p.ny) <= bound))).toBe(true);
  });
}
