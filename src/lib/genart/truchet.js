/**
 * genart/truchet.js
 * Truchet tile tiling. Each tile randomly picks one of two orientations;
 * together the tiles form flowing curved or angular patterns.
 *
 * Three tile styles:
 *   arcs     — quarter-circle arcs connecting midpoints of adjacent edges
 *   diagonal — straight diagonal lines across each tile
 *   mix      — randomly chooses arcs or diagonal per tile
 */

export const id    = 'truchet';
export const label = 'Truchet Tiles';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  { id: 'seed',  label: 'Seed',   type: 'number', min: 0, max: 99999, step: 1, default: 7 },
  { id: 'cols',  label: 'Cols',   type: 'range',  min: 4, max: 40, step: 1, default: 14 },
  { id: 'rows',  label: 'Rows',   type: 'range',  min: 4, max: 40, step: 1, default: 14 },
  {
    id: 'style', label: 'Style', type: 'select', default: 'arcs',
    options: [
      { value: 'arcs',     label: 'Arcs'     },
      { value: 'diagonal', label: 'Diagonal' },
      { value: 'mix',      label: 'Mix'      },
    ],
  },
  { id: 'arcRes', label: 'Arc Res', type: 'range', min: 4, max: 24, step: 1, default: 12 },
];

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function _makePrng(seed) {
  let s = ((seed | 0) * 1664901 + 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// ---------------------------------------------------------------------------
// Arc helper: quarter-circle with specified centre, radius, start/end angle
// ---------------------------------------------------------------------------

function _arc(cx, cy, r, a0, a1, res) {
  const pts = [];
  for (let i = 0; i <= res; i++) {
    const t = a0 + (a1 - a0) * (i / res);
    pts.push({ nx: cx + Math.cos(t) * r, ny: cy + Math.sin(t) * r });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const seed   = p.seed | 0;
  const cols   = Math.max(1, p.cols | 0);
  const rows   = Math.max(1, p.rows | 0);
  const style  = p.style || 'arcs';
  const arcRes = Math.max(2, p.arcRes | 0);

  const rng  = _makePrng(seed);

  // Tile size in NDC (full canvas is 2×2, from -1 to +1)
  const tw = 2 / cols;
  const th = 2 / rows;
  const r  = 0.5; // arc radius relative to tile half-size (1 = midpoint-to-midpoint)

  const paths = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Tile top-left corner in NDC
      const tlx = -1 + col * tw;
      const tly = -1 + row * th;
      // Midpoints of the four edges
      const mid = {
        l: { x: tlx,          y: tly + th / 2 },
        r: { x: tlx + tw,     y: tly + th / 2 },
        t: { x: tlx + tw / 2, y: tly          },
        b: { x: tlx + tw / 2, y: tly + th     },
      };

      const orientation = rng() < 0.5 ? 0 : 1;

      let tileStyle = style;
      if (style === 'mix') tileStyle = rng() < 0.5 ? 'arcs' : 'diagonal';

      if (tileStyle === 'arcs') {
        // Orientation 0: arcs from left→top  and right→bottom
        // Orientation 1: arcs from left→bottom and right→top
        const rNdc = (tw / 2) * r;

        if (orientation === 0) {
          // Arc: left midpoint → top midpoint  (centre at top-left corner)
          paths.push(_arc(tlx,      tly,      rNdc, 0,          Math.PI / 2, arcRes));
          // Arc: right midpoint → bottom midpoint (centre at bottom-right corner)
          paths.push(_arc(tlx + tw, tly + th, rNdc, Math.PI,    3 * Math.PI / 2, arcRes));
        } else {
          // Arc: left midpoint → bottom midpoint (centre at bottom-left corner)
          paths.push(_arc(tlx,      tly + th, rNdc, -Math.PI / 2, 0,           arcRes));
          // Arc: right midpoint → top midpoint   (centre at top-right corner)
          paths.push(_arc(tlx + tw, tly,      rNdc, Math.PI / 2,  Math.PI,     arcRes));
        }
      } else {
        // Diagonal style
        if (orientation === 0) {
          // Left→Top and Right→Bottom
          paths.push([mid.l, mid.t]);
          paths.push([mid.r, mid.b]);
        } else {
          // Left→Bottom and Right→Top
          paths.push([mid.l, mid.b]);
          paths.push([mid.r, mid.t]);
        }
      }
    }
  }

  return paths.filter(path => path.length >= 2);
}
