/**
 * genart/superformula.js
 * The Gielis superformula — a single parametric equation that generates an
 * enormous variety of organic shapes: flowers, leaves, stars, shells, cells.
 *
 *   r(θ) = ( |cos(m·θ/4)/a|^n2  +  |sin(m·θ/4)/b|^n3 ) ^ (-1/n1)
 *
 * Multiple concentric layers are drawn with gradually varying n1, producing
 * a "growth ring" or "petal within petal" composition.
 *
 * Reference: Gielis, J. (2003) A generic geometric transformation that unifies
 * a wide range of natural and abstract shapes. American Journal of Botany.
 */

export const id    = 'superformula';
export const label = 'Superformula';

const PRESETS = {
  flower:  { m: 6,  n1: 0.3,  n2: 0.3,  n3: 0.3  }, // wavy hexagonal bloom
  leaf:    { m: 2,  n1: 1.0,  n2: 4.0,  n3: 8.0  }, // elongated leaf / lens
  star:    { m: 5,  n1: 2.0,  n2: 7.0,  n3: 7.0  }, // five-pointed sharp star
  crystal: { m: 8,  n1: 10.0, n2: 4.0,  n3: 4.0  }, // bevelled octagon
  seaweed: { m: 3,  n1: 0.2,  n2: 0.2,  n3: 0.2  }, // crinkly organic triangle
  shell:   { m: 4,  n1: 0.5,  n2: 0.5,  n3: 0.5  }, // rounded organic square
};

/** @type {import('../genartPluginLoader.js').GenArtParam[]} */
export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'flower',
    options: Object.keys(PRESETS).map(k => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) })),
  },
  { id: 'layers',    label: 'Layers',    type: 'range',  min: 1,   max: 12,   step: 1,    default: 6    },
  { id: 'rotation',  label: 'Rot/layer', type: 'range',  min: 0,   max: 90,   step: 1,    default: 8    },
  { id: 'steps',     label: 'Smoothness',type: 'range',  min: 100, max: 2000, step: 100,  default: 600  },
  { id: 'spread',    label: 'Spread',    type: 'range',  min: 0,   max: 0.4,  step: 0.02, default: 0.14 },
];

function _r(theta, m, n1, n2, n3) {
  const t = m * theta / 4;
  const a = Math.pow(Math.abs(Math.cos(t)), n2);
  const b = Math.pow(Math.abs(Math.sin(t)), n3);
  const s = a + b;
  if (s < 1e-12) return 0;
  return Math.pow(s, -1 / n1);
}

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const { m, n1, n2, n3 } = PRESETS[p.preset] || PRESETS.flower;
  const L       = Math.max(1, p.layers   | 0);
  const rotDeg  = +p.rotation || 0;
  const steps   = Math.max(32, p.steps   | 0);
  const spread  = p.spread != null ? +p.spread : 0.14;

  const rotRad = (rotDeg * Math.PI) / 180;

  // Pre-compute the maximum radius for this preset (for normalisation)
  // Sample densely to find the true max r
  let maxR = 0;
  const SURVEY = 2000;
  for (let i = 0; i <= SURVEY; i++) {
    const theta = (2 * Math.PI * i) / SURVEY;
    const r     = _r(theta, m, n1, n2, n3);
    if (isFinite(r) && r > maxR) maxR = r;
  }
  if (maxR < 1e-9) return [];

  const paths = [];

  for (let l = 0; l < L; l++) {
    // Each layer shifts n1 slightly — produces a family of related shapes
    const n1l    = n1 * (1 + spread * (l - (L - 1) / 2) / Math.max(1, L - 1));
    const rot    = l * rotRad;
    // Scale each layer to fit in [-0.95, 0.95] and offset inward per layer
    const scale  = (0.95 - l * (0.9 / Math.max(1, L))) / maxR;

    const path = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (2 * Math.PI * i) / steps;
      const r     = _r(theta, m, n1l, n2, n3);
      if (!isFinite(r)) continue;
      const scaled = r * scale;
      path.push({
        nx: scaled * Math.cos(theta + rot),
        ny: scaled * Math.sin(theta + rot),
      });
    }
    if (path.length >= 2) paths.push(path);
  }

  return paths;
}
