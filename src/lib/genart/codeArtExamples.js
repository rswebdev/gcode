const CAMERA = `{
  position: [4.5, -6, 4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 45
}`;

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
