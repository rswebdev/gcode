/**
 * Voronoi Cells — Example GenArt plugin for the G-code pen plotter app.
 *
 * Inspired by Daniel Shiffman's (The Coding Train) cell-fill technique:
 *   https://thecodingtrain.com/challenges/181-weighted-voronoi-stippling
 *
 * Seeds are placed with stratified jitter for even initial coverage, then
 * Lloyd relaxation iteratively moves each seed to its cell's centroid,
 * producing the characteristic organic "foam cell" look.
 *
 * HOW TO USE
 * ----------
 * 1. In the Generative Art tab, open the "Plugins ▸" panel.
 * 2. Paste this file's contents into the text area (or load the file).
 * 3. Click Install.
 * 4. Select "Voronoi Cells" from the algorithm dropdown.
 */

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Sutherland–Hodgman clip to half-plane closer to seed i than seed j ────────
function clipToHalfPlane(poly, ix, iy, jx, jy) {
  if (poly.length === 0) return [];
  const mx = (ix + jx) / 2, my = (iy + jy) / 2;
  const dx = jx - ix,       dy = jy - iy;

  const side  = p => dx * (p[0] - mx) + dy * (p[1] - my); // ≤ 0 → i-side
  const cross = (p1, p2) => {
    const d1 = side(p1), d2 = side(p2);
    const t  = d1 / (d1 - d2);
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  };

  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const cur  = poly[k];
    const prev = poly[(k + poly.length - 1) % poly.length];
    const inC  = side(cur)  <= 0;
    const inP  = side(prev) <= 0;
    if (inC) {
      if (!inP) out.push(cross(prev, cur));
      out.push(cur);
    } else if (inP) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

// ── Voronoi cells via convex clipping ─────────────────────────────────────────
function buildCells(seeds, x0, y0, x1, y1) {
  const bbox = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return seeds.map((s, i) => {
    let poly = [...bbox];
    for (let j = 0; j < seeds.length && poly.length > 0; j++) {
      if (i !== j) poly = clipToHalfPlane(poly, s[0], s[1], seeds[j][0], seeds[j][1]);
    }
    return poly;
  });
}

// ── Polygon centroid ──────────────────────────────────────────────────────────
function centroid(poly) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    area += c;
    cx   += (x1 + x2) * c;
    cy   += (y1 + y2) * c;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    // Degenerate — fall back to arithmetic mean
    return poly.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0])
               .map(v => v / poly.length);
  }
  return [cx / (6 * area), cy / (6 * area)];
}

// ── Plugin ────────────────────────────────────────────────────────────────────
export default {
  id:    'voronoi-cells',
  label: 'Voronoi Cells',

  params: [
    { id: 'count',  label: 'Cell count',       type: 'range',  min: 5,  max: 120, step: 5,    default: 40 },
    { id: 'relax',  label: 'Lloyd iterations', type: 'range',  min: 0,  max: 12,  step: 1,    default: 4  },
    { id: 'margin', label: 'Margin',           type: 'range',  min: 0,  max: 0.3, step: 0.01, default: 0.05 },
    { id: 'seed',   label: 'Random seed',      type: 'number', min: 0,  max: 99999, step: 1,  default: 42 },
  ],

  generate(p) {
    const count  = Math.max(3,   Math.min(120,  p.count  | 0));
    const relax  = Math.max(0,   Math.min(12,   p.relax  | 0));
    const margin = Math.max(0,   Math.min(0.3, +p.margin || 0.05));
    const rng    = mulberry32(p.seed | 0);

    const x0 = -(1 - margin), y0 = -(1 - margin);
    const x1 =  (1 - margin), y1 =  (1 - margin);

    // Stratified jitter — better spatial coverage than pure random
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    let seeds = [];
    for (let row = 0; row < rows && seeds.length < count; row++) {
      for (let col = 0; col < cols && seeds.length < count; col++) {
        const u = (col + rng()) / cols;
        const v = (row + rng()) / rows;
        seeds.push([x0 + u * (x1 - x0), y0 + v * (y1 - y0)]);
      }
    }

    // Lloyd relaxation: move each seed to its cell centroid
    for (let i = 0; i < relax; i++) {
      const cells = buildCells(seeds, x0, y0, x1, y1);
      seeds = cells.map((poly, idx) =>
        poly.length >= 3 ? centroid(poly) : seeds[idx]
      );
    }

    // Final cells → closed NDC polylines
    const cells = buildCells(seeds, x0, y0, x1, y1);
    return cells
      .filter(poly => poly.length >= 3)
      .map(poly => {
        const pts = poly.map(([x, y]) => ({ nx: x, ny: y }));
        pts.push(pts[0]); // close polygon
        return pts;
      });
  },
};
