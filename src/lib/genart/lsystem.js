export const id    = 'lsystem';
export const label = 'L-System';

const PRESETS = {
  koch_snowflake: { axiom: 'F++F++F',              rules: { F: 'F-F++F-F' },                   angle: 60,  label: 'Koch Snowflake' },
  koch_curve:     { axiom: 'F',                    rules: { F: 'F+F-F-F+F' },                  angle: 90,  label: 'Koch Curve' },
  sierpinski:     { axiom: 'F-G-G',                rules: { F: 'F-G+F+G-F', G: 'GG' },         angle: 120, label: 'Sierpiński Triangle' },
  dragon:         { axiom: 'F',                    rules: { F: 'F+G', G: 'F-G' },               angle: 90,  label: 'Dragon Curve' },
  fern:           { axiom: 'X',                    rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25,  label: 'Fern' },
  bush:           { axiom: 'F',                    rules: { F: 'F[+F]F[-F][F]' },               angle: 20,  label: 'Bush' },
};

export const params = [
  {
    id: 'preset', label: 'Preset', type: 'select', default: 'koch_snowflake',
    options: Object.entries(PRESETS).map(([value, { label }]) => ({ value, label })),
  },
  { id: 'iterations', label: 'Iterations', type: 'range', min: 1, max: 7, step: 1, default: 4 },
];

const MAX_LEN = 200_000;

function expand(axiom, rules, iterations) {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of s) {
      const rule = rules[ch];
      if (rule) {
        if (next.length + rule.length > MAX_LEN) {
          next += ch;
        } else {
          next += rule;
        }
      } else {
        next += ch;
      }
    }
    s = next;
    if (s.length >= MAX_LEN) break;
  }
  return s;
}

function turtle(str, angleDeg) {
  const rad = angleDeg * (Math.PI / 180);
  const paths = [];
  let current = [];
  let x = 0, y = 0, heading = -Math.PI / 2;
  const stack = [];

  current.push({ x, y });

  for (const ch of str) {
    switch (ch) {
      case 'F':
      case 'G': {
        x += Math.cos(heading);
        y += Math.sin(heading);
        current.push({ x, y });
        break;
      }
      case '+':
        heading -= rad;
        break;
      case '-':
        heading += rad;
        break;
      case '[':
        stack.push({ x, y, heading, pathIndex: paths.length, segIndex: current.length - 1 });
        break;
      case ']': {
        if (current.length > 1) paths.push(current);
        const state = stack.pop();
        if (!state) break;
        x = state.x;
        y = state.y;
        heading = state.heading;
        current = [{ x, y }];
        break;
      }
    }
  }

  if (current.length > 1) paths.push(current);

  return paths;
}

function normalize(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const path of paths) {
    for (const pt of path) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const range  = Math.max(rangeX, rangeY);

  if (range === 0 || !isFinite(range)) return null;

  const scale  = 1.9 / range;
  const cx     = (minX + maxX) / 2;
  const cy     = (minY + maxY) / 2;

  return paths.map(path =>
    path
      .map(pt => ({
        nx: (pt.x - cx) * scale,
        ny: (pt.y - cy) * scale,
      }))
      .filter(pt => isFinite(pt.nx) && isFinite(pt.ny))
  ).filter(path => path.length > 1);
}

export function generate(p) {
  const preset = PRESETS[p.preset] ?? PRESETS.koch_snowflake;
  const iterations = Math.max(1, Math.min(7, p.iterations ?? 4));

  const str   = expand(preset.axiom, preset.rules, iterations);
  const paths = turtle(str, preset.angle);

  if (paths.length === 0) return [];

  const result = normalize(paths);
  return result ?? [];
}
