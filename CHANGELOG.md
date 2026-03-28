# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.1] - 2026-03-28

### Tooling
- **ESLint + svelte-check**: Added `npm run lint` (ESLint with `eslint-plugin-svelte`) and `npm run check` (svelte-check) quality scripts; fixed 10 pre-existing lint errors (empty catch blocks, missing `{#each}` keys, false-positive reactive loop).
- **Playwright smoke tests**: New `tests/smoke.test.js` with 11 browser smoke tests covering page load, tab switching, help modal, shape selector completeness (all 15 shapes), and source selector.
- **GPLv3 license**: Added `LICENSE` file.
- **README overhaul**: Updated quick start to `npm install && npm run dev`, expanded shapes table to 15, updated file structure to reflect Svelte 5 layout, documented Playback and Quantized Noise features.

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
