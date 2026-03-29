# Audio Wave Visualizer → G-code

A real-time audio visualization tool that generates pen-plotter G-code from sound. Feed it a microphone or an algorithmic noise signal, record a few seconds, orbit the 3D scene to frame your composition, and export directly to G-code for an AxiDraw or compatible plotter.

---

## What it does

Audio is captured at 10 fps and projected through one of fifteen visualization shapes into a Three.js 3D scene. Once recording stops, the current camera view is applied to the scene as a perspective projection, and the visible geometry is exported as G-code with correct aspect-ratio mapping to A4 paper (no stretch, no distortion). Anaglyph stereo export generates a two-pass file for red-cyan 3D glasses.

---

## Quick start

```
npm install
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5174`).

1. Choose **Source** (Noise Generator for no microphone) and **Shape**
2. Click **Record** — captures up to Max Frames at the configured fps, auto-stops
3. Orbit the 3D view (left drag = orbit, right drag = pan, scroll = zoom)
4. Click **Pattern → G-code**, then switch to the **G-code** tab
5. Click **Export G-code** — downloads a `.gcode` file ready for your plotter

---

## Shapes

Fifteen visualization modes, each mapping audio frames to a different 3D geometry.

| Shape | Description |
|---|---|
| **Linear** | Stacked horizontal wave rows in Z — the classic Joy Division look |
| **Circular** | One concentric ring per frame; amplitude modulates the radius |
| **Spiral** | All frames joined into a single continuous outward spiral |
| **Lissajous** | Left vs right channel XY plot; one curve per frame |
| **Terrain** | Horizon-occluded ridges viewed in perspective (Joy Division with depth) |
| **Landscape** | Terrain with opaque black fill polygons and perpendicular crest lines |
| **Harmonograph** | DFT-derived two-pendulum parametric curve with exponential damping |
| **Moiré** | Two offset families of concentric rings producing interference fringes |
| **Heatmap** | Frequency spectrogram grid; amplitude controls circle radius per cell |
| **Quantized Noise** | Joy Division ridges with amplitudes snapped to 8 discrete bands; the three largest sky-gap regions are filled with colored hatch lines |

---

## Source options

**Noise Generator** (default) — no microphone needed; fully algorithmic and reproducible.

| Type | Description |
|---|---|
| Perlin fBm | 2D Perlin noise scrolling over time; configurable octaves and persistence |
| Sine Sum | Sum of seed-derived harmonics with random frequency ratios and phase offsets |
| White Noise | xorshift32 PRNG; fast and maximally random |

All three are seeded — the same seed and parameters always produce an identical signal and an identical plot.

**Microphone** — live audio from `getUserMedia`; analysed via Web Audio API `AnalyserNode`.

---

## Export

### G-code (monoscopic)

Projects all recorded geometry through the current camera view to NDC coordinates, then maps to A4 (210×297 mm, 10 mm margins). The mapping is **aspect-ratio preserving** — the viewport is inscribed into the plot area with a contain-fit, so a widescreen composition plots correctly without vertical stretching.

### Anaglyph (stereoscopic)

Shifts the camera ±0.325 units along its right vector to generate separate left-eye and right-eye projections. Outputs a single G-code file with two passes separated by `M0` (pause): draw pass 1 in red, swap pen, draw pass 2 in cyan. View through red-cyan glasses.

### Filenames

Filenames are three words derived deterministically from all generation parameters (shape, source, noise type, seed, camera position, all settings) via a djb2 hash fed into an LCG:

```
waveform-amber-ridge-pulse.gcode
waveform-amber-ridge-pulse-anaglyph.gcode
```

Same parameters → same filename every time, making plots easy to catalogue and re-generate. All parameters are also written as `; key: value` comments at the top of every exported file.

---

## Advanced controls

Hidden behind **Advanced ▸** to keep the default view simple.

| Control | Description |
|---|---|
| Data mode | Time (raw waveform), Frequency (FFT magnitudes), Stereo (L+R) |
| Noise type / Seed / Speed / Frequency / Octaves / Persistence | Noise generator tuning |
| Max Frames | Recording length (8–256 frames at 10 fps) |
| Amp Scale | Vertical exaggeration of amplitude |
| Speed (mm/min) | Plotter feed rate in the G-code (does not affect the preview) |
| FFT Size | Audio analysis window size; higher = more frequency detail |
| Cam Pos / Target | Current camera coordinates; paste back and click Set to restore a saved view |

---

## Playback

The G-code tab has a **Play** button that animates the pen path on the 2D preview canvas:
- Pen-up travel moves appear as dashed grey lines
- Pen-down draw moves appear in cyan
- The current pen position is marked with a red dot

Use the **Speed** slider to control how fast the animation runs. Click **Reset** to clear the trace and return to the static path view.

---

## Project history

### Origin: wave rows and G-code

The project started as a straightforward linear waveform recorder — capture audio frames, stack them in Z, project through a camera, and write out G-code. The initial four shapes were **Linear**, **Circular**, **Spiral**, and **Lissajous**. The G-code pipeline established the pattern used throughout: record → orbit → project → export, with a clean separation between the Three.js scene and the G-code generator.

### Phase 2: new shapes

The scope expanded to explore different mathematical and perceptual forms. Three shapes from this phase remain:

- **Terrain** — the first shape to introduce a *horizon masking* algorithm: process frames front-to-back, maintain a per-column maximum screen-Y, and emit only segments that clear the current horizon
- **Harmonograph** — DFT analysis of the averaged spectrum feeds pendulum frequencies into a damped parametric curve; the curve changes character with the audio content
- **Moiré** — two offset families of concentric rings; the offset drifts per frame to produce evolving fringe patterns

The architecture split shapes into *per-frame additive* (append one object) and *rebuild-all* (reconstruct the full scene on each new frame), driven by a `REBUILD_ALL_SHAPES` set.

Anaglyph stereo export was added alongside: camera is offset left and right along its right vector to produce two independent projections, exported as a single two-pass G-code file.

### Landscape: fills and perpendicular lines

The **Landscape** shape extended Terrain with opaque `THREE.ShapeGeometry` fill polygons rendered in the scene background colour, achieving the layered-silhouette magazine-cover look. `polygonOffset` pushes the fills slightly behind their wave stroke so lines always win the depth test.

### Perspective-correct horizon masking

The original terrain horizon algorithm compared world-space Y values — a reasonable approximation for an overhead camera but incorrect for oblique angles. This was replaced with a full perspective-correct approach: the camera's VP matrix projects each world point to NDC, a 512-bucket horizon buffer tracks the maximum NDC-Y per screen-column, and linear interpolation fills any gaps between consecutive projected points. The result handles any camera angle, including strongly oblique views where the horizon line vanishes toward a perspective point.

### Noise generator and controls

The noise source was built to be a drop-in replacement for the microphone path, implementing the same `getFrame(mode)` API. Three generator types — **Perlin fBm**, **Sine Sum**, and **White Noise** — share a common seeding strategy using xorshift32, making them fully reproducible. UI controls for type, seed, speed, frequency, octaves, and persistence were exposed first in the main panel and later moved to the Advanced section.

### UI simplification: Advanced panel and help modal

As the number of controls grew, the UI was restructured: only **Source** and **Shape** remain in the default view; everything else collapses behind an **Advanced ▸** toggle. A `?` button opens a scrollable help modal documenting all shapes, all controls, the export workflow, and camera usage.

### Camera state and reproducibility

Making plots reproducible required tracking the camera. `getCameraState()` and `setCameraState()` were added to read and restore the camera position and OrbitControls target. The Advanced panel gained live-updating position and target inputs, updated every ~30 frames when not focused, with a **Set** button (or Enter key) to apply.

### Filenames and G-code metadata

Early exports used the shape name and seed in the filename. This was later replaced by two changes: all generation parameters moved into the G-code file as `; key: value` header comments, and the filename became a stable three-word hash derived from all parameters — same settings, same name. The hash uses djb2 on a pipe-delimited parameter string, seeded into an LCG to pick three words from a 128-word vocabulary. Anaglyph exports append `-anaglyph` before the extension.

### Aspect-ratio correct export

The G-code projector initially mapped NDC x to the full plot width (190 mm) and NDC y to the full plot height (277 mm) independently, causing a 1.46× vertical stretch on A4 portrait paper. This was first corrected with a uniform square scale, then further refined to read the camera's actual viewport aspect ratio (`camera.aspect`) and apply a **contain-fit**: if the viewport is wider than A4, x fills the plot width and y is scaled proportionally; if taller, y fills the plot height. The exported G-code now faithfully reproduces the browser view at plottable scale.

### Svelte 5 + Vite migration

The original single-file vanilla JS app was migrated to a Svelte 5 + Vite project for better state management and component isolation. All three modules (WaveRecorder, GcodeHandler, SerialTransmission) are always-rendered (CSS-toggled, never `{#if}`-unmounted) to preserve live Three.js and AudioContext state across tab switches.

### Heatmap and playback

The **Heatmap** shape added a spectrogram view: samples are grouped into frequency bins per frame and drawn as amplitude-scaled circles on a flat XZ grid — similar to a vinyl record grid viewed from above.

The **Play** feature in the G-code tab animates the pen path: it builds a flat sequence of travel/draw segments, then traces them frame-by-frame with a `requestAnimationFrame` loop, drawing pen-up moves as dashed grey and pen-down moves as cyan with a red dot at the current head position.

### Quantized Noise

The **Quantized Noise** shape quantizes each frame's amplitude to 8 discrete bands (`QUANT_STEP = 4·ampScale / 8`), producing stepped staircase ridge profiles instead of smooth curves. Points below the minimum threshold snap to y=0, creating flat zero corridors. After building all ridges, the three largest sky-gap regions (measured by area between adjacent ridge pairs) are detected and filled with colored accent layers — amber, rose, and teal — both as `THREE.Mesh` fills in the 3D view and as exported horizontal hatch lines in G-code.

---

## File structure

```
index.html                    App entry point
src/
  main.js                     Svelte 5 mount entry
  App.svelte                  App shell — tab bar and help modal
  modules/
    WaveRecorder.svelte        3D visualizer, shape + source controls, recording
    GcodeHandler.svelte        G-code 2D preview, export, import, playback animation
    SerialTransmission.svelte  GRBL serial connection, jog controls, pen calibration
  stores/
    settings.js                Persistent settings (Svelte writable store)
    wave.js                    Recording state (appState, frameCount)
    gcode.js                   Active paths, stereo paths, export params
    serial.js                  Serial port connection state
    ui.js                      Active tab
  lib/
    visualizer.js              Three.js scene — all 15 shape builders, camera projection
    gcode.js                   G-code generation, NDC→paper mapping, filename hash
    noise.js                   Algorithmic noise source (Perlin, Sine, White)
    audio.js                   Web Audio API microphone wrapper
    recorder.js                Frame capture and storage
tests/
  smoke.test.js                Playwright smoke tests
```

---

## Dependencies

- [Three.js](https://threejs.org/) 0.169.0 — 3D rendering, geometry, OrbitControls (via npm)
- [Svelte](https://svelte.dev/) 5 — component framework
- [Vite](https://vitejs.dev/) 5 — dev server and bundler
- Web Audio API — built into all modern browsers
- [Playwright](https://playwright.dev/) — browser automation for smoke tests
