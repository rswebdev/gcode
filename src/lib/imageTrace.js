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
// Step 1 – Binarise
// ---------------------------------------------------------------------------

/**
 * Converts RGBA ImageData to a binary Uint8Array (1 = foreground).
 * Grayscale is computed with the standard luminance formula; alpha is applied.
 */
function binarize(imageData, threshold, invert) {
  const { width, height, data } = imageData;
  const bin = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const gray = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255);
    const inside = gray < threshold;
    bin[i] = (inside !== invert) ? 1 : 0;
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Traces contours in a raster image and returns them as NDC paths.
 *
 * Coordinate conventions:
 *   - NDC x: -1 = left edge of image, +1 = right edge
 *   - NDC y: +1 = top edge of image,  -1 = bottom edge  (Y-up, matching plotter)
 *
 * @param {ImageData} imageData
 * @param {object}  [options]
 * @param {number}  [options.threshold=128]  Grayscale cut-off (0–255)
 * @param {boolean} [options.invert=false]   Treat light pixels as foreground
 * @param {number}  [options.simplify=1.5]   RDP tolerance in doubled pixels
 *                                           (≈ 0.75 real pixels at default)
 * @param {number}  [options.smooth=4]       Catmull-Rom subdivisions per segment
 *                                           (0 or 1 = disabled; 2–8 recommended)
 * @param {number}  [options.minPoints=3]    Discard paths shorter than this
 * @returns {Array<Array<{nx:number, ny:number}>>}
 */
export function traceImage(imageData, {
  threshold = 128,
  invert    = false,
  simplify  = 1.5,
  smooth    = 4,
  minPoints = 3,
} = {}) {
  const { width, height } = imageData;
  if (width < 2 || height < 2) return [];

  const bin      = binarize(imageData, threshold, invert);
  const adj      = buildAdjacency(bin, width, height);
  const rawPaths = tracePaths(adj);

  const paths = [];
  for (const raw of rawPaths) {
    const simplified = rdp(raw, simplify);
    if (simplified.length < minPoints) continue;

    // Optionally densify with smooth Catmull-Rom curves
    const densified = smooth >= 2 ? catmullRom(simplified, smooth) : simplified;

    // Doubled-integer → NDC
    // Real pixel:  px = x2 / 2  (0 … width),   py = y2 / 2  (0 … height)
    // NDC x:  (px / width)  * 2 − 1  =  x2 / width  − 1
    // NDC y:  1 − (py / height) * 2  =  1 − y2 / height   (Y flipped)
    paths.push(densified.map(([x2, y2]) => ({
      nx:  x2 / width  - 1,
      ny: -y2 / height + 1,
    })));
  }

  return paths;
}
