const CAMERA = `{
  position: [4.5, -6, 4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 45
}`;

const OCTAHEDRON = `const model = mesh.from({
  vertices: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1.4],[0,0,-1]],
  faces: [[0,2,4],[2,1,4],[1,3,4],[3,0,4],
          [2,0,5],[1,2,5],[3,1,5],[0,3,5]],
}).fit();`;

export const codeArtExamples = [
  {
    id: 'droplet-ripples',
    label: 'Droplet ripples',
    code: `const water = solid.heightfield({
  x: [-2, 2],
  y: [-2, 2],
  lines: 90,
  samples: 200,
  style: 'parallel', // Change to 'grid' for crossed lines.
  height(x, y) {
    const r = Math.hypot(x, y);
    const ripples = 0.24 * Math.cos(11 * r) * Math.exp(-0.9 * r);
    const droplet = 0.7 * Math.exp(-30 * r * r);
    return ripples + droplet;
  },
});

return scene().add(water).render({
  position: [3, -6, 3],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 45,
});`,
  },
  {
    id: 'edge-city',
    label: 'Edge city',
    code: `const rng = random(42);
const blocks = [];
for (let x = -6; x <= 6; x++) {
  for (let y = -6; y <= 6; y++) {
    const height = 0.12 + rng() * 0.6;
    blocks.push(solid.cube().draw('edges')
      .scale(0.065, 0.065, height)
      .translate(x * 0.18, y * 0.18, height));
  }
}
return scene().add(...blocks).render({
  position: [3, -4, 4], target: [0, 0, 0.3], up: [0, 0, 1],
});`,
  },
  {
    id: 'bead-strands',
    label: 'Bead strands',
    code: `const beads = [];
for (let strand = 0; strand < 8; strand++) {
  for (let i = 0; i < 32; i++) {
    const t = i / 31;
    const angle = t * Math.PI * 3 + strand * Math.PI / 4;
    const radius = 0.55 + 0.15 * Math.sin(t * Math.PI);
    beads.push(solid.sphere().draw('silhouette').scale(0.045)
      .translate(radius * Math.cos(angle), radius * Math.sin(angle), t * 2 - 1));
  }
}
return scene().add(...beads).render(${CAMERA});`,
  },
  {
    id: 'spatial-graph',
    label: 'Spatial graph',
    code: `const nodes = [[0,0,1.2],[0,0,-1.2],[1,0,0],[0,1,0],[-1,0,0],[0,-1,0]];
const shapes = nodes.map(p => solid.sphere().draw('silhouette').scale(0.14).translate(p));
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    if (Math.hypot(...nodes[i].map((v,k) => v - nodes[j][k])) < 1.8) {
      shapes.push(solid.cylinderBetween(nodes[i], nodes[j], {
        radius: 0.035, draw: 'silhouette',
      }));
    }
  }
}
return scene().add(...shapes).render(${CAMERA});`,
  },
  {
    id: 'cone-grove',
    label: 'Cone grove',
    code: `const rng = random(10);
const trees = [];
const branches = [];
for (let i = 0; i < 36; i++) {
  const x = (i % 6 - 2.5) * 0.4;
  const y = (Math.floor(i / 6) - 2.5) * 0.4;
  const height = 0.6 + rng() * 0.7;
  trees.push(solid.coneBetween([x,y,0], [x,y,height], {
    radius: 0.15, draw: 'silhouette',
  }));
  for (let j = 0; j < 8; j++) {
    const z = height * (0.25 + j * 0.08);
    const angle = j * 2.4;
    const r = (1 - z / height) * 0.22;
    branches.push([[x,y,z], [x+r*Math.cos(angle),y+r*Math.sin(angle),z-0.1]]);
  }
}
return scene().add(...trees, paths3d(branches)).render(${CAMERA});`,
  },
  {
    id: 'globe-lines',
    label: 'Globe lines',
    code: `const lines = [];
for (let lat = -75; lat <= 75; lat += 15) {
  lines.push(Array.from({length:181}, (_,i) => latLng(lat, i * 2)));
}
for (let lng = 0; lng < 360; lng += 20) {
  lines.push(Array.from({length:181}, (_,i) => latLng(i - 90, lng)));
}
// Replace lines with coastline coordinates converted using latLng(lat, lng).
const globe = solid.sphere().withPaths(lines).rotate(15, 0, 20);
return scene().add(globe).render(${CAMERA});`,
  },
  {
    id: 'mesh-study',
    label: 'Mesh study',
    code: `${OCTAHEDRON}
// Or upload a local asset: mesh.obj(assets['model.obj']).fit()
// STL: mesh.stl(assets['model.stl']).fit()
return scene().add(model.rotate(0, 0, 15)).render(${CAMERA});`,
  },
  {
    id: 'mesh-slices',
    label: 'Mesh slices',
    code: `${OCTAHEDRON}
// slices() draws cross-sections while the original mesh still hides rear lines.
return scene().add(model.slices({ axis: 'z', count: 35 }))
  .render(${CAMERA});`,
  },
  {
    id: 'mesh-voxels',
    label: 'Mesh voxels',
    code: `${OCTAHEDRON}
const blocks = model.voxelize({ size: 0.18, maxVoxels: 2000 });
return scene().add(...blocks).render(${CAMERA});`,
  },
  {
    id: 'boolean-sculpture',
    label: 'Boolean sculpture',
    code: `const body = solid.intersection(
  solid.sphere({detail: 8}),
  solid.cube({detail: 8}).scale(0.8)
);
const sculpture = solid.difference(
  body,
  solid.cylinder({detail: 8}).scale(0.5, 0.5, 2),
  solid.cylinder({detail: 8}).scale(0.5, 0.5, 2).rotate(90, 0, 0),
  solid.cylinder({detail: 8}).scale(0.5, 0.5, 2).rotate(0, 90, 0)
);
return scene().add(sculpture).render(${CAMERA});`,
  },
  {
    id: 'bounded-function',
    label: 'Bounded function',
    code: `const surface = solid.function({
  x: [-2, 2], y: [-2, 2], z: [-4, 1],
  lines: 65, samples: 80, style: 'grid', side: 'below',
  height: (x, y) => -1 / (x * x + y * y),
});
return scene().add(surface).render({
  position: [4, -6, 4], target: [0, 0, -1], up: [0, 0, 1],
});`,
  },
  {
    id: 'cube-study',
    label: 'Cube study',
    code: `const object = solid.cube({ detail: 12 })
  .rotate(12, 18, 8);

return scene().add(object).render(${CAMERA});`,
  },
  {
    id: 'sphere-study',
    label: 'Sphere study',
    code: `const object = solid.sphere({ detail: 12 })
  .rotate(15, 0, 20);

return scene().add(object).render(${CAMERA});`,
  },
  {
    id: 'orbital-sculpture',
    label: 'Orbital sculpture',
    code: `const forms = [
  solid.sphere({ detail: 8 }).scale(0.65).translate(-0.9, 0, 0),
  solid.torus({ detail: 8 }).rotate(65, 0, 0).translate(0.8, 0, 0.15),
  solid.cylinder({ detail: 7 }).scale(0.28, 0.28, 0.8).rotate(0, 25, 0).translate(0, 0.8, 0),
];

return scene().add(...forms).render(${CAMERA});`,
  },
  {
    id: 'reaction-diffusion',
    label: 'Reaction-Diffusion',
    dimension: 2,
    code: `const preset = 'maze';
const presets = {
  spots: { feed: 0.035, kill: 0.065 },
  maze: { feed: 0.029, kill: 0.057 },
  fingerprints: { feed: 0.037, kill: 0.060 },
  coral: { feed: 0.062, kill: 0.0609 },
};
const { feed, kill } = presets[preset];
const size = 80;
const iterations = 2500;
const threshold = 0.2;
const rng = random(42);
const diffusionA = 1;
const diffusionB = 0.5;
const dt = 1;

let a = new Float32Array(size * size).fill(1);
let b = new Float32Array(size * size);
let nextA = new Float32Array(size * size);
let nextB = new Float32Array(size * size);
const seeds = Math.max(6, Math.round(size * size * 0.015));
for (let seed = 0; seed < seeds; seed++) {
  const cx = 1 + Math.floor(rng() * (size - 2));
  const cy = 1 + Math.floor(rng() * (size - 2));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const index = (cy + dy) * size + cx + dx;
      a[index] = 0.5;
      b[index] = 0.25;
    }
  }
}

for (let iteration = 0; iteration < iterations; iteration++) {
  for (let y = 0; y < size; y++) {
    const below = (y - 1 + size) % size;
    const above = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const i = y * size + x;
      const lapA = a[below*size+x] + a[above*size+x]
        + a[y*size+left] + a[y*size+right] - 4*a[i];
      const lapB = b[below*size+x] + b[above*size+x]
        + b[y*size+left] + b[y*size+right] - 4*b[i];
      const reaction = a[i] * b[i] * b[i];
      nextA[i] = Math.max(0, Math.min(1, a[i]
        + dt * (diffusionA * lapA - reaction + feed * (1 - a[i]))));
      nextB[i] = Math.max(0, Math.min(1, b[i]
        + dt * (diffusionB * lapB + reaction - (feed + kill) * b[i])));
    }
  }
  [a, nextA] = [nextA, a];
  [b, nextB] = [nextB, b];
}
return contours(b, size, threshold);`,
  },
  {
    id: 'cyclic-ca',
    label: 'Cyclic CA',
    dimension: 2,
    code: `const states = 10;
const threshold = 1;
const size = 140;
const iterations = 180;
const rng = random(7);
let grid = new Uint8Array(size * size);
let next = new Uint8Array(size * size);
for (let i = 0; i < grid.length; i++) {
  grid[i] = Math.floor(rng() * states);
}

for (let iteration = 0; iteration < iterations; iteration++) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const successor = (grid[i] + 1) % states;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const row = (y + dy + size) % size;
          const column = (x + dx + size) % size;
          if (grid[row * size + column] === successor) count++;
        }
      }
      next[i] = count >= threshold ? successor : grid[i];
    }
  }
  [grid, next] = [next, grid];
}

const paths = [];
const field = new Float32Array(size * size);
for (let state = 0; state < states; state++) {
  const successor = (state + 1) % states;
  for (let i = 0; i < grid.length; i++) {
    field[i] = grid[i] === successor ? 0 : 1;
  }
  paths.push(...contours(field, size, 0.5));
}
return paths;`,
  },
  {
    id: 'strange-attractors',
    label: 'Strange Attractors',
    dimension: 2,
    code: `const preset = 'clifford';
const presets = {
  clifford: [-1.4, 1.6, 1, 0.7],
  dejong: [1.4, -2.3, 2.4, -2.1],
  lorenz: [10, 28, 2.667, 0],
  rossler: [0.2, 0.2, 5.7, 0],
  halvorsen: [1.4, 0, 0, 0],
};
const [a, b, c, d] = presets[preset];
const steps = 80000;
const transient = 1000;
const points = [];
let x = 0.1, y = 0, z = 0;

function derivative([x, y, z]) {
  switch (preset) {
    case 'lorenz': return [a*(y-x), x*(b-z)-y, x*y-c*z];
    case 'rossler': return [-y-z, x+a*y, b+z*(x-c)];
    case 'halvorsen': return [
      -a*x-4*y-4*z-y*y,
      -a*y-4*z-4*x-z*z,
      -a*z-4*x-4*y-x*x,
    ];
    default: throw new Error('Unknown differential-equation preset: ' + preset);
  }
}

const discrete = preset === 'clifford' || preset === 'dejong';
const dt = preset === 'rossler' ? 0.05 : 0.005;
if (discrete) x = 0;
for (let i = 0; i < steps + transient; i++) {
  if (discrete) {
    const nextX = preset === 'clifford'
      ? Math.sin(a*y) + c*Math.cos(a*x)
      : Math.sin(a*y) - Math.cos(b*x);
    const nextY = preset === 'clifford'
      ? Math.sin(b*x) + d*Math.cos(b*y)
      : Math.sin(c*x) - Math.cos(d*y);
    x = nextX;
    y = nextY;
  } else {
    const position = [x, y, z];
    const advance = (velocity, amount) =>
      position.map((value, axis) => value + velocity[axis] * amount);
    const k1 = derivative(position);
    const k2 = derivative(advance(k1, dt / 2));
    const k3 = derivative(advance(k2, dt / 2));
    const k4 = derivative(advance(k3, dt));
    [x, y, z] = position.map((value, axis) =>
      value + dt * (k1[axis] + 2*k2[axis] + 2*k3[axis] + k4[axis]) / 6);
  }
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error('Attractor diverged; reduce dt or restore preset coefficients');
  }
  if (i >= transient) points.push([x, preset === 'lorenz' ? z : y]);
}

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const [px, py] of points) {
  minX = Math.min(minX, px); maxX = Math.max(maxX, px);
  minY = Math.min(minY, py); maxY = Math.max(maxY, py);
}
const scale = 2 * 0.95 / Math.max(maxX - minX, maxY - minY, 1e-12);
const centreX = (minX + maxX) / 2;
const centreY = (minY + maxY) / 2;
const normalized = points.map(([px, py]) =>
  [(px - centreX) * scale, (py - centreY) * scale]);
const paths = [];
const chunk = steps > 50000 ? 2000 : normalized.length;
for (let i = 0; i < normalized.length; i += chunk) {
  paths.push(...polyline(normalized.slice(i, i + chunk)));
}
return paths;`,
  },
  {
    id: 'helix-tower',
    label: 'Helix tower',
    code: `const blocks = [];
const levels = 12;

for (let i = 0; i < levels; i++) {
  const angle = i * Math.PI * 2 / 5;
  const height = (i - (levels - 1) / 2) * 0.17;
  blocks.push(
    solid.cube({ detail: 4 })
      .scale(0.28, 0.22, 0.12)
      .rotate(0, 0, i * 24)
      .translate(Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, height)
  );
}

return scene().add(...blocks).render(${CAMERA});`,
  },
  {
    id: 'courtyard',
    label: 'Courtyard',
    code: `const blocks = [];
const positions = [
  [-0.65, -0.55, 0.25], [0, -0.55, 0.4], [0.65, -0.55, 0.3],
  [-0.65, 0.55, 0.45],  [0, 0.55, 0.25],  [0.65, 0.55, 0.5],
];

for (let i = 0; i < positions.length; i++) {
  const [x, y, height] = positions[i];
  blocks.push(
    solid.cube({ detail: 5 })
      .scale(0.24, 0.24, height)
      .rotate(0, 0, (i % 2) * 12)
      .translate(x, y, height - 0.35)
  );
}

return scene().add(...blocks).render(${CAMERA});`,
  },
];
