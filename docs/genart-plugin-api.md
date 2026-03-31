# Generative Art Plugin API

Custom generative art algorithms can be installed at runtime in the **Gen Art** tab. A plugin is a single ES module file that exports one object conforming to the contract described below.

---

## Quick start

```js
export default {
  id:     'my-dots',
  label:  'Random Dots',
  params: [
    { id: 'count', label: 'Count', type: 'range', min: 10, max: 500, step: 10, default: 100 },
    { id: 'seed',  label: 'Seed',  type: 'number', min: 0, max: 99999, step: 1, default: 42 },
  ],
  generate({ count, seed }) {
    // Seeded PRNG
    let s = seed | 0;
    const rand = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xFFFFFFFF; };

    // Return one short path per dot (a 4-point cross)
    const paths = [];
    for (let i = 0; i < count; i++) {
      const x = rand() * 2 - 1;  // NDC: [-1, +1]
      const y = rand() * 2 - 1;
      const r = 0.015;
      paths.push([{ nx: x - r, ny: y }, { nx: x + r, ny: y }]);  // horizontal bar
      paths.push([{ nx: x, ny: y - r }, { nx: x, ny: y + r }]);  // vertical bar
    }
    return paths;
  },
};
```

---

## Contract

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique algorithm identifier. Must not conflict with built-in IDs. |
| `label` | `string` | Display name shown in the algorithm dropdown. |
| `params` | `GenArtParam[]` | Array of parameter descriptors (may be empty `[]`). |
| `generate(params)` | `function` | Produces the plot paths. See below. |

### `generate(params) → Array<Array<{nx, ny}>>`

Receives a plain object whose keys are the `id` values of your `params` entries and whose values are the current user-selected values. Returns an array of polyline paths, where each path is an array of points in **Normalized Device Coordinates (NDC)**:

- **x axis**: `nx` in `[-1, +1]`; `−1` = left edge, `+1` = right edge
- **y axis**: `ny` in `[-1, +1]`; `−1` = bottom edge, `+1` = top edge (Y-up)
- The app clips and maps NDC to the paper's plot area on export.

Each sub-array represents one continuous pen stroke. The pen lifts between paths.

```js
// Two separate strokes
return [
  [{ nx: -0.9, ny: -0.9 }, { nx: 0.9, ny: -0.9 }],  // bottom line
  [{ nx: -0.9, ny:  0.9 }, { nx: 0.9, ny:  0.9 }],  // top line
];
```

---

## Optional exports

### `guide(params) → Array<Array<{nx, ny}>>`

If exported, the app renders the returned paths as a **dim dashed blue overlay** before the main paths. Use this to visualise construction geometry (circles, axes, bounding boxes) that helps the user understand the current parameter state.

- Rendered on every param change (not just after Generate is pressed).
- Uses the same NDC coordinate system as `generate()`.
- See `src/lib/genart/spirograph.js` for a full example (outer/inner circles + pen arm).

```js
export function guide({ R, r }) {
  // Draw a simple bounding circle
  const N = 120;
  return [Array.from({ length: N + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / N;
    return { nx: Math.cos(t) * 0.9, ny: Math.sin(t) * 0.9 };
  })];
}
```

### `presets`

A plain object mapping preset names to partial param values. When the user selects a preset from a `select`-type param, all matching param IDs in `presets[value]` are automatically populated in the UI.

```js
export const presets = {
  tight:  { count: 200, spacing: 0.02 },
  sparse: { count:  30, spacing: 0.15 },
};
```

Pair this with a `select` param whose option values match the preset keys:

```js
{ id: 'preset', label: 'Preset', type: 'select', default: 'tight',
  options: [{ value: 'tight', label: 'Tight' }, { value: 'sparse', label: 'Sparse' }] }
```

---

## Parameter types

All four types are validated on install. Missing or mistyped fields cause an install error.

### `range` — slider

```js
{ id: 'count', label: 'Count', type: 'range', min: 5, max: 200, step: 5, default: 40 }
```

| Field | Required | Description |
|---|---|---|
| `id` | ✅ | Unique key within this plugin |
| `label` | ✅ | Sidebar display label |
| `type` | ✅ | `'range'` |
| `min` | ✅ | Minimum value (inclusive) |
| `max` | ✅ | Maximum value (inclusive) |
| `step` | ✅ | Increment unit. Use decimals (e.g. `0.01`) for float params |
| `default` | ✅ | Initial value |

### `number` — numeric input

Same fields as `range`. Renders as a text input; user can type an exact value.

```js
{ id: 'seed', label: 'Seed', type: 'number', min: 0, max: 99999, step: 1, default: 42 }
```

### `select` — dropdown

```js
{
  id: 'mode', label: 'Mode', type: 'select', default: 'hex',
  options: [
    { value: 'hex',    label: 'Hexagonal' },
    { value: 'square', label: 'Square' },
    { value: 'random', label: 'Random' },
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `options` | ✅ | Non-empty array of `{ value, label }` objects |

### `toggle` — checkbox

```js
{ id: 'fill', label: 'Fill cells', type: 'toggle', default: false }
```

The value passed to `generate()` is a boolean (`true`/`false`).

---

## Coordinate system

```
        ny = +1 (top)
           │
 nx = -1 ──┼── nx = +1
           │
        ny = -1 (bottom)
```

- Origin `(0, 0)` is the **centre** of the canvas/paper.
- `(±1, ±1)` are the corners of the NDC square; the app inscribes the plot area inside these coordinates with 10 mm margins.
- Y is **up** (unlike screen pixels where Y increases downward).

---

## Path deduplication

The export pipeline automatically deduplicates shared segments before sorting, so you don't need to manually deduplicate shared edges (e.g. adjacent Voronoi cell walls). However, deduplication works at the **segment level** (A→B and B→A treated as the same). If your algorithm produces many overlapping segments, prefer deduplicating before returning to avoid the O(n²) scan.

---

## Installing a plugin

1. Open the **Gen Art** tab → **Plugins** panel.
2. Paste your ES module source into the text area (or click **Load file**).
3. Click **Install** — the loader evaluates the module via a Blob URL, validates the contract, and adds it to the algorithm dropdown.
4. The plugin is persisted in `localStorage` and restored on page reload.

To uninstall: click the **×** next to the plugin name in the Plugins panel.

---

## Security

Plugin code executes in the **main app context** with full origin privileges (localStorage, network, DOM). This is intentional for a local-only developer tool where the user installs their own code. Never install plugin code from untrusted sources.

---

## Example plugins

- `examples/voronoi-cells.genart.js` — Voronoi cells with Lloyd relaxation and Sutherland-Hodgman clipping.
