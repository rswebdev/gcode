/**
 * lib/imageTrace.js
 *
 * Converts a raster image to vector paths using the Marching Squares algorithm.
 * Returns paths in NDC (normalized device coordinates, -1..+1) suitable for
 * use with the G-code pipeline.
 */

const TOP    = 0;
const RIGHT  = 1;
const BOTTOM = 2;
const LEFT   = 3;

/**
 * For each of the 16 marching-squares cases, the list of [edgeA, edgeB] pairs
 * that form contour segment(s) through the 2×2 cell.
 *
 * Cell corner bits: bit3=TL, bit2=TR, bit1=BR, bit0=BL (foreground = 1).
 * Edge midpoints:  TOP=between TL&TR, RIGHT=between TR&BR,
 *                  BOTTOM=between BL&BR, LEFT=between TL&BL.
 *
 * Saddle cases (5 & 10) are disambiguated by treating each isolated foreground
 * corner as its own separate arc.
 */
const CELL_SEGS = [
  [],                               //  0: 0000 – nothing
  [[LEFT,   BOTTOM]],               //  1: 0001 – BL
  [[BOTTOM, RIGHT]],                //  2: 0010 – BR
  [[LEFT,   RIGHT]],                //  3: 0011 – BL+BR
  [[TOP,    RIGHT]],                //  4: 0100 – TR
  [[TOP,    RIGHT], [LEFT, BOTTOM]],//  5: 0101 – TR+BL saddle
  [[TOP,    BOTTOM]],               //  6: 0110 – TR+BR
  [[TOP,    LEFT]],                 //  7: 0111 – !TL
  [[TOP,    LEFT]],                 //  8: 1000 – TL
  [[TOP,    BOTTOM]],               //  9: 1001 – TL+BL
  [[TOP,    LEFT], [BOTTOM, RIGHT]],// 10: 1010 – TL+BR saddle
  [[TOP,    RIGHT]],                // 11: 1011 – !TR
  [[LEFT,   RIGHT]],                // 12: 1100 – TL+TR
  [[BOTTOM, RIGHT]],                // 13: 1101 – !BR
  [[LEFT,   BOTTOM]],               // 14: 1110 – !BL
  [],                               // 15: 1111 – nothing
];

// ---------------------------------------------------------------------------
// Step 1 – Binarise / Grayscale
// ---------------------------------------------------------------------------

/**
 * Returns raw luminance (0–255) for every pixel, with alpha premultiplied.
 * invert=true returns 255-luminance so bright pixels become "dark" in the map.
 */
function grayscale(imageData, invert) {
  const { width, height, data } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    let v = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255);
    gray[i] = Math.round(invert ? 255 - v : v);
  }
  return gray;
}

/**
 * Returns a binary Uint8Array where pixels whose (possibly inverted) luminance
 * falls in [lo, hi) are 1.  Used to isolate a single brightness band for
 * multi-level shading.
 */
function _bandBin(gray, lo, hi) {
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    bin[i] = gray[i] >= lo && gray[i] < hi ? 1 : 0;
  }
  return bin;
}

// ---------------------------------------------------------------------------
// Step 2 – Marching squares → adjacency graph
// ---------------------------------------------------------------------------

/**
 * Returns the "doubled-integer" coordinate of an edge midpoint.
 *
 * Doubling lets us store midpoints as exact integers: e.g. the midpoint of
 * the top edge of cell (cx, cy) lies at real pixel (cx+0.5, cy), which
 * becomes integer (2*cx+1, 2*cy) in doubled space.
 */
function edgeMidpoint(cx, cy, edge) {
  switch (edge) {
    case TOP:    return [2 * cx + 1, 2 * cy];
    case RIGHT:  return [2 * cx + 2, 2 * cy + 1];
    case BOTTOM: return [2 * cx + 1, 2 * cy + 2];
    case LEFT:   return [2 * cx,     2 * cy + 1];
  }
}

/**
 * Runs marching squares over the binary image and builds an undirected
 * adjacency graph of contour segment endpoints.
 *
 * Node keys are strings "x2,y2" where x2/y2 are doubled-integer coordinates.
 *
 * @returns {Map<string, string[]>}
 */
function buildAdjacency(bin, width, height) {
  const adj = new Map();

  function addEdge(ax2, ay2, bx2, by2) {
    const ka = `${ax2},${ay2}`;
    const kb = `${bx2},${by2}`;
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push(kb);
    adj.get(kb).push(ka);
  }

  for (let cy = 0; cy < height - 1; cy++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const tl = bin[cy       * width + cx];
      const tr = bin[cy       * width + cx + 1];
      const br = bin[(cy + 1) * width + cx + 1];
      const bl = bin[(cy + 1) * width + cx];
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl;
      for (const [ea, eb] of CELL_SEGS[idx]) {
        const pa = edgeMidpoint(cx, cy, ea);
        const pb = edgeMidpoint(cx, cy, eb);
        addEdge(pa[0], pa[1], pb[0], pb[1]);
      }
    }
  }

  return adj;
}

// ---------------------------------------------------------------------------
// Step 3 – Trace paths through the adjacency graph
// ---------------------------------------------------------------------------

/**
 * Extracts polylines from the adjacency graph by greedy path following.
 *
 * Open arcs (degree-1 endpoints) are started first for cleaner output.
 * Closed loops are detected and the first point is appended at the end.
 *
 * @returns {Array<Array<[number, number]>>}  Arrays of [x2, y2] pairs.
 */
function tracePaths(adj) {
  const visited = new Set();
  const paths   = [];

  // Classify start candidates: degree-1 endpoints before interior nodes.
  const endpoints = [];
  const interior  = [];
  for (const [key, neighbors] of adj) {
    (neighbors.length === 1 ? endpoints : interior).push(key);
  }

  for (const startKey of [...endpoints, ...interior]) {
    if (visited.has(startKey)) continue;

    const path = [];
    let current = startKey;

    while (current && !visited.has(current)) {
      visited.add(current);
      const [x2, y2] = current.split(',').map(Number);
      path.push([x2, y2]);

      const neighbors = adj.get(current) ?? [];
      let next = null;
      for (const nb of neighbors) {
        if (!visited.has(nb)) { next = nb; break; }
      }
      current = next;
    }

    if (path.length < 2) continue;

    // Close loops: if the last node is adjacent to the start, append start.
    if (path.length >= 3) {
      const lastKey = `${path[path.length - 1][0]},${path[path.length - 1][1]}`;
      if ((adj.get(lastKey) ?? []).includes(startKey)) {
        path.push([...path[0]]);
      }
    }

    paths.push(path);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Step 4 – Ramer–Douglas–Peucker simplification
// ---------------------------------------------------------------------------

/**
 * Simplifies a polyline using the Ramer–Douglas–Peucker algorithm.
 * @param {Array<[number,number]>} pts
 * @param {number} eps – maximum perpendicular deviation to retain a point
 */
function rdp(pts, eps) {
  if (pts.length <= 2) return pts;

  const [x1, y1] = pts[0];
  const [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);

  let maxDist = 0;
  let maxIdx  = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const dist = len > 0
      ? Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len
      : Math.hypot(px - x1, py - y1);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist <= eps) return [pts[0], pts[pts.length - 1]];
  return [
    ...rdp(pts.slice(0, maxIdx + 1), eps),
    ...rdp(pts.slice(maxIdx), eps).slice(1),
  ];
}

// ---------------------------------------------------------------------------
// Step 5 – Catmull-Rom spline densification
// ---------------------------------------------------------------------------

/**
 * Densifies a polyline by interpolating each segment with a Catmull-Rom
 * spline.  The spline passes through every original point, so the shape is
 * preserved while sharp corners become smooth curves.
 *
 * @param {Array<[number,number]>} pts
 * @param {number} steps – number of sub-samples per segment (≥ 2 to have effect)
 * @returns {Array<[number,number]>}
 */
function catmullRom(pts, steps) {
  if (steps < 2 || pts.length < 2) return pts;

  const n      = pts.length;
  const result = [];

  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];

    for (let s = 0; s < steps; s++) {
      const t  = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      result.push([
        0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
      ]);
    }
  }

  result.push(pts[n - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Fill strategies  (operate on real-pixel coordinates)
// ---------------------------------------------------------------------------

/**
 * Converts a real-pixel [x, y] point to NDC.
 * x ∈ [0, width]  → nx ∈ [-1, +1]
 * y ∈ [0, height] → ny ∈ [+1, -1]  (Y-up)
 */
function _toNdc(x, y, width, height) {
  return { nx: x / width * 2 - 1, ny: 1 - y / height * 2 };
}

/**
 * Horizontal scan-line fill: traces the interior of dark regions with
 * evenly-spaced horizontal strokes.
 */
function fillHorizontal(bin, width, height, spacing) {
  const paths = [];
  const step = Math.max(1, Math.round(spacing));
  for (let y = 0; y < height; y += step) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && bin[y * width + x];
      if (on && start < 0) { start = x; }
      else if (!on && start >= 0) {
        paths.push([[start, y + 0.5], [x, y + 0.5]]);
        start = -1;
      }
    }
  }
  return paths;
}

/**
 * Vertical scan-line fill.
 */
function fillVertical(bin, width, height, spacing) {
  const paths = [];
  const step = Math.max(1, Math.round(spacing));
  for (let x = 0; x < width; x += step) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const on = y < height && bin[y * width + x];
      if (on && start < 0) { start = y; }
      else if (!on && start >= 0) {
        paths.push([[x + 0.5, start], [x + 0.5, y]]);
        start = -1;
      }
    }
  }
  return paths;
}

/**
 * Diagonal fill at 45°: traces strokes along lines where (x − y) = constant.
 * Perpendicular spacing = spacing / √2.
 */
function fillDiagonal(bin, width, height, spacing) {
  const paths = [];
  const step = Math.max(1, Math.round(spacing));
  // c = x - y; ranges from -(height-1) to (width-1)
  for (let c = -(height - 1); c < width; c += step) {
    const xMin = Math.max(0, c);
    const xMax = Math.min(width - 1, c + height - 1);
    let start = null;
    for (let x = xMin; x <= xMax + 1; x++) {
      const y = x - c;
      const on = x <= xMax && y >= 0 && y < height && bin[y * width + x];
      if (on && start === null) { start = [x, y]; }
      else if (!on && start !== null) {
        paths.push([start, [x, y]]);
        start = null;
      }
    }
  }
  return paths;
}

/**
 * Cross-hatch fill: horizontal + vertical strokes combined.
 */
function fillCrosshatch(bin, width, height, spacing) {
  return [
    ...fillHorizontal(bin, width, height, spacing),
    ...fillVertical(bin, width, height, spacing),
  ];
}

/**
 * Stipple fill: places small cross-shaped marks at sampled dark positions.
 * The mark radius scales with spacing so denser settings produce finer dots.
 */
function fillStipple(bin, width, height, spacing) {
  const paths = [];
  const step = Math.max(1, Math.round(spacing));
  const r    = Math.max(0.4, step * 0.18); // dot radius
  const half = Math.floor(step / 2);
  for (let y = half; y < height; y += step) {
    for (let x = half; x < width; x += step) {
      if (bin[y * width + x]) {
        paths.push([[x - r, y],     [x + r, y]]);      // horizontal arm
        paths.push([[x,     y - r], [x,     y + r]]); // vertical arm
      }
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SHADE_LABELS = [
  ['Shade'],
  ['Dark', 'Light'],
  ['Dark', 'Medium', 'Light'],
  ['Very Dark', 'Dark', 'Medium', 'Light'],
];

/**
 * Generates one set of fill paths for a specific brightness band.
 * @param {string}    fill      Fill strategy name
 * @param {Uint8Array} bin      Binary mask (1 = fill this pixel)
 * @param {number}    width
 * @param {number}    height
 * @param {number}    spacing   Pixel spacing between strokes
 * @returns {Array<Array<{nx,ny}>>}
 */
function _makeFillPaths(fill, bin, width, height, spacing) {
  let rawFill = [];
  if (fill === 'lines')           rawFill = fillHorizontal(bin, width, height, spacing);
  else if (fill === 'crosshatch') rawFill = fillCrosshatch(bin, width, height, spacing);
  else if (fill === 'diagonal')   rawFill = fillDiagonal(bin, width, height, spacing);
  else if (fill === 'stipple')    rawFill = fillStipple(bin, width, height, spacing);
  return rawFill
    .filter(seg => seg.length >= 2)
    .map(seg => seg.map(([x, y]) => _toNdc(x, y, width, height)));
}

/**
 * Traces contours in a raster image and returns structured path data.
 *
 * Coordinate conventions:
 *   - NDC x: -1 = left edge of image, +1 = right edge
 *   - NDC y: +1 = top edge of image,  -1 = bottom edge  (Y-up, matching plotter)
 *
 * @param {ImageData} imageData
 * @param {object}  [options]
 * @param {number}  [options.threshold=128]   Grayscale cut-off (0–255)
 * @param {boolean} [options.invert=false]    Treat light pixels as foreground
 * @param {number}  [options.simplify=4.0]    RDP tolerance in doubled pixels
 * @param {number}  [options.smooth=4]        Catmull-Rom subdivisions per segment
 *                                            (0 or 1 = disabled; 2–8 recommended)
 * @param {number}  [options.minPoints=3]     Discard contour paths shorter than this
 * @param {string}  [options.fill='none']     Fill strategy:
 *                                            'none' | 'lines' | 'crosshatch' |
 *                                            'diagonal' | 'stipple'
 * @param {number}  [options.fillSpacing=6]   Pixel spacing for the densest shade level
 * @param {number}  [options.shadeLevels=1]   Number of brightness bands (1–4).
 *                                            Each level becomes a separate shading pass
 *                                            with M0 pause for pen swap.
 *                                            Level 0 = darkest/densest.
 * @returns {{
 *   contourPaths: Array<Array<{nx:number, ny:number}>>,
 *   shadingPasses: Array<{ label:string, paths:Array<Array<{nx:number, ny:number}>> }>
 * }}
 */
export function traceImage(imageData, {
  threshold   = 128,
  invert      = false,
  simplify    = 4.0,
  smooth      = 4,
  minPoints   = 3,
  fill        = 'none',
  fillSpacing = 6,
  shadeLevels = 1,
} = {}) {
  const { width, height } = imageData;
  if (width < 2 || height < 2) return { contourPaths: [], shadingPasses: [] };

  const gray = grayscale(imageData, invert);

  // Binary map at threshold for contour tracing
  const bin      = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] < threshold ? 1 : 0;

  const adj      = buildAdjacency(bin, width, height);
  const rawPaths = tracePaths(adj);

  // ── Contour paths (marching squares → RDP → Catmull-Rom) ──────────────
  const contourPaths = [];
  for (const raw of rawPaths) {
    const simplified = rdp(raw, simplify);
    if (simplified.length < minPoints) continue;
    const densified = smooth >= 2 ? catmullRom(simplified, smooth) : simplified;
    contourPaths.push(densified.map(([x2, y2]) => _toNdc(x2 / 2, y2 / 2, width, height)));
  }

  // ── Shading passes (fill, split into brightness bands) ────────────────
  const shadingPasses = [];

  if (fill !== 'none') {
    const levels = Math.max(1, Math.min(4, shadeLevels));
    const labels = SHADE_LABELS[levels - 1];
    // Spacing multiplier per level: level 0 = densest, increases by 80% per step
    const spacingMultipliers = [1, 1.8, 2.6, 3.4];

    for (let lvl = 0; lvl < levels; lvl++) {
      const bandBin = levels === 1
        ? bin   // single level: use the full foreground binary map
        : _bandBin(gray, Math.floor(lvl * threshold / levels),
                         Math.floor((lvl + 1) * threshold / levels));

      const spacing = fillSpacing * spacingMultipliers[lvl];
      const paths   = _makeFillPaths(fill, bandBin, width, height, spacing);

      if (paths.length > 0) {
        shadingPasses.push({ label: labels[lvl], paths });
      }
    }
  }

  return { contourPaths, shadingPasses };
}
