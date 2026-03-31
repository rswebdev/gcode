# Architecture & Developer Guide

This document describes the codebase structure, key design decisions, and how the major subsystems fit together.

---

## Stack

| Layer | Technology |
|---|---|
| UI framework | Svelte 5 (runes-compatible, but using Svelte 4 reactivity syntax) |
| Build tool | Vite 8 |
| 3D rendering | Three.js 0.183 |
| Testing | Playwright |
| Linting | ESLint 10 + eslint-plugin-svelte |
| Type checking | svelte-check (JSDoc types, no TypeScript source files) |

---

## Directory structure

```
gcode/
├── src/
│   ├── App.svelte                  # Root component — tab bar + tab panels
│   ├── stores/
│   │   └── ui.js                   # Shared Svelte stores (activeTab, activePaths, …)
│   ├── modules/                    # One Svelte component per tab
│   │   ├── WaveRecorder.svelte     # Wave tab — audio capture + 3D preview
│   │   ├── GcodeHandler.svelte     # G-code tab — preview, export, playback
│   │   ├── SerialTransmission.svelte # Serial tab — GRBL connection
│   │   └── GenArt.svelte           # Gen Art tab — generative art + plugin system
│   └── lib/                        # Shared libraries
│       ├── gcode.js                # G-code generation, NDC↔paper mapping, path sort/dedup
│       ├── visualizer.js           # Three.js scene + built-in visualization shapes
│       ├── pluginLoader.js         # Runtime loader for visualization plugins
│       ├── genartPluginLoader.js   # Runtime loader for GenArt plugins
│       ├── recorder.js             # Audio capture + frame buffering
│       ├── imageTrace.js           # Marching-squares raster-to-vector tracing
│       └── genart/                 # Built-in GenArt algorithm modules
│           ├── attractors.js       # Strange attractors (Lorenz, Rössler, …)
│           ├── cyclicCA.js         # Cyclic cellular automaton
│           ├── harmonograph.js     # Damped two-pendulum parametric curves
│           ├── juliaContours.js    # Julia set contours
│           ├── lsystem.js          # L-system turtle graphics
│           ├── noiseContours.js    # Perlin noise iso-contours
│           ├── reactionDiffusion.js # Gray-Scott reaction-diffusion
│           ├── spaceFilling.js     # Space-filling L-system curves
│           ├── spirograph.js       # Hypo/epi-cycloid curves
│           ├── superformula.js     # Gielis superformula
│           └── _marchingSquares.js # Shared marching-squares helper
├── examples/
│   └── voronoi-cells.genart.js    # Example GenArt plugin (Voronoi cells)
├── tests/
│   └── *.spec.js                   # Playwright smoke / visual regression tests
├── docs/                           # This documentation
│   ├── user-guide.md
│   ├── genart-plugin-api.md
│   ├── viz-plugin-api.md
│   └── architecture.md             # ← you are here
└── style.css                       # Global styles
```

---

## Coordinate systems

The app uses three coordinate spaces. Understanding the mapping between them is critical for G-code generation.

### NDC (Normalized Device Coordinates)

The internal 2D coordinate system used by all GenArt algorithms and the G-code export pipeline:

- Range: `[-1, +1]` on both axes
- Origin `(0, 0)` = centre of the plot area
- `nx = -1` = left edge, `nx = +1` = right edge
- `ny = -1` = bottom edge, `ny = +1` = top edge (Y-up)
- Machine home `(0, 0)` maps to approximately NDC `(-1.1, -1.07)` (just outside the plot area)

### Paper coordinates (mm)

Physical coordinates on the paper:

```
_ndcToPaper(nx, ny, sx, sy, offsetX, offsetY)
  → { px: mm, py: mm }
```

- `CENTER_X = MARGIN + PLOT_W/2 = 105 mm` (A4 horizontal centre)
- `CENTER_Y = MARGIN + PLOT_H/2 = 148.5 mm` (A4 vertical centre)
- `sx, sy` are half-extents from `_ndcScales(aspect)` — aspect-ratio preserving

### Three.js scene space

Used by the Wave tab. Coordinates are in abstract "scene units":

- Scene width: 20 units (X: −10 to +10)
- Scene depth: 20 units (Z: 0 to +20, frames stack along Z)
- Y = vertical amplitude

Projected to NDC via perspective projection using the current camera pose.

---

## Key modules

### `src/lib/gcode.js`

Core G-code generation. Public exports:

| Export | Description |
|---|---|
| `framesToGCode(frames, config)` | Waveform / audio visualization G-code |
| `projectedPathsToGCode(paths, config)` | NDC paths → G-code (GenArt, image trace) |
| `anaglyphPathsToGCode(left, right, config)` | Two-pass stereo G-code |
| `imageGCode(contourPaths, shadingPasses, config)` | Multi-pass image tracing G-code |
| `parseGCodePaths(content)` | Parse G-code text back to `{x,y}` paths |
| `sortPaths(paths)` | Nearest-neighbour sort minimising travel |
| `ndcScales(aspect, plotW, plotH)` | Compute `{sx, sy}` half-extents |

**Path sort:** `_sortPaths()` seeds the nearest-neighbour search from NDC `(-1, -1)` (machine home corner) so the first pen move is as short as possible. For single-path algorithms, it reverses the path if the tail is closer to home. `_deduplicatePaths()` removes duplicate segments before sorting.

### `src/lib/visualizer.js`

Three.js scene management. Key points:

- All built-in shapes registered in `BUILTIN_SHAPES` array.
- Plugin contract defined in JSDoc at the top of the file (authoritative spec).
- `getProjectedPaths()` uses Three.js `raycaster` / camera frustum math to project 3D lines to 2D NDC.

### `src/lib/genartPluginLoader.js`

Runtime GenArt plugin installation:

1. **Validation** — checks required fields, param schema, type constraints.
2. **Evaluation** — loads code via Blob URL (`import(blobUrl)`).
3. **Persistence** — stores `{id, code}` in `localStorage` as JSON.
4. **Restore** — re-evaluates all stored plugins on page load.

### `src/modules/GenArt.svelte`

The Gen Art tab. Key reactive state:

| Variable | Type | Description |
|---|---|---|
| `selectedId` | `string` | ID of the active algorithm |
| `algorithms` | `object[]` | Merged built-in + user plugin list |
| `paramsByAlg` | `Record<id, Record<paramId, value>>` | Per-algorithm param storage |
| `currentPaths` | `Array<Array<{nx,ny}>>` | Last generated paths (canvas + export) |

Reactive rules:
- `selectedId` is reset to `algorithms[0].id` if the selected plugin is uninstalled.
- Params are merged (defaults + stored values) whenever the selected algorithm changes or a plugin is reinstalled.
- Canvas re-renders via `_renderPaths(currentPaths)` which draws guide paths first (if `selected.guide` exists), then main paths.

---

## Plugin systems

There are **two independent plugin systems**:

| System | Manages | Stored in localStorage | API doc |
|---|---|---|---|
| **GenArt plugins** | `genartPluginLoader.js` | `gcode-genart-user-plugins` | [genart-plugin-api.md](./genart-plugin-api.md) |
| **Visualization plugins** | `pluginLoader.js` | `gcode-viz-user-plugins` | [viz-plugin-api.md](./viz-plugin-api.md) |

Both use the same Blob URL evaluation pattern:

```js
const blob = new Blob([code], { type: 'text/javascript' });
const url  = URL.createObjectURL(blob);
const mod  = await import(url);
URL.revokeObjectURL(url);
```

---

## Stores (`src/stores/ui.js`)

Shared reactive state between tabs:

| Store | Type | Description |
|---|---|---|
| `activeTab` | `'wave' \| 'gcode' \| 'serial' \| 'genart'` | Currently visible tab |
| `activePaths` | `Array<Array<{nx,ny}>>` | Paths passed from Wave/GenArt to G-code tab |
| `shadingPasses` | `{label, paths}[]` | Multi-pass shading paths from image tracer |
| `exportParams` | `object` | Metadata snapshot for G-code comments and filenames |
| `cameraAspect` | `number` | Camera aspect ratio for aspect-correct NDC mapping |
| `settings` | `object` | Persisted settings (offsets, scale, pen config) |

---

## G-code format

Generated G-code follows this structure:

```gcode
; <app name> — <description>
; Paper: <dims>, <margins>
; --- Generation Parameters ---
; Algorithm ID:    spirograph
; Algorithm:       Spirograph
;   R:             5
;   r:             3
G21          ; Units: millimetres
G90          ; Absolute positioning
G0 Z5.000    ; Pen up

G0 X14.750 Y16.925  ; Travel to first path
G1 Z0.000 F300      ; Pen down
G1 X… Y… F2000
…
G0 Z5.000           ; Pen up

G0 X0.000 Y0.000    ; Return to machine home
M2                  ; End of program
```

---

## Testing

```bash
npm test          # Playwright end-to-end tests
npm run lint      # ESLint
npm run check     # svelte-check (type checking via JSDoc)
```

Playwright tests cover smoke tests for all tabs and visual regression tests for visualization shapes.

---

## Contributing

1. Branch from `main`.
2. Run `npm run lint && npm run check` — fix any errors before committing.
3. Commits must be GPG-signed (`git commit -S`).
4. Open a PR targeting `main`. The `release` skill handles versioning, CHANGELOG, and merge.
