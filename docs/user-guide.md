# User Guide

This guide covers every feature of the G-code Pen Plotter app, tab by tab.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Wave tab — 3D audio visualizer](#wave-tab)
3. [G-code tab — preview, export & image tracing](#g-code-tab)
4. [Serial tab — plotter connection](#serial-tab)
5. [Gen Art tab — generative art algorithms](#gen-art-tab)
6. [Settings that apply everywhere](#global-settings)

---

## Quick start

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5174`).

**Fastest path to a plot:**

1. **Wave tab** — choose *Noise Generator* as Source, pick a Shape, click **Record**
2. Orbit the 3D preview, then click **Pattern → G-code**
3. **G-code tab** — click **Export G-code**, send the file to your plotter

---

## Wave tab

The Wave tab captures audio (or generates algorithmic noise) and visualizes it as 3D geometry you can export to G-code.

### Source

| Option | Description |
|---|---|
| **Noise Generator** | Fully algorithmic; reproducible from a seed; no microphone required |
| **Microphone** | Live audio from `getUserMedia` via Web Audio API AnalyserNode |

#### Noise generator types

| Type | Description |
|---|---|
| **Perlin fBm** | 2D Perlin noise scrolling over time; configurable octaves and persistence |
| **Sine Sum** | Sum of seed-derived harmonics with random frequency ratios and phase offsets |
| **White Noise** | xorshift32 PRNG; maximally random |

The same seed and settings always produce the same output and the same plot.

### Shape

Fifteen built-in visualization modes map audio frames to different 3D geometry. Custom shapes can be added via the **Plugin system** (see below).

| Shape | Description |
|---|---|
| **Linear** | Stacked horizontal wave rows (Joy Division style) |
| **Circular** | One concentric ring per frame; amplitude modulates radius |
| **Spiral** | All frames joined into one continuous outward spiral |
| **Lissajous** | Left vs right channel XY scatter/trace; one curve per frame |
| **Terrain** | Horizon-masked ridges with painters-algorithm depth occlusion |
| **Landscape** | Terrain with opaque black fill polygons and perpendicular crest lines |
| **Harmonograph** | DFT-derived two-pendulum parametric curve with exponential damping |
| **Moiré** | Two offset families of concentric rings producing interference fringes |
| **Heatmap** | Frequency spectrogram grid; amplitude controls circle radius per cell |
| **Quantized Noise** | Joy Division ridges snapped to 8 amplitude bands; gap regions hatched |

### Recording

1. Select a Source and Shape.
2. Click **Record** — captures frames at the configured fps (default 10). Recording auto-stops at Max Frames.
3. While recording, the 3D scene builds in real time.
4. Click **Record** again to stop early.

### 3D orbit controls

| Gesture | Action |
|---|---|
| Left drag | Orbit (rotate camera around scene) |
| Right drag | Pan (translate camera) |
| Scroll | Zoom in / out |

### Export

| Button | Description |
|---|---|
| **Pattern → G-code** | Projects the 3D scene through the current camera view to a 2D NDC set and sends it to the G-code tab (monoscopic) |
| **Pattern → Stereo** | Same but generates two slightly offset views (±0.325 units) for red-cyan anaglyph glasses; produces a two-pass G-code file with an `M0` pen-change pause between passes |

### Advanced controls

Click **Advanced** to reveal:

| Setting | Description |
|---|---|
| Data Mode | Time-domain, Frequency (FFT), or Stereo |
| Noise type / Seed / Speed / Frequency / Octaves / Persistence | Tune the noise generator |
| Max Frames | How many frames to capture before auto-stop |
| Amp Scale | Vertical amplitude multiplier |
| FFT Size | Frequency resolution (power of 2) |
| Record FPS | Frames captured per second |
| Smoothing | Web Audio smoothing constant |
| Camera | Copy/paste the current camera position and target for reproducible compositions |

### Visualization plugin system

Install custom 3D shapes at runtime without modifying the app.

1. Click **Plugins** in the sidebar.
2. Paste ES module source code or click **Load file**.
3. Click **Install** — the shape appears immediately in the Shape dropdown and is saved in `localStorage`.

See [Visualization Plugin API](./viz-plugin-api.md) for the full developer guide.

---

## G-code tab

The G-code tab previews, exports, and imports G-code for your plotter.

### 2D canvas preview

The canvas shows pen paths mapped to A4 paper (210×297 mm, 10 mm margins) with correct aspect-ratio scaling. Paths are rendered as cyan lines; the paper boundary is shown as a grey rectangle.

**Navigation:** scroll to zoom, drag to pan; click **Reset zoom** to fit.

### Playback animation

Click **Play** to animate the G-code execution:

- **Cyan lines** — pen-down (drawing) moves
- **Dashed grey lines** — pen-up (travel) moves
- **Red dot** — current pen position
- **Speed slider** — controls animation rate (1×–100×)
- **Optimize toggle** — reorders paths using the nearest-neighbour sort to minimise travel distance; shows percentage of travel saved

### Import G-code

Click **Import** and select an existing `.gcode` file to preview it in the canvas. Imported paths replace the current pattern.

### Export G-code

Click **Export G-code** to download a GRBL-formatted `.gcode` file. The file includes:

- Paper dimensions, plot area, and margins as comments
- Generation parameters (algorithm, all param values) as comments
- `G21` (mm), `G90` (absolute positioning)
- Pen-up moves as `G0`, pen-down drawing as `G1`
- Configurable feedrate and pen-up/down method (Z axis or servo)
- Final `G0 X0 Y0` return to machine home and `M2` end

**Filenames** are three words derived deterministically from all generation parameters so that identical settings always produce the same filename.

### Image to G-code

Click **Image → G-code** to open the image tracing dialog.

1. **Upload** a raster image (JPEG, PNG, etc.).
2. Adjust tracing settings:

| Setting | Description |
|---|---|
| Threshold (0–255) | Binarization cutoff; pixels above threshold become ink |
| Invert | Swap black and white |
| Simplify | Path simplification strength; higher = fewer points |
| Smooth | Number of spline smoothing passes |
| Min points | Minimum vertices per contour to keep |
| Fill mode | `none` = outline only; `horizontal` / `cross` / `grid` = hatch fill patterns |
| Hatch spacing | Distance between hatch lines (mm) |
| Shade levels | 1–4 grayscale passes; each pass uses M0 for a manual pen swap |

3. The live preview updates as you adjust settings.
4. Click **Apply** to send the traced paths to the G-code canvas.

Multi-pass shading produces one pen-down layer per brightness band. The plotter pauses at each `M0` so you can swap pens (e.g. dark → medium → light ink) for simulated grayscale.

---

## Serial tab

The Serial tab streams G-code directly to a connected plotter over USB serial.

> **Browser requirement:** Web Serial API requires **Chrome or Edge** on a secure origin (`https://` or `http://localhost`).

### Connecting

1. Ensure your plotter is connected via USB.
2. Click **Connect** and select your port from the browser dialog.
3. The app communicates at **115200 baud** (standard GRBL).

### Sending G-code

Click **Send** to stream the current G-code to the plotter line-by-line, waiting for GRBL's `ok` acknowledgment before sending the next line. A progress indicator shows position in the file.

### Machine commands

| Button | Description |
|---|---|
| **Home** | Runs GRBL homing cycle (`$H`); requires limit switches |
| **Zero X,Y** | Sets current position as X0 Y0 origin |
| **Zero Z** | Sets current Z as Z0 |
| **Pen Up** | Lifts pen to configured up position |
| **Pen Down** | Lowers pen to configured down position |
| **Frame** | Traces the bounding box of the current plot with pen raised (to verify paper placement) |
| **Sweep S** | Ramps servo from S0→S1000→S0 to find min/max servo range |
| **Cal** | Draws a series of horizontal marks across Y to calibrate servo tilt compensation |

### Jogging

Use the **Jog** controls to move the pen head manually in X/Y/Z by the selected step size (0.1 mm to 10 mm).

### Serial monitor

A scrolling log shows all commands sent and GRBL responses received. Useful for debugging connection issues.

### Pen configuration

| Setting | Description |
|---|---|
| Feedrate | Plotter drawing speed (mm/min) |
| Pen mode | `Z axis` (uses G0/G1 Z moves) or `Servo` (uses M3 S commands) |
| Pen up Z / down Z | Z positions for Z-axis pen lift |
| Pen up S / down S | Servo values for servo pen lift |
| Y compensation slope | Servo correction for tilt (µS per mm of Y travel) |

---

## Gen Art tab

The Gen Art tab generates mathematical art as plotter-ready 2D paths.

### Algorithm dropdown

Select from 8 built-in algorithms or any user-installed plugins.

| Algorithm | Description |
|---|---|
| **Noise Contours** | Perlin noise iso-contours |
| **Superformula** | Gielis superformula polar curves |
| **L-System** | Lindenmayer-system space-filling curves: Hilbert, Moore, Gosper, Peano |
| **Harmonograph** | Damped two-pendulum parametric curves |
| **Spirograph** | Hypo- and epi-cycloid curves with ellipse stretch and multi-layer support |
| **Julia Set** | Julia set contours at configurable c values and presets |
| **Space Filling** | Hilbert / Gosper / other space-filling L-system curves |
| **Code Art** | Write JavaScript using the built-in 3D primitives and 2D path helpers |

### Parameter controls

The sidebar auto-generates controls from the algorithm's `params` definition:

- **Sliders** — `range` params; drag or click to adjust
- **Number inputs** — `number` params; type exact values
- **Dropdowns** — `select` params; choose from a list; may auto-populate sibling params (presets)
- **Checkboxes** — `toggle` params

### Guide overlay

Algorithms that export a `guide()` function (currently **Spirograph**) show a dim dashed blue overlay on the canvas depicting construction geometry — the outer/inner ellipses and pen arm position. The guide updates live as you move sliders.

### Generate

Click **Generate** to run the algorithm and display the paths on the canvas.

**Code Art** opens an in-app JavaScript editor with syntax highlighting, line
numbers, code folding, bracket matching, and standard undo/redo and indentation
shortcuts. It offers JavaScript keyword, snippet, and local-variable
completion, as well as suggestions for the provided art helpers. It does not
provide full IntelliSense or type-aware suggestions. Write code that returns an
array of paths, then click **Generate** to run it. Code is saved in this
browser's local storage as you edit.

Drag the **right-hand sidebar divider** to resize the sidebar. Drag the
**horizontal handle below the code editor** to change the editor height
(220-1600 pixels). The editor follows the sidebar width. Each handle is also
keyboard-accessible: Left/Right changes sidebar width, Up/Down changes editor
height, Shift moves in larger steps, and Home/End selects the minimum/maximum.
Sidebar widths for Code Art and other algorithms are remembered separately.
Sizes are saved in this browser's local storage and restored after a reload.
On smaller windows, the sidebar is temporarily constrained to keep space for
the preview; widening the window restores the preferred width. Resizing does
not regenerate or replace your artwork. Storage errors appear in the sidebar.

The direct shape and drawing helpers are:

| Function | Description |
|---|---|
| `sphere(options)`, `cube(options)`, `torus(options)`, `cylinder(options)` | Return visible surface-grid paths with optional `detail`, `azimuth`, `elevation`, and `fov` settings |
| `combine(...pathGroups)` | Join path arrays into one result |
| `transform(paths, options)` | Scale, rotate (degrees), and translate paths with `translateX` / `translateY` |
| `circle(options)` | Draw a circle with optional `x`, `y`, `radius`, and `steps` |
| `polyline(points, options)` | Draw points as `[x, y]` pairs or `{nx, ny}` objects; set `close: true` to close the path |
| `contours(field, size, threshold)` | Extract stitched 2D iso-contours from a square scalar grid; details below |

#### Editable 2D simulations and attractors

**Reaction-Diffusion**, **Cyclic CA**, and **Strange Attractors** have moved out
of the Algorithm dropdown into Code Art's **Examples** selector. Click **Load**
to edit the full algorithm, then **Generate**. There are no separate slider
controls: settings, equations, and preset tables are at the top of the source.

- **Reaction-Diffusion:** Gray-Scott simulation with `spots`, `maze`,
  `fingerprints`, and `coral` feed/kill presets. Edit `preset`, `size`,
  `iterations`, `threshold`, or the chemistry table.
- **Cyclic CA:** editable eight-neighbour successor rule with `states`,
  `threshold`, `size`, `iterations`, and a seeded starting grid.
- **Strange Attractors:** `clifford`, `dejong`, `lorenz`, `rossler`, and
  `halvorsen` presets. Edit the coefficient tuple directly instead of toggling
  "Use preset values". Discrete maps and RK4 integration are both in the source.

Both grid simulations use Code Art's `random(seed)`, so the same new code and
seed reproduce a pattern, but old plugin seed numbers do not reproduce the
exact old layouts. Defaults retain the former simulation sizes and durations.
All three examples use the cancellable Code Art worker and include in-app help.

`contours(field, size, threshold)` accepts an array, `Float32Array`, or
`Float64Array` of exactly `size * size` finite numbers. Grid size must be an
integer from 2 to 512; the threshold must be finite. Store cells in row-major
order, `field[y * size + x]`. The helper reuses the app's marching-squares
extractor, interpolates threshold crossings, and stitches them into paths in
`[-1,1]` on both axes, with row zero at the bottom. The contour output does not
use a camera or automatic scene fitting. A level outside the field range
legitimately yields no paths. The normal output budgets still apply.

#### 3D scene building

For composed 3D artwork, `solid` creates transformable shapes, and a scene
renders them together through one camera and one hidden-line pass:

| Scene API | Description |
|---|---|
| `scene().add(...shapes)` | Add solids, meshes, custom 3D paths, or arrays of shapes |
| `solid.sphere()`, `solid.cube()`, `solid.torus()`, `solid.cylinder()`, `solid.cone()` | Create primitives; options include `detail`, `draw`, and `occlude` |
| `solid.heightfield(options)` | Create a transformable surface from a `height(x, y)` function, drawn as parallel lines or a grid |
| `shape.translate(x, y, z)` | Move a shape in world-space units; also accepts a three-number array |
| `shape.rotate(x, y, z)` | Rotate in degrees around X, Y, then Z; also accepts a three-number array |
| `shape.scale(s)` or `shape.scale(x, y, z)` | Apply uniform or per-axis scale |
| `shape.draw(style)` | Set `'grid'` (primitive default), `'edges'`, `'silhouette'`, or `'none'` |
| `shape.occluder()` | Draw nothing but retain hidden-line occlusion; equivalent to `.draw('none')` |
| `shape.occlude(false)` | Disable this object's occlusion without hiding its drawing |
| `shape.withPaths(paths)` | Replace generated lines with local-coordinate 3D polylines; retain the object's occluding geometry |
| `paths3d(paths)` | Create transformable 3D polylines without an occluding volume |
| `scene.render(camera)` | Render visible paths; see camera settings below |

Shapes have a base size of approximately 2 world units. The renderer fits the
visible scene to the plot area. An omitted camera uses a default perspective
view aimed at the origin. Scenes can contain up to 12,000 objects (including
Boolean operands), subject to the resource limits below. Rotations are
applied in X, Y, Z order.

```js
const sculpture = scene().add(
  solid.sphere({ detail: 8 }).scale(0.8).translate(-0.9, 0, 0),
  solid.torus({ detail: 8 }).rotate(65, 0, 0).translate(0.9, 0, 0.2),
  solid.cube({ detail: 7 }).scale(0.35).rotate(20, 20, 0).translate(0, 0.8, 0)
);

return sculpture.render({
  position: [4.5, -6, 4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 45
});
```

Direct shape helpers such as `sphere(options)` still return rendered 2D paths
for simple single-object sketches.

#### Drawing styles, outlines, and custom 3D paths

Use `.draw('edges')` for clean cube edges rather than face grids. Spheres use
a camera-dependent outline for both `'edges'` and `'silhouette'`. Cylinders
and cones draw cap rims and tangent generators, with hidden portions removed.
Cube silhouettes omit internal face boundaries. Torus silhouettes are sampled
from a 64-by-64 surface mesh; mesh silhouettes use boundary edges and edges
between front/back-facing triangles. Mesh face winding should be consistent.
Triangle meshes default to unique triangle edges (including triangulation
diagonals); they do not generate primitive-style surface grids.
Height fields use their `style` setting for line layout; select `.draw('none')`
to use only their occluding surface.

```js
const links = solid.cylinderBetween([0, 0, 0], [1, 0, 1], {
  radius: 0.06, draw: 'silhouette',
});
const tree = solid.coneBetween([-1, 0, 0], [-1, 0, 1.5], {
  radius: 0.3, draw: 'silhouette',
});
return scene().add(links, tree).render();
```

Endpoint helpers take base/start and tip/end points; their `radius` is measured
in world units before subsequent transforms.

`paths3d()` and `.withPaths()` take arrays of polylines of `[x, y, z]` points.
Custom lines can be hidden by any scene occluder, independently of what that
occluder draws. On a unit sphere, `.withPaths()` joins surface points along
normalized chords instead of cutting through the sphere's interior:

```js
const equator = Array.from({ length: 181 }, (_, i) => latLng(0, i * 2));
return scene().add(solid.sphere().withPaths([equator])).render();
```

`latLng(latitude, longitude, radius = 1)` converts degrees to Z-up sphere
coordinates. For coastlines, upload your own JSON/CSV coordinate data and map
it to these points. No coastline dataset is bundled. `random(integerSeed)`
returns a deterministic function producing numbers in `[0, 1)` for reproducible
placements.

#### Mesh import, fitting, slicing, and voxel art

Use **Local assets** to select OBJ, STL, CSV, JSON, or text files. They are read
locally and exposed as `assets['filename']`; they are not uploaded or saved in
local storage. Re-select them after reloading the page. Text files are strings;
STL files are `ArrayBuffer` values, with ASCII/binary detection during parsing.
The combined asset limit is 20 MiB. Removing an asset cancels generation and
clears the old output.

```js
const model = mesh.obj(assets['model.obj']).fit();
// Alternatively: mesh.stl(assets['model.stl']).fit()
return scene().add(model.rotate(0, 0, 20)).render();
```

| Mesh API | Meaning |
|---|---|
| `mesh.from({ vertices, faces })` | Indexed triangle mesh; vertices are `[x,y,z]`, faces are zero-based index triples |
| `mesh.obj(text)` | OBJ geometry; slash/negative indices and planar concave polygons are supported; materials are ignored |
| `mesh.stl(textOrBuffer)` | ASCII or binary STL geometry |
| `model.fit(min, max)` | Fit local mesh into bounds while preserving aspect ratio; defaults `[-1,-1,-1]` to `[1,1,1]` |
| `model.slices({ axis: 'z', count: 32 })` | Draw joined cross-sections while keeping the mesh as an occluder; axes X/Y/Z, counts 2–256 |
| `model.slice({ point, normal })` | One arbitrary local plane section as a non-occluding 3D path object |
| `model.voxelize({ size, maxVoxels: 10000 })` | Return an array of edge-style cubes; `size` is local voxel side length |

Fit before attaching custom paths or slicing; transforms are retained by slice
and voxel results. Meshes allow up to 100,000 non-degenerate triangles and
300,000 finite vertices. Invalid geometry and non-intersecting slices report
errors rather than returning misleading success.

```js
const model = mesh.obj(assets['model.obj']).fit();
return scene().add(model.slices({ axis: 'z', count: 40 })).render();
// Or: return scene().add(...model.voxelize({ size: 0.15 })).render();
```

Voxelization fills closed meshes and includes intersecting surface cells.
Open meshes produce surface cells only. The `maxVoxels` budget limits the whole
candidate grid, not just the occupied result; overly fine grids fail explicitly.
Scene/output limits still apply to the resulting cubes.

#### Boolean sculptures and bounded functions

`solid.union(a, b, ...)`, `solid.intersection(a, b, ...)`, and
`solid.difference(body, cut, ...)` combine **closed analytic primitives**:
cubes, spheres, cylinders, cones, tori, and nested Boolean shapes.
Operands retain their transforms. The result supports transforms and drawing
styles too. Mesh and open height-field Boolean operations are not supported.

```js
const sculpture = solid.difference(
  solid.intersection(solid.sphere(), solid.cube().scale(0.8)),
  solid.cylinder().scale(0.5, 0.5, 2),
);
return scene().add(sculpture).render();
```

Visibility tests the combined volume, so holes really reveal geometry behind
them. Drawing filters and trims the operands' existing paths at the Boolean
boundary; it does **not** construct a new CAD mesh or automatically add every
intersection seam. Very thin features near the numeric boundary tolerance may
require changing scale/detail.

`solid.function()` creates a sampled function surface bounded in X/Y/Z, with
side walls and a base at the lower Z bound (`side: 'below'`) or upper Z bound
(`side: 'above'`). It draws the function surface, not the side walls:

```js
return scene().add(solid.function({
  x: [-2, 2], y: [-2, 2], z: [-4, 1],
  lines: 65, samples: 80, style: 'grid', side: 'below',
  height: (x, y) => -1 / (x * x + y * y),
})).render({ position: [4, -6, 4], target: [0, 0, -1] });
```

Unlike ordinary height fields, bounded functions clamp infinite values to their
Z bounds, allowing poles such as this example. NaN and non-numeric values remain
errors. `z` is required; `samples` defaults to 100 and is limited to 8–128.
Other sampling/layout options match height fields. This is a sampled surface,
not a general implicit-isosurface or CAD Boolean mesh.

#### Camera framing and generation limits

The default camera still fits the visible drawing to the plot area. Pass
`fit: false` to preserve camera framing, so `fov` controls apparent size.
Optional `aspect` (positive, default 1) fits the camera's rectangular frame into
the square plot coordinates without stretching; `near` (default 0.01) and
`far` (optional) clip by camera-space depth. Paths may extend outside the plot
with `fit: false`; choose camera framing that keeps exported artwork in bounds.

Code Art runs in a dedicated Web Worker. **Cancel** terminates even a program
stuck in an infinite loop. Edits, loading an example, changing algorithms, or
changing assets cancel stale work and clear its old output; generation errors
and cancellation cannot leave an old drawing available for export. Jobs time
out after 30 seconds. Code remains ordinary JavaScript with worker capabilities;
this is not a security sandbox, so only run code you trust.

Resource limits are explicit: 12,000 objects, Boolean nesting depth 16,
one million mesh triangles across the scene (including height fields),
100,000 source curves, 10 million visibility samples, and output of at most
20,000 paths / 500,000 points. These are ceilings, not a guarantee that every
scene at the ceiling finishes within the time limit. Use edge/silhouette styles
and moderate mesh/line detail for large scenes.

#### Height fields: ripples, terrain, and waves

Use `solid.heightfield()` to turn a mathematical height function into a 3D
surface. It supports the same transforms, shared camera, hidden-line removal,
and G-code handoff as other scene shapes:

```js
const water = solid.heightfield({
  x: [-2, 2],
  y: [-2, 2],
  lines: 90,
  samples: 200,
  style: 'parallel',
  height(x, y) {
    const r = Math.hypot(x, y);
    return 0.24 * Math.cos(11 * r) * Math.exp(-0.9 * r)
      + 0.7 * Math.exp(-30 * r * r);
  },
});
return scene().add(water).render({
  position: [3, -6, 3], target: [0, 0, 0], up: [0, 0, 1], fov: 45,
});
```

| Option | Default | Meaning |
|---|---|---|
| `height(x, y)` | Required | Return a finite numeric height; use a deterministic function without side effects |
| `x`, `y` | `[-1, 1]` | Two increasing finite bounds on each axis |
| `lines` | `70` | Number of drawn lines per direction, integer from 2 to 200 |
| `samples` | `160` | Mesh subdivisions per axis, integer from 8 to 256 |
| `style` | `'parallel'` | Lines along X; use `'grid'` to add lines along Y |

`lines` controls ink density; `samples` controls surface accuracy and processing
cost. Heights are sampled once per mesh vertex during generation, then line
positions and visibility use that same triangle mesh to avoid self-occlusion
artifacts. Increase `samples` for narrow peaks or closely spaced ripples.
Height fields are open, two-sided sheets, not closed volumes with side walls.
Peaks can hide more distant lines, and the surface can occlude other scene
objects (and vice versa). Invalid options, non-finite heights, and formula
errors are reported by the editor's generation error display.

The scene-building approach is inspired by
[fogleman/ln](https://github.com/fogleman/ln), Fogleman's Go line-art engine.
This app's TypeScript renderer is an independent implementation, not a port of
its source code.

Simple 2D example:

```js
const body = sphere({ detail: 8, azimuth: 35, elevation: 25 });
const orbit = circle({ radius: 0.48, steps: 180 });
return combine(body, orbit);
```

The **Examples** selector below the editor includes the original Cube Study,
Sphere Study, Orbital Sculpture, Helix Tower, Courtyard, and Droplet Ripples,
plus Edge City, Bead Strands, Spatial Graph, Cone Grove, Globe Lines, Mesh
Study, Mesh Slices, Mesh Voxels, Boolean Sculpture, and Bounded Function, plus
the 2D Reaction-Diffusion, Cyclic CA, and Strange Attractors programs.
Choose one and click **Load** to replace the editor contents; click **Generate**
to run it (or enable Auto-generate).

The **Help** button beside **Load** opens a wide, in-app example guide drawer.
Each bundled example has an overview, step-by-step code dissection, a reference
for every numeric constant and setting, camera or 2D framing explanations, experiments, and
plotting pitfalls. Walkthrough buttons jump to numbered lines in the original
source. Section links let you move between the walkthrough, numbers, camera,
experiments, source, and shared concepts.

Use **Guide example** inside the drawer to browse all guides without changing
the selected example or editor. Guides describe the original bundled source,
not your edited version. Opening help, switching guides, and closing help do
not load or execute code and do not clear the preview. Close with **Close** or
Escape to return to the editor. On narrow screens the drawer fills the width
and wide code/parameter tables scroll horizontally.

The 3D example studies take inspiration from the scene and primitive examples
in [fogleman/ln](https://github.com/fogleman/ln), but their code is original
and written for this app's API.

Code Art runs in a worker; installed Gen Art plugins still run in the main
browser context. Only run code and plugins you trust.

Enable **Auto-generate** to regenerate automatically 350 ms after any param change.

### Sending to plotter

Click **Send to G-code** to transfer the current paths to the G-code tab. The export includes a metadata snapshot of the algorithm ID and all current param values as comments in the G-code file.

### GenArt plugin system

Install custom algorithms at runtime.

1. Click **Plugins** in the sidebar.
2. Paste ES module source or click **Load file**.
3. Click **Install** — the algorithm appears in the dropdown immediately and is saved to `localStorage`.

See [GenArt Plugin API](./genart-plugin-api.md) for the full developer guide and the `examples/voronoi-cells.genart.js` file for a worked example.

---

## Global settings

Some settings are shared across tabs:

| Setting | Where | Description |
|---|---|---|
| Paper size | G-code export | Default A4 (210×297 mm), 10 mm margins |
| Offset X / Y | G-code / Serial | Additional translation applied on export |
| Import scale | G-code | Scale factor when importing external G-code |
| Pen mode | Serial | Z-axis or servo pen lift method |

Settings are persisted in `localStorage` and survive page refreshes.
