/**
 * genart/juliaContours.js
 * Iso-contour lines extracted from Julia and Mandelbrot set escape-time fields.
 *
 * Builds a grid of normalised escape-count values for the chosen fractal,
 * then uses marching squares to extract evenly-spaced iso-contours.
 */

import { marchingSquares } from './_marchingSquares.js';

export const id    = 'juliacontours';
export const label = 'Julia Contours';

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'dendrite',
    options: [
      { value: 'dendrite',   label: 'Dendrite'   },
      { value: 'rabbit',     label: 'Rabbit'      },
      { value: 'seahorse',   label: 'Seahorse'    },
      { value: 'spiral',     label: 'Spiral'      },
      { value: 'sanmarco',   label: 'San Marco'   },
      { value: 'mandelbrot', label: 'Mandelbrot'  },
      { value: 'custom',     label: 'Custom'      },
    ],
  },
  { id: 'cx',       label: 'cx (real)',       type: 'number', min: -2,  max: 2,   step: 0.001, default: -0.8  },
  { id: 'cy',       label: 'cy (imaginary)',  type: 'number', min: -2,  max: 2,   step: 0.001, default: 0.156 },
  { id: 'levels',   label: 'Levels',          type: 'range',  min: 3,   max: 20,  step: 1,   default: 8   },
  { id: 'maxIter',  label: 'Max Iterations',  type: 'range',  min: 20,  max: 200, step: 10,  default: 80  },
  { id: 'zoom',     label: 'Zoom',            type: 'range',  min: 0.5, max: 3,   step: 0.1, default: 1.0 },
  { id: 'gridSize', label: 'Grid Size',       type: 'range',  min: 100, max: 400, step: 50,  default: 200 },
  {
    id: 'mode', label: 'Mode', type: 'select', default: 'julia',
    options: [
      { value: 'julia',       label: 'Julia'       },
      { value: 'mandelbrot',  label: 'Mandelbrot'  },
    ],
  },
];

// ---------------------------------------------------------------------------
// Preset c values
// ---------------------------------------------------------------------------

const PRESETS = {
  dendrite:   { cx: -0.8,   cy: 0.156, mode: 'julia'       },
  rabbit:     { cx: -0.123, cy: 0.745, mode: 'julia'       },
  seahorse:   { cx: -0.75,  cy: 0.1,   mode: 'julia'       },
  spiral:     { cx: -0.4,   cy: 0.6,   mode: 'julia'       },
  sanmarco:   { cx: -0.75,  cy: 0.0,   mode: 'julia'       },
  mandelbrot: { cx:  0,     cy: 0,     mode: 'mandelbrot'  },
};

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const preset    = p.preset || 'dendrite';
  const presetCfg = PRESETS[preset];

  // 'custom' preset (or unrecognised key) reads cx/cy/mode directly from params.
  // Named presets override cx/cy/mode so the named shapes are always correct.
  const mode = presetCfg ? presetCfg.mode : (p.mode || 'julia');
  const cx   = presetCfg ? (presetCfg.mode === 'julia' ? presetCfg.cx : 0)
                         : (mode === 'julia' ? (+p.cx || 0) : 0);
  const cy   = presetCfg ? (presetCfg.mode === 'julia' ? presetCfg.cy : 0)
                         : (mode === 'julia' ? (+p.cy || 0) : 0);

  const levels   = Math.max(1, (p.levels | 0) || 8);
  const maxIter  = Math.max(1, (p.maxIter | 0) || 80);
  const zoom     = +p.zoom    || 1.0;
  const N        = Math.max(10, (p.gridSize | 0) || 200);

  // Build escape-count field
  const field = new Float32Array(N * N);
  const invZoom = 1.0 / zoom;

  for (let gy = 0; gy < N; gy++) {
    const zy = (gy / (N - 1) * 2 - 1) * invZoom;
    for (let gx = 0; gx < N; gx++) {
      const zx = (gx / (N - 1) * 2 - 1) * invZoom;

      let zr, zi, cr, ci;
      if (mode === 'mandelbrot') {
        zr = 0; zi = 0;
        cr = zx; ci = zy;
      } else {
        zr = zx; zi = zy;
        cr = cx;  ci = cy;
      }

      let iter = 0;
      while (iter < maxIter && zr * zr + zi * zi <= 4) {
        const tmp = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = tmp;
        iter++;
      }

      field[gy * N + gx] = iter < maxIter ? iter / maxIter : 1.0;
    }
  }

  // Extract iso-contours at evenly-spaced thresholds, excluding 0 and 1
  const paths = [];
  for (let i = 0; i < levels; i++) {
    const thr  = (i + 1) / (levels + 1);
    const segs = marchingSquares(field, N, thr);
    for (const path of segs) paths.push(path);
  }

  return paths;
}
