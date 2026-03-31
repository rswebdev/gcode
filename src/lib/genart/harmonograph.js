/**
 * Harmonograph — 4-pendulum damped Lissajous harmonograph
 *
 * x(t) = A1·sin(f1·t + p1)·exp(-d1·t) + A2·sin(f2·t + p2)·exp(-d2·t)
 * y(t) = A3·sin(f3·t + p3)·exp(-d3·t) + A4·sin(f4·t + p4)·exp(-d4·t)
 *
 * @see https://en.wikipedia.org/wiki/Harmonograph
 */

const PRESETS = {
  rose:     { f1: 2, f2: 3, f3: 2, f4: 3, p1: 0,          p2: Math.PI / 2, p3: Math.PI / 2, p4: 0           },
  figure8:  { f1: 1, f2: 2, f3: 1, f4: 2, p1: 0,          p2: 0,           p3: Math.PI / 2, p4: Math.PI / 2  },
  web:      { f1: 3, f2: 2, f3: 3, f4: 2, p1: Math.PI / 4, p2: 0,          p3: 0,           p4: Math.PI / 3  },
  complex:  { f1: 3, f2: 5, f3: 4, f4: 6, p1: 0,          p2: Math.PI / 4, p3: Math.PI / 3, p4: Math.PI / 6  },
  infinity: { f1: 1, f2: 2, f3: 2, f4: 1, p1: Math.PI / 2, p2: 0,          p3: 0,           p4: Math.PI / 2  },
};

export const id    = 'harmonograph';
export const label = 'Harmonograph';

export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'rose',
    options: [
      { value: 'rose',    label: 'Rose'     },
      { value: 'figure8', label: 'Figure-8' },
      { value: 'web',     label: 'Web'      },
      { value: 'complex', label: 'Complex'  },
      { value: 'infinity',label: 'Infinity' },
    ],
  },
  { id: 'f1',      label: 'Freq 1',   type: 'range', min: 1,    max: 6,     step: 0.5,  default: 2     },
  { id: 'f2',      label: 'Freq 2',   type: 'range', min: 1,    max: 6,     step: 0.5,  default: 3     },
  { id: 'f3',      label: 'Freq 3',   type: 'range', min: 1,    max: 6,     step: 0.5,  default: 2     },
  { id: 'f4',      label: 'Freq 4',   type: 'range', min: 1,    max: 6,     step: 0.5,  default: 3     },
  { id: 'damping', label: 'Damping',  type: 'range', min: 0,    max: 0.02,  step: 0.001, default: 0.002 },
  { id: 'steps',   label: 'Steps',    type: 'range', min: 1000, max: 20000, step: 500,  default: 8000  },
];

/**
 * @param {Record<string,any>} p
 * @returns {Array<Array<{nx:number,ny:number}>>}
 */
export function generate(p) {
  const preset   = PRESETS[p.preset] ?? PRESETS.rose;
  const f1       = +p.f1;
  const f2       = +p.f2;
  const f3       = +p.f3;
  const f4       = +p.f4;
  const damping  = +p.damping;
  const steps    = p.steps | 0;

  const { p1, p2, p3, p4 } = preset;

  const totalTime = damping > 0 ? Math.min(-Math.log(0.01) / damping, 200) : 200;
  const dt        = totalTime / steps;

  const xs = new Float64Array(steps + 1);
  const ys = new Float64Array(steps + 1);
  let count = 0;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;

  for (let i = 0; i <= steps; i++) {
    const t  = i * dt;
    const e1 = Math.exp(-damping * t);
    const x  = Math.sin(f1 * t + p1) * e1 + Math.sin(f2 * t + p2) * e1;
    const y  = Math.sin(f3 * t + p3) * e1 + Math.sin(f4 * t + p4) * e1;

    if (!isFinite(x) || !isFinite(y)) continue;

    xs[count] = x;
    ys[count] = y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    count++;
  }

  if (count === 0) return [[]];

  const SCALE  = 0.95;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const xMid   = (xMax + xMin) / 2;
  const yMid   = (yMax + yMin) / 2;
  const norm   = Math.max(xRange, yRange) / 2;

  const path = new Array(count);
  for (let i = 0; i < count; i++) {
    path[i] = {
      nx: ((xs[i] - xMid) / norm) * SCALE,
      ny: ((ys[i] - yMid) / norm) * SCALE,
    };
  }

  return [path];
}
