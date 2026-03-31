# G-code Pen Plotter App

A browser-based tool for generating pen-plotter G-code from audio, images, and mathematical art. Built with Svelte 5 + Three.js.

---

## Features at a glance

| Tab | What it does |
|---|---|
| **Wave** | Record microphone or algorithmic noise as a 3D scene, orbit the camera, export to G-code |
| **G-code** | Preview, play back, and export G-code; trace raster images to vector paths |
| **Serial** | Stream G-code to a GRBL plotter over USB; jog, home, frame, and calibrate |
| **Gen Art** | Generate mathematical art (spirograph, fractals, reaction-diffusion, …) and install custom algorithm plugins |

---

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5174`.

### Fastest path to a plot

1. **Wave tab** → choose *Noise Generator*, pick a Shape, click **Record**
2. Orbit the 3D preview, then click **Pattern → G-code**
3. **G-code tab** → click **Export G-code**

---

## Wave tab — 3D audio visualizer

Captures audio at configurable fps and renders it as 3D geometry through your choice of shape. Once recording is done, the current camera perspective is applied and the visible paths are projected to 2D for export.

### Shapes (15 built-in)

| Shape | Description |
|---|---|
| **Linear** | Stacked horizontal wave rows (Joy Division style) |
| **Circular** | Concentric rings; amplitude modulates radius |
| **Spiral** | All frames joined into one continuous outward spiral |
| **Lissajous** | Left vs right channel XY scatter/trace |
| **Terrain** | Horizon-masked ridges with depth occlusion |
| **Landscape** | Terrain with opaque fill polygons and crest lines |
| **Harmonograph** | DFT-derived two-pendulum curve with damping |
| **Moiré** | Two offset ring families producing interference fringes |
| **Heatmap** | Frequency spectrogram grid; amplitude → circle radius |
| **Quantized Noise** | Joy Division ridges snapped to 8 discrete bands with hatched gap regions |

Additional shapes can be installed at runtime via the [Visualization Plugin API](docs/viz-plugin-api.md).

### Source options

**Noise Generator** (no microphone needed) — Perlin fBm, Sine Sum, or White Noise; seeded and fully reproducible.

**Microphone** — live audio via Web Audio API.

### Export

- **Pattern → G-code** — monoscopic; projects current camera view to A4 paper
- **Pattern → Stereo** — anaglyph two-pass file for red-cyan 3D glasses; `M0` pause between passes

---

## G-code tab — preview, export & image tracing

### Preview & playback

- 2D canvas preview with zoom/pan
- **Playback animation** — plays G-code frame-by-frame showing pen-up (dashed grey) and pen-down (cyan) moves with a live red dot cursor
- **Optimize toggle** — reorders paths with nearest-neighbour sort to minimize travel; shows % travel saved

### Export

Downloads a GRBL-formatted `.gcode` file. Includes:
- Paper dimensions and plot area as comments
- Full generation parameter snapshot (algorithm, all param values) as comments
- Aspect-ratio-preserving NDC → A4 mapping (10 mm margins)
- Deterministic three-word filename derived from all generation parameters

### Image to G-code

Convert raster images to plottable vector paths:

1. Upload a JPEG/PNG
2. Adjust **Threshold**, **Simplify**, **Smooth**, **Fill mode**, and **Shade levels**
3. Preview updates live; click **Apply** to send paths to the G-code canvas

**Multi-pass shading**: up to 4 brightness bands, each separated by `M0` for a manual pen swap — enables simulated grayscale with different ink densities.

---

## Serial tab — plotter connection

Streams G-code to a GRBL plotter via USB Serial (Chrome/Edge only; requires HTTPS or localhost).

### Machine commands

| Button | Description |
|---|---|
| **Home** | GRBL homing cycle (`$H`) |
| **Zero X,Y** | Set current position as origin |
| **Pen Up / Down** | Move to configured Z/servo positions |
| **Frame** | Trace plot bounding box with pen raised |
| **Jog** | Manual head movement (X/Y/Z, 0.1–10 mm steps) |
| **Cal** | Draw Y-calibration marks for servo compensation |

---

## Gen Art tab — generative art

Generates mathematical art as 2D plotter paths from 10 built-in algorithms.

### Built-in algorithms

| Algorithm | Description |
|---|---|
| **Reaction Diffusion** | Gray-Scott simulation; presets: Spots, Maze, Fingerprints, Coral |
| **Noise Contours** | Perlin noise iso-contours |
| **Cyclic CA** | Cyclic cellular automaton boundaries |
| **Superformula** | Gielis polar superformula |
| **L-System** | Hilbert, Moore, Gosper, Peano space-filling curves |
| **Strange Attractors** | Lorenz, Rössler, Dadras, Chen, … |
| **Harmonograph** | Damped two-pendulum parametric curves |
| **Spirograph** | Hypo/epi-cycloid with ellipse stretch, multi-layer, guide overlay |
| **Julia Set Contours** | Julia set iso-contours at configurable c values |
| **Space Filling** | L-system turtle graphics |

Custom algorithms can be installed at runtime via the [GenArt Plugin API](docs/genart-plugin-api.md).

### Workflow

1. Select an algorithm and adjust parameters in the sidebar
2. Click **Generate** (or enable **Auto-generate** for live updates)
3. Click **Send to G-code** to export to the G-code tab

---

## Documentation

| Doc | Audience | Description |
|---|---|---|
| [User Guide](docs/user-guide.md) | Users | Full feature walkthrough, tab by tab |
| [GenArt Plugin API](docs/genart-plugin-api.md) | Developers | How to write and install custom generative art algorithms |
| [Visualization Plugin API](docs/viz-plugin-api.md) | Developers | How to write and install custom 3D visualization shapes |
| [Architecture](docs/architecture.md) | Contributors | Codebase structure, coordinate systems, key modules |

---

## Development

```bash
npm run dev      # Start dev server
npm run lint     # ESLint
npm run check    # svelte-check (JSDoc type checking)
npm test         # Playwright end-to-end tests
npm run build    # Production build
```

**Commits must be GPG-signed.** See [Architecture](docs/architecture.md#contributing) for the full contributing guide.

---

## Stack

- [Svelte 5](https://svelte.dev) + [Vite 8](https://vitejs.dev)
- [Three.js 0.183](https://threejs.org)
- [Playwright](https://playwright.dev) for testing
- Web Audio API, Web Serial API
