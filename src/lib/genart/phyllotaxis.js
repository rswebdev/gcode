/**
 * genart/phyllotaxis.js
 * Golden-angle spiral packing — the same geometry found in sunflowers,
 * pine cones, and seed heads.
 *
 * Each successive point is placed at radius √i and angle i × 137.508°
 * (the golden angle = 2π / φ², φ = golden ratio).
 *
 * Three rendering styles:
 *   spiral      — points connected in order → a single tight inward spiral
 *   parastichies — Fibonacci-spaced connections reveal the interlocking arcs
 *   rays         — each point connected to centre → starburst
 */

export const id    = 'phyllotaxis';
export const label = 'Phyllotaxis';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'n',    label: 'Count',    type: 'range',  min: 100, max: 2000, step: 50,    default: 800   },
  { id: 'c',    label: 'Spacing',  type: 'range',  min: 0.01, max: 0.09, step: 0.002, default: 0.046 },
  {
    id: 'style', label: 'Style', type: 'select', default: 'parastichies',
    options: [
      { value: 'spiral',        label: 'Spiral'        },
      { value: 'parastichies',  label: 'Parastichies'  },
      { value: 'rays',          label: 'Rays'          },
    ],
  },
];

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.3999 rad = 137.508°

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const N     = Math.max(10, p.n | 0);
  const c     = +p.c || 0.046;
  const style = p.style || 'parastichies';

  // Generate all point positions in NDC
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    const r     = c * Math.sqrt(i);
    const theta = i * GOLDEN_ANGLE;
    pts[i] = { nx: r * Math.cos(theta), ny: r * Math.sin(theta) };
  }

  const paths = [];

  if (style === 'spiral') {
    // Single continuous spiral path in order
    paths.push(pts);
  } else if (style === 'parastichies') {
    // Connect each point i to i+f for each Fibonacci number f.
    // Use only the three most visually prominent families.
    const families = [8, 13, 21].filter(f => f < N);
    for (const f of families) {
      for (let i = 0; i + f < N; i++) {
        paths.push([pts[i], pts[i + f]]);
      }
    }
  } else if (style === 'rays') {
    const centre = { nx: 0, ny: 0 };
    for (let i = 0; i < N; i++) {
      paths.push([centre, pts[i]]);
    }
  }

  return paths.filter(path => path.length >= 2);
}
