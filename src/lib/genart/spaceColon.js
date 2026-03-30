/**
 * genart/spaceColon.js
 * Space colonization — organic tree-branching algorithm.
 *
 * Scatter random "nutrient" attractor points, then grow a tree from
 * a root by repeatedly extending branches toward nearby attractors.
 * Attractors are consumed when a node grows close enough.
 *
 * Produces vascular / mycelial / river-delta branching structures.
 */

export const id    = 'spacecolon';
export const label = 'Space Colonization';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'attractors', label: 'Attractors',  type: 'range',  min: 100, max: 2000, step: 50,    default: 600   },
  { id: 'steps',      label: 'Steps',        type: 'range',  min: 20,  max: 400,  step: 10,    default: 150   },
  { id: 'segLen',     label: 'Seg Length',   type: 'range',  min: 0.01, max: 0.1,  step: 0.005, default: 0.025 },
  { id: 'influence',  label: 'Influence R',  type: 'range',  min: 0.05, max: 0.6,  step: 0.02,  default: 0.2   },
  { id: 'kill',       label: 'Kill Radius',  type: 'range',  min: 0.01, max: 0.12, step: 0.005, default: 0.03  },
  {
    id: 'shape', label: 'Seed Shape', type: 'select', default: 'base',
    options: [
      { value: 'base',   label: 'Root (base)'   },
      { value: 'center', label: 'Root (centre)'  },
      { value: 'multi',  label: '3-Root spread'  },
    ],
  },
  { id: 'seed', label: 'Seed', type: 'number', min: 0, max: 99999, default: 42 },
];

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const nAttr    = Math.max(10, p.attractors | 0);
  const steps    = Math.max(1, p.steps | 0);
  const segLen   = +p.segLen   || 0.025;
  const influence= +p.influence|| 0.2;
  const kill     = +p.kill     || 0.03;
  const shape    = p.shape || 'base';
  const rng      = _makePrng(p.seed | 0);

  const influence2 = influence * influence;
  const kill2      = kill * kill;

  // ---- Scatter attractor points ----
  // Distribute in a filled circle of radius 0.9
  const attrs = [];   // { x, y, alive }
  while (attrs.length < nAttr) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    if (x * x + y * y < 0.81) attrs.push({ x, y, alive: true });
  }

  // ---- Place root nodes ----
  // node: { x, y, parent: index|-1 }
  const nodes = [];
  if (shape === 'base') {
    nodes.push({ x: 0, y: -0.85, parent: -1 });
    // Remove attractors near the ground
    for (const a of attrs) if (a.y < -0.6) a.alive = false;
  } else if (shape === 'center') {
    nodes.push({ x: 0, y: 0, parent: -1 });
  } else {
    // 3 roots spread around
    for (const ang of [-0.6, 0, 0.6]) {
      nodes.push({ x: Math.sin(ang) * 0.3, y: -0.85, parent: -1 });
    }
  }

  // ---- Grow ----
  for (let step = 0; step < steps; step++) {
    // For each alive attractor, find the nearest node within influence
    const nodeDir = new Float32Array(nodes.length * 2); // accumulated direction
    const nodeHit = new Uint8Array(nodes.length);

    for (const a of attrs) {
      if (!a.alive) continue;
      let bestDist2 = influence2;
      let bestNode  = -1;
      for (let ni = 0; ni < nodes.length; ni++) {
        const dx = a.x - nodes[ni].x;
        const dy = a.y - nodes[ni].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) { bestDist2 = d2; bestNode = ni; }
      }
      if (bestNode < 0) continue;
      const d = Math.sqrt(bestDist2) || 1e-9;
      nodeDir[bestNode * 2]     += (a.x - nodes[bestNode].x) / d;
      nodeDir[bestNode * 2 + 1] += (a.y - nodes[bestNode].y) / d;
      nodeHit[bestNode] = 1;
    }

    // Grow new nodes from leaves that were influenced
    const newNodes = [];
    for (let ni = 0; ni < nodes.length; ni++) {
      if (!nodeHit[ni]) continue;
      const dx = nodeDir[ni * 2];
      const dy = nodeDir[ni * 2 + 1];
      const d  = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      const nx = nodes[ni].x + (dx / d) * segLen;
      const ny = nodes[ni].y + (dy / d) * segLen;
      if (Math.abs(nx) <= 1.0 && Math.abs(ny) <= 1.0) {
        newNodes.push({ x: nx, y: ny, parent: ni });
      }
    }

    if (newNodes.length === 0) break;
    for (const n of newNodes) nodes.push(n);

    // Kill attractors consumed by any node
    for (const a of attrs) {
      if (!a.alive) continue;
      for (let ni = 0; ni < nodes.length; ni++) {
        const dx = a.x - nodes[ni].x;
        const dy = a.y - nodes[ni].y;
        if (dx * dx + dy * dy < kill2) { a.alive = false; break; }
      }
    }
  }

  // ---- Build paths: each node draws a segment to its parent ----
  const paths = [];
  for (let ni = 1; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.parent < 0) continue;
    const par = nodes[n.parent];
    paths.push([
      { nx: par.x, ny: par.y },
      { nx: n.x,   ny: n.y   },
    ]);
  }
  return paths;
}
