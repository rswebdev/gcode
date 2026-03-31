# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.1] - 2026-03-31

### Features
- **Documentation**: Added `docs/user-guide.md`, `docs/genart-plugin-api.md`, `docs/viz-plugin-api.md`, and `docs/architecture.md`; rewrote `README.md` to cover all four tabs and link to the new docs.

### Tooling
- **generate:docs**: New `npm run generate:docs` script (`scripts/generate-docs.sh`) syncs `docs/` and `README.md` to the GitHub wiki on each release; prints actionable setup instructions if the wiki is not yet enabled.

## [1.7.0] - 2026-03-31

### Features
- **Generative Art tab**: New dedicated tab with 10 built-in math-art and fractal generators — spirograph (hypo/epi-cycloid with ellipse stretch and guide overlay), harmonograph, strange attractors, L-system space filling (Hilbert, Moore, Gosper, Peano), Julia set contours, noise contours, reaction-diffusion, cyclic cellular automata, and superformula.
- **GenArt plugin system**: Users can install custom JavaScript plugins (via paste or file) that integrate with the same param UI and G-code export pipeline; includes deep param validation on install.
- **Voronoi Cells example plugin**: Stratified-jitter seeds, Lloyd relaxation, Sutherland-Hodgman clipping, and edge deduplication produce organic foam-cell patterns ready to plot.
- **Spirograph guide overlay**: Background overlay shows the outer/inner ellipses and pen arm at the current parameter state; guide updates live as sliders change.

### Bug Fixes
- **Path sort origin**: Nearest-neighbour sort now seeds from NDC (−1, −1) — the machine home corner — so the first pen move is minimised; single-path algorithms also reverse if the tail is closer to home.
- **Segment deduplication**: `_sortPaths` removes duplicate line segments before sorting, preventing double-traces on Voronoi and other shared-edge outputs.
- **Spirograph normalisation**: `_normScale` uses `|R−r|+dMax` (instead of `R−r+d`), fixing overflow when `r > R` and correctly bounding multi-layer curves where `_dValues` yields up to `1.3d`.
- **Stale art on plugin removal**: Removing a plugin now clears the canvas and `currentPaths` immediately instead of leaving the previous artwork visible.
- **Param defaults merge**: Re-installing a plugin under the same id now merges new param defaults with stored values, adding defaults for new keys and dropping removed ones.
- **G-code metadata sanitisation**: `_writeParams` strips embedded newlines from label and value strings before writing G-code comments.
- **Voronoi param clamps**: `margin=0` is now honoured (was coerced to `0.05` by `||`); `count` lower bound raised to `5` to match the declared param minimum.
- **L_CAP truncation**: `lsExpand()` returns `{result, truncated}`; callers throw a clear error rather than silently plotting a prefix; `CURVE_MAX_ORDER` prevents invalid orders in the UI.
- **Plugin param validation**: Loader now validates each param's `id` (unique, non-empty), `type` (must be a renderer-supported type), and type-specific required fields.

## [1.6.1] - 2026-03-30

### Bug Fixes
- **pluginLoader hardening**: `_load()` validates that localStorage contains an array of well-formed entries; `installPlugin` and `restorePlugins` reject IDs that collide with built-in shapes; `uninstallPlugin` persists the new list before calling `unregisterPlugin` to prevent in-memory/storage drift on save failure; failed restore entries are pruned from storage instead of retried forever.
- **Security note**: Added comment to `_importCode` documenting that plugin execution is intentionally unsandboxed for local use, with a described migration path for any future hosted deployment.

### Tooling
- **CodeQL**: Added GitHub Actions CodeQL analysis workflow and updated dependencies.

## [1.6.0] - 2026-03-29

### Bug Fixes
- **Import Image dialog a11y**: Added `tabindex="-1"` to the dialog overlay and `for`/`id` pairs to range-input labels, resolving all Svelte a11y accessibility warnings.

### Features
- **Visualization plugin system**: Visualizations are now plugin-based; `visualizer.js` exposes `registerPlugin`/`unregisterPlugin`/`getPlugins` so any shape can be added without modifying core code.
- **Runtime plugin installation**: Users can paste or load a `.js` file to install custom visualization plugins at runtime; plugins persist across reloads via localStorage and can be removed from the Plugins panel in the Wave Recorder tab.

## [1.5.0] - 2026-03-29

### Features
- **Image → Vektor → G-code**: Neues Dialog-Fenster im G-code-Tab zum Importieren von Rastergrafiken; Konturverfolgung via Marching Squares, RDP-Vereinfachung und Catmull-Rom-Glättung erzeugen saubere Pfade.
- **Füll- und Schattierungsstrategien**: Vier Füllmuster (Horizontal, Vertikal, Diagonal, Kreuzschraffur, Stipple) mit konfigurierbarem Abstand; bis zu 4 Helligkeitsbänder für mehrstufige Schattierung.
- **Mehrpass-Schattierung mit M0-Pause**: Jedes Schattierungsband wird als separater G-code-Block mit vorausgehendem `M0`-Befehl ausgegeben, damit der Stift vor jedem Durchgang gewechselt werden kann.
- **Pfad-Sortierung im Druck**: Konturen und Schattierungspfade werden per Nächster-Nachbar-Sortierung optimiert, um Leerfahrten zu minimieren; optionaler Vorschaumodus zeigt die prozentuale Einsparung.
- **Mehrstufige Wiedergabe**: Wiedergabe animiert Konturen und Schattierungsdurchgänge nacheinander, stoppt an M0-Stellen und wartet auf manuelles Fortsetzen (Continue-Schaltfläche).
- **Feeds-basierte Abspielgeschwindigkeit**: Wiedergabegeschwindigkeit richtet sich nach dem konfigurierten Vorschub (mm/min) multipliziert mit einem frei wählbaren Faktor (0,25 ×–8 ×); Leerfahrten laufen mit 5× Vorschub.
- **Pan & Zoom auf Vorschauflächen**: Beide Vorschaucanvasse (G-code-Viewer und Bildimport-Dialog) unterstützen jetzt Mausrad-Zoom zum Cursor sowie Ziehen zum Verschieben; ⊡-Schaltfläche setzt Zoom und Versatz zurück.
- **Serielle Steuerung erweitert**: Neue Schaltflächen „Connect", „Reconnect", „Unlock ($X)", „Pen Up + Home" und „Continue (~)" im Serielltab; „Sweep S"-Schaltfläche entfernt.

### Bug Fixes
- **Seriell-Monitor GC**: Log-Ringpuffer mit O(1)-Append und stabilen DOM-Schlüsseln verhindert vollständiges Neu-Rendern bei jeder neuen Zeile.
- **Schattierung in Wiedergabe**: Schattierungsdurchgänge werden in der korrekten Reihenfolge animiert statt als statischer Hintergrund dargestellt.
- **Abspielgeschwindigkeit**: Regler-Bereich von 1–50 (linear) auf 0,25 ×–8 × (multiplikativ) geändert – keine Überempfindlichkeit mehr am oberen Ende.

## [1.4.0] - 2026-03-29

### Removed
- **5 shapes dropped**: Tube, Phyllotaxis, Flow Field, Epicycles, and Chladni removed from the shape selector, visualizer, help modal, and source-defaults table.

### Fixed
- **Heatmap plotter output**: All circles were collected into a single `THREE.LineSegments` object. `getProjectedPaths()` treated the flat vertex buffer as a continuous polyline, creating diagonal pen-down connections between every adjacent arc-segment pair. Each circle is now emitted as its own closed `THREE.Line`.
- **Lissajous plotter output**: Frames traced an open parametric curve (512 samples, 1.5 sine cycles) so the last vertex was geometrically distant from the first, causing a diagonal gap stroke on the plotter. Each frame now appends a closing vertex equal to its first point.

## [1.3.1] - 2026-03-28

### Tooling
- **ESLint + svelte-check**: Added `npm run lint` (ESLint with `eslint-plugin-svelte`) and `npm run check` (svelte-check) quality scripts; fixed 10 pre-existing lint errors (empty catch blocks, missing `{#each}` keys, false-positive reactive loop).
- **Playwright smoke tests**: New `tests/smoke.test.js` with 11 browser smoke tests covering page load, tab switching, help modal, shape selector completeness, and source selector.
- **GPLv3 license**: Added `LICENSE` file.
- **README overhaul**: Updated quick start to `npm install && npm run dev`, expanded shapes table, updated file structure to reflect Svelte 5 layout, documented Playback and Quantized Noise features.

## [1.3.0] - 2026-03-27

### Features
- **Quantized Noise shape**: New visualization where wave amplitudes are snapped to 8 discrete bands, producing stepped staircase ridge profiles. Points below the minimum threshold snap to y=0. The three largest sky-gap regions between adjacent ridges are detected and highlighted with colored accent fills (amber, rose, teal) in the 3D preview and exported as horizontal hatch lines in G-code.

## [1.2.0] - 2026-03-27

### Bug Fixes
- **Joy Division circles in export**: `THREE.LineSegments` (decorative amplitude circles) were passing through the landscape path filter and appearing as plotter paths; now only `THREE.Line` wave strokes are projected.
- **Joy Division coordinate clamping**: Projected paths were clamped to paper margins, turning out-of-bounds wave segments into flat lines at the paper edge. Clamping is now opt-in (`frameGCode` only) so landscape paths extend freely beyond the plot area.

### Features
- **Playback animation**: New Play/Pause/Reset controls in the G-code viewer animate through all paths, showing pen-down draws in cyan and pen-up travels as dashed grey lines with a red dot at the current pen position. A speed slider and live move/lift counter are included.
- **Show/hide tool path**: Checkbox in G-code Settings to toggle the tool path overlay on the preview canvas.

## [1.1.0] - 2026-03-27

### Added
- **Paper size selector**: G-code preview and export now support A4 Portrait/Landscape, A3 Portrait/Landscape, and Letter Portrait/Landscape via a dropdown; paper dimensions thread through to the generated G-code for WYSIWYG output.
- **WYSIWYG plot scale**: Plot Scale (0.05–5) now scales both the canvas preview and the exported G-code identically.
- **Origin marker**: X0,Y0 crosshair rendered at the plotter home corner of the preview canvas.
- **1 cm grid lines**: Subtle 10 mm guide lines drawn across the preview canvas for visual measurement.
- **Diagnostic test pattern**: "Test Pattern" button now generates a plot-area border, centre cross, L-mark at the origin, 50 mm scale ticks along both edges, and a diagonal — sufficient to verify coordinate system, axis orientation, and scale without a full wave recording.
- **Pen settings in Serial tab**: Pen mode, Up/Down Z and servo values are now editable in the Serial tab; the G-code tab displays them read-only.
- **CoreXY gcode setting**: New "CoreXY gcode" checkbox in the Plot panel applies the A=X+Y / B=X−Y motor transform to generated G-code, independent of the jog "CoreXY" toggle.

### Fixed
- **Mirrored Y-axis**: Preview canvas was rendering paths upside-down; `toCanY` now correctly flips plotter Y (origin at home/bottom) to canvas Y (origin at top).
- **Margin boundary after Y-flip**: Plot area dashed rectangle was drawn at the top of the canvas instead of the bottom after the Y-axis correction.
- **CoreXY double-transform**: When "CoreXY" was enabled for jog, it was also applied to G-code output, causing a 45° rotation and out-of-bounds moves that triggered GRBL alarms.
- **Gcode streaming timeout**: Per-line timeout now scales with estimated move execution time (5× for G1, 3× carry-forward for G4/M3 that must wait for the planner to drain), preventing false timeouts on long moves or synchronous G4 dwells.

## [1.0.0] - 2026-03-27

### Added
- **Three-module tabbed layout**: App restructured into Wave Recording, G-code Handling, and Serial Transmission tabs — all always-rendered via CSS to keep Three.js canvas, AudioContext, and Web Serial alive across tab switches.
- **G-code 2D preview**: Canvas 2D plotter preview in the G-code tab showing NDC paths letterboxed onto an A4 paper outline with zoom support.
- **Cross-module reactive stores**: Svelte writable stores for settings, wave state, G-code paths, serial state, and active tab enable clean data flow between modules.
- **Inline serial monitor**: Toggleable monitor panel in the Serial tab with command history (arrow key navigation) and auto-scroll.
- **Favicon**: Inline SVG waveform favicon to suppress browser 404 requests.
- **Playwright**: Added as dev dependency for browser-based debugging and diagnostics.

### Changed
- **Framework migration**: Rewritten from vanilla JS to Svelte 5 + Vite. Entry point uses the Svelte 5 `mount()` API. Original `src/*.js` library files moved unchanged to `src/lib/`.
- **Three.js import**: Switched from CDN importmap to npm package (`three@^0.169`).

### Fixed
- **Reactive loop in G-code tab**: `afterUpdate(() => redraw())` caused `effect_update_depth_exceeded` by firing after every reactive update. Replaced with a single `$:` reactive statement and `onMount` for the initial draw.
- **Broken `$:` comma expression**: `$: if (previewCanvas && $settings.offsetX, $settings.offsetY)` did not correctly track `offsetY` due to JS comma-operator precedence.
- **Build errors**: Added `<tbody>` wrappers inside all `<table>` elements (Svelte 5 HTML validity requirement); fixed invalid `on:wheel|passive={false}` directive syntax to `on:wheel|nonpassive|preventDefault`.

## [0.8.0] - 2026-03-27

### Added
- **G-code import**: Load an existing `.gcode` file to preview and re-send; mm paths converted to NDC for the store.
- **Test pattern**: Generate a calibration grid pattern directly from the UI without a recording.

## [0.7.0] - 2026-03-25

### Added
- **Web Serial / GRBL**: Full Web Serial API wrapper for GRBL controller communication at 115200 baud — line-by-line streaming with `ok` acknowledgement, soft-reset (0x18), jog with CoreXY and Swap X/Y support, pen up/down, servo sweep, calibration sweep, and frame trace.

## [0.6.0] - 2026-02-24

### Added
- **Record FPS**: Configurable frames-per-second capture rate (1–30) for wave recording.
- **Smoothing**: Adjustable frequency-mode averaging coefficient (0–0.95) for microphone input.
- **Post-recording adjustment**: Amplitude scale and other parameters can be tweaked after recording without re-capturing.

## [0.5.0] - 2026-02-24

### Added
- **Settings persistence**: All parameters auto-saved to `localStorage` and restored on reload.
- **Per-combination presets**: Save and clear a preset per source × shape combination, with a visual indicator when a custom preset is active.
- **Per-source × shape defaults**: Built-in sensible default parameters for each of the 14 shapes across both sources.
- **Camera reset**: Button to restore the camera to the default position for the current shape.

## [0.4.0] - 2026-02-22

### Added
- **Camera controls**: OrbitControls (left drag orbit, right drag pan, scroll zoom) with live Cam Pos / Target display and a Set button for restoring saved views.
- **G-code export**: Export current wave projection as a GRBL-compatible `.gcode` file.
- **Deterministic filenames**: Export filenames are three-word names derived from generation parameters — same settings always produce the same name.
- **Aspect ratio**: Camera aspect ratio stored alongside projected paths for accurate paper-coordinate mapping on export.
- **Help modal**: Overlay documenting all controls, shapes, and workflow; dismissible with Escape.
- **README**: Full project description with usage instructions and shape reference.

## [0.3.0] - 2026-02-22

### Added
- **Landscape shape**: Terrain ridges with opaque filled passes and cross-lines (Joy Division style).
- **Terrain improvements**: Perspective-correct horizon masking and improved visibility checks for occluded ridges.

## [0.2.0] - 2026-02-21

### Added
- **Noise generator**: Algorithmic audio source (Perlin fBm, Sine Sum, White Noise) with seed, speed, frequency, octaves, and persistence controls — no microphone required.

## [0.1.0] - 2026-02-22

### Added
- **Initial release**: Audio Wave Visualizer → G-code. Captures microphone input via the Web Audio API and renders live wave geometry in Three.js across 14 shapes: Linear, Circular, Spiral, Lissajous, Phyllotaxis, Tube, Terrain, Harmonograph, Flow Field, Epicycles, Chladni, Moiré, and Heatmap.

[Unreleased]: https://github.com/user/gcode-wave-visualizer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/user/gcode-wave-visualizer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/user/gcode-wave-visualizer/releases/tag/v0.1.0
