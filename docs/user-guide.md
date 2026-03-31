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

Select from 10 built-in algorithms or any user-installed plugins.

| Algorithm | Description |
|---|---|
| **Reaction Diffusion** | Gray-Scott reaction-diffusion simulation; presets for Spots, Maze, Fingerprints, Coral |
| **Noise Contours** | Perlin noise iso-contours |
| **Cyclic CA** | Cyclic cellular automaton boundaries |
| **Superformula** | Gielis superformula polar curves |
| **L-System** | Lindenmayer-system space-filling curves: Hilbert, Moore, Gosper, Peano |
| **Strange Attractors** | Lorenz, Rössler, Dadras, Chen, and other chaotic attractors |
| **Harmonograph** | Damped two-pendulum parametric curves |
| **Spirograph** | Hypo- and epi-cycloid curves with ellipse stretch and multi-layer support |
| **Julia Set** | Julia set contours at configurable c values and presets |
| **Space Filling** | Hilbert / Gosper / other space-filling L-system curves |

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
