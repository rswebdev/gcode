/**
 * Shared marching-squares isoline extractor.
 *
 * Extracts one iso-contour from a flat N×N Float32Array at a given threshold
 * and returns it as an array of polyline paths in NDC space ([-1,+1] × [-1,+1]).
 *
 * Field layout: field[y * N + x], with y=0 mapping to ny=-1 (bottom).
 *
 * @param {Float32Array|Float64Array} field
 * @param {number} N      — grid side length
 * @param {number} thr    — iso-value
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function marchingSquares(field, N, thr) {
  const segments = [];

  // Interpolation ratio along an edge (clamped to [0,1])
  function t(va, vb) {
    const d = vb - va;
    if (Math.abs(d) < 1e-12) return 0.5;
    return Math.max(0, Math.min(1, (thr - va) / d));
  }

  // Grid (gx,gy) → NDC
  function ndc(gx, gy) {
    return { nx: (gx / (N - 1)) * 2 - 1, ny: (gy / (N - 1)) * 2 - 1 };
  }

  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      // Corners: v0=BL, v1=BR, v2=TR, v3=TL
      const v0 = field[ y      * N + x    ];
      const v1 = field[ y      * N + x + 1];
      const v2 = field[(y + 1) * N + x + 1];
      const v3 = field[(y + 1) * N + x    ];

      // Case index: bit0=v0, bit1=v1, bit2=v2, bit3=v3
      const idx = ((v0 > thr) ? 1 : 0)
                | ((v1 > thr) ? 2 : 0)
                | ((v2 > thr) ? 4 : 0)
                | ((v3 > thr) ? 8 : 0);

      if (idx === 0 || idx === 15) continue;

      // Edge midpoints (edge 0=bottom, 1=right, 2=top, 3=left)
      const e = [
        ndc(x + t(v0, v1),     y              ), // edge 0: bottom (x varies)
        ndc(x + 1,             y + t(v1, v2)  ), // edge 1: right  (y varies)
        ndc(x + 1 - t(v2, v3), y + 1          ), // edge 2: top    (x decreases)
        ndc(x,                 y + 1 - t(v3, v0)), // edge 3: left (y decreases)
      ];

      // Canonical edge-pair table (which two edges the isoline crosses for each case)
      switch (idx) {
        case  1: segments.push([e[3], e[0]]); break;
        case  2: segments.push([e[0], e[1]]); break;
        case  3: segments.push([e[3], e[1]]); break;
        case  4: segments.push([e[1], e[2]]); break;
        case  5: segments.push([e[3], e[0]]); segments.push([e[1], e[2]]); break; // saddle
        case  6: segments.push([e[0], e[2]]); break;
        case  7: segments.push([e[3], e[2]]); break;
        case  8: segments.push([e[2], e[3]]); break;
        case  9: segments.push([e[2], e[0]]); break;
        case 10: segments.push([e[0], e[3]]); segments.push([e[2], e[1]]); break; // saddle
        case 11: segments.push([e[2], e[1]]); break;
        case 12: segments.push([e[1], e[3]]); break;
        case 13: segments.push([e[1], e[0]]); break;
        case 14: segments.push([e[0], e[3]]); break;
      }
    }
  }

  return _stitch(segments);
}

/**
 * Stitch disconnected segments into polylines using an endpoint hash map.
 * O(n) average for n segments.
 */
function _stitch(segments) {
  if (segments.length === 0) return [];

  const PREC = 1e5; // quantise to 5 decimal places
  function key(p) {
    return (Math.round(p.nx * PREC) * 131071) ^ Math.round(p.ny * PREC);
  }

  // endpoint index: hash → [{segIdx, end: 0|1}]
  const index = new Map();
  function addPt(pt, segIdx, end) {
    const k = key(pt);
    let list = index.get(k);
    if (!list) { list = []; index.set(k, list); }
    list.push({ segIdx, end });
  }
  function popPt(pt, segIdx) {
    const k = key(pt);
    const list = index.get(k);
    if (!list) return;
    const j = list.findIndex(e => e.segIdx === segIdx);
    if (j >= 0) list.splice(j, 1);
  }

  for (let i = 0; i < segments.length; i++) {
    addPt(segments[i][0], i, 0);
    addPt(segments[i][1], i, 1);
  }

  const used = new Uint8Array(segments.length);
  const paths = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    popPt(segments[start][0], start);
    popPt(segments[start][1], start);

    const fwd  = [segments[start][1]];
    const back = [segments[start][0]];

    // Extend forward
    for (let head = fwd[fwd.length - 1];;) {
      const k = key(head);
      const list = index.get(k);
      if (!list || list.length === 0) break;
      const { segIdx, end } = list[0];
      if (used[segIdx]) break;
      used[segIdx] = 1;
      const other = segments[segIdx][end === 0 ? 1 : 0];
      popPt(head, segIdx);
      popPt(other, segIdx);
      fwd.push(other);
      head = other;
    }

    // Extend backward (reverse head)
    for (let head = back[back.length - 1];;) {
      const k = key(head);
      const list = index.get(k);
      if (!list || list.length === 0) break;
      const { segIdx, end } = list[0];
      if (used[segIdx]) break;
      used[segIdx] = 1;
      const other = segments[segIdx][end === 0 ? 1 : 0];
      popPt(head, segIdx);
      popPt(other, segIdx);
      back.push(other);
      head = other;
    }

    // Combine: reverse(back) + fwd
    const path = back.slice().reverse().concat(fwd);
    if (path.length >= 2) paths.push(path);
  }

  return paths;
}
