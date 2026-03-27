<script>
  import { afterUpdate } from 'svelte';
  import { get } from 'svelte/store';
  import { settings } from '../stores/settings.js';
  import {
    activePaths, stereoPaths, cameraAspect, exportParams,
    importedPathCount, hasPlottablePaths,
  } from '../stores/gcode.js';
  import { appState } from '../stores/wave.js';
  import * as gcode from '../lib/gcode.js';

  let previewCanvas;
  let fileInput;
  let zoomLevel = 1;

  // Paper dims (mm) from gcode.js constants (mirrored here)
  const PAPER_W = 210, PAPER_H = 297, MARGIN = 10;
  const PLOT_W  = 190, PLOT_H  = 277;
  const CENTER_X = 105, CENTER_Y = 148.5;

  function ndcScales(aspect) {
    const paperAspect = PLOT_W / PLOT_H;
    let sx, sy;
    if (aspect >= paperAspect) { sx = PLOT_W / 2; sy = sx / aspect; }
    else                       { sy = PLOT_H / 2; sx = sy * aspect; }
    return { sx, sy };
  }

  // ---------------------------------------------------------------------------
  // Canvas 2D preview
  // ---------------------------------------------------------------------------
  function redraw() {
    if (!previewCanvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = previewCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    previewCanvas.width  = rect.width  * dpr;
    previewCanvas.height = rect.height * dpr;

    const ctx = previewCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, W, H);

    // Paper area (portrait A4, letterboxed with padding)
    const pad = 24;
    const paperAspect = PAPER_W / PAPER_H;
    let paperW, paperH;
    const availW = W - 2 * pad, availH = H - 2 * pad;
    if (availW / availH >= paperAspect) {
      paperH = availH;
      paperW = paperH * paperAspect;
    } else {
      paperW = availW;
      paperH = paperW / paperAspect;
    }

    const paperLeft = (W - paperW) / 2;
    const paperTop  = (H - paperH) / 2;

    // Zoom transform around center
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoomLevel, zoomLevel);
    ctx.translate(-W / 2, -H / 2);

    // Paper background + border
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(paperLeft, paperTop, paperW, paperH);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(paperLeft, paperTop, paperW, paperH);

    // Plot area boundary (MARGIN inset)
    const marginFracX = MARGIN / PAPER_W;
    const marginFracY = MARGIN / PAPER_H;
    ctx.strokeStyle = '#333';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      paperLeft  + marginFracX * paperW,
      paperTop   + marginFracY * paperH,
      paperW * PLOT_W / PAPER_W,
      paperH * PLOT_H / PAPER_H,
    );
    ctx.setLineDash([]);

    // Map NDC → canvas coords  (Three.js: ny=+1 = top of viewport)
    // NDC ±1 maps to the plot area (MARGIN..PAPER-MARGIN in mm)
    const s = get(settings);
    const aspect = get(cameraAspect) || 1;
    const { sx, sy } = ndcScales(aspect);
    const offsetX = +s.offsetX || 0;
    const offsetY = +s.offsetY || 0;

    // mm → canvas pixel
    const toCanX = (mmX) => paperLeft + (mmX / PAPER_W) * paperW;
    const toCanY = (mmY) => paperTop  + (mmY / PAPER_H) * paperH;

    // NDC → mm  (matching gcode.js _ndcToPaper)
    // py = CENTER_Y + ny*sy + offsetY  (note: no Y flip — Three.js Y-up maps to plotter Y-up)
    // But canvas Y-down, paper Y measured from top:
    //   plotter Y increases AWAY from home (i.e. up the page in "canonical" view)
    //   for the preview we'll just show paper with Y=0 at top
    const ndcToMmX = (nx) => Math.max(MARGIN, Math.min(MARGIN + PLOT_W, CENTER_X + nx * sx + offsetX));
    const ndcToMmY = (ny) => Math.max(MARGIN, Math.min(MARGIN + PLOT_H, CENTER_Y + ny * sy + offsetY));

    const paths = get(activePaths);
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth   = 0.8;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    for (const path of paths) {
      if (path.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const { nx, ny } = path[i];
        const cx = toCanX(ndcToMmX(nx));
        const cy = toCanY(ndcToMmY(ny));
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    ctx.restore();

    // Zoom indicator
    if (zoomLevel !== 1) {
      ctx.fillStyle = '#555';
      ctx.font = '11px monospace';
      ctx.fillText(`${Math.round(zoomLevel * 100)}%`, W - 46, H - 8);
    }
  }

  // Redraw whenever paths or settings change
  $: if (previewCanvas && $activePaths) { redraw(); }
  $: if (previewCanvas && $cameraAspect) { redraw(); }
  $: if (previewCanvas && $settings.offsetX, $settings.offsetY) { redraw(); }

  afterUpdate(() => { redraw(); });

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevel = Math.max(0.25, Math.min(8, zoomLevel * delta));
    redraw();
  }

  function resetZoom() { zoomLevel = 1; redraw(); }

  // ---------------------------------------------------------------------------
  // Import G-code
  // ---------------------------------------------------------------------------
  let statusText  = '';
  let statusClass = '';

  function onImportClick() { fileInput.click(); }

  async function onFileChange() {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const { paths, stats } = gcode.parseGCodePaths(content);
      if (paths.length === 0) {
        statusText = 'No drawable G1 XY paths found'; statusClass = '';
        return;
      }
      // For import: paths are already in mm, but the gcode store expects NDC paths.
      // Show them using an identity-ish mapping: mm → NDC via the paper center.
      // Convert mm paths → NDC using inverse of _ndcToPaper (with aspect=1)
      const ndcPaths = paths.map(path =>
        path.map(({ x, y }) => ({
          nx: (x - CENTER_X) / (PLOT_W / 2),
          ny: (y - CENTER_Y) / (PLOT_H / 2),
        }))
      );
      importedPathCount.set(paths.length);
      activePaths.set(ndcPaths);
      stereoPaths.set(null);
      cameraAspect.set(PLOT_W / PLOT_H); // match paper aspect for import
      exportParams.set(null);
      statusText  = `Imported ${paths.length} paths (${stats.draws} draw moves)`;
      statusClass = 'done';
    } catch (err) {
      statusText = `Import failed: ${err?.message ?? err}`; statusClass = 'err';
    } finally {
      fileInput.value = '';
    }
  }

  function onTestPattern() {
    try {
      const content = gcode.generateCalibrationPattern(50, 10, 60, 60);
      const { paths, stats } = gcode.parseGCodePaths(content);
      if (!paths.length) { statusText = 'Test pattern failed'; return; }
      const ndcPaths = paths.map(path =>
        path.map(({ x, y }) => ({
          nx: (x - CENTER_X) / (PLOT_W / 2),
          ny: (y - CENTER_Y) / (PLOT_H / 2),
        }))
      );
      importedPathCount.set(paths.length);
      activePaths.set(ndcPaths);
      stereoPaths.set(null);
      cameraAspect.set(PLOT_W / PLOT_H);
      exportParams.set(null);
      statusText  = `Loaded test pattern: ${paths.length} paths (${stats.draws} draw moves)`;
      statusClass = 'done';
    } catch (err) {
      statusText = `Test pattern failed: ${err?.message ?? err}`; statusClass = 'err';
    }
  }

  // ---------------------------------------------------------------------------
  // Export G-code
  // ---------------------------------------------------------------------------
  function _buildGcodeConfig() {
    const s = get(settings);
    const params = get(exportParams) || {};
    return {
      feedRate:        Math.max(100, Math.min(10000, +s.feedRate || 3000)),
      penDownFeedRate: 300,
      penUpZ:          +s.penUpZ   ?? 5,
      penDownZ:        +s.penDownZ ?? 0,
      penMode:         s.penMode   || 'z',
      penUpS:          +s.penUpS   || 80,
      penDownS:        +s.penDownS || 50,
      penYComp:        +s.penYComp || 0,
      coreXY:          s.jogCoreXY || false,
      offsetX:         +s.offsetX  || 0,
      offsetY:         +s.offsetY  || 0,
      aspect:          get(cameraAspect) || 1,
      params,
    };
  }

  function onExport() {
    const paths = get(activePaths);
    if (!paths.length) return;
    const cfg     = _buildGcodeConfig();
    const content = gcode.projectedPathsToGCode(paths, cfg);
    const params  = get(exportParams) || {};
    gcode.downloadGCode(content, gcode.generateFilename(params));
    statusText = 'G-code exported'; statusClass = 'done';
  }

  function onExportAnaglyph() {
    const stereo = get(stereoPaths);
    if (!stereo) { statusText = 'No stereo paths — use Pattern → Stereo in Wave tab'; statusClass = 'err'; return; }
    const cfg     = _buildGcodeConfig();
    const content = gcode.stereoPathsToGCode(stereo.leftPaths, stereo.rightPaths, cfg);
    const params  = get(exportParams) || {};
    gcode.downloadGCode(content, gcode.generateFilename(params).replace('.gcode', '-anaglyph.gcode'));
    statusText = 'Anaglyph G-code exported'; statusClass = 'done';
  }
</script>

<div class="layout">
  <!-- 2D preview canvas -->
  <div class="preview-area">
    <canvas bind:this={previewCanvas} class="preview-canvas"
            on:wheel|nonpassive|preventDefault={onWheel}></canvas>
    {#if !$hasPlottablePaths}
      <div class="preview-hint">
        Record a wave pattern and click <strong>Pattern → G-code</strong> in the Wave tab,<br>
        or <strong>Import G-code</strong> a file.
      </div>
    {/if}
    <button class="zoom-reset" on:click={resetZoom} title="Reset zoom">⊡</button>
  </div>

  <!-- Settings sidebar -->
  <aside class="settings-panel">
    <!-- Actions -->
    <section>
      <h3>Files</h3>
      <div class="btn-group">
        <button on:click={onImportClick}>Import G-code</button>
        <input type="file" accept=".gcode,.nc,.ngc,.txt" class="file-input" bind:this={fileInput} on:change={onFileChange}>
        <button on:click={onTestPattern}>Test Pattern</button>
      </div>
      <div class="btn-group" style="margin-top:6px">
        <button disabled={!$hasPlottablePaths} on:click={onExport}>Export G-code</button>
        <button disabled={!$hasPlottablePaths} on:click={onExportAnaglyph}>Export Anaglyph</button>
      </div>
      {#if statusText}
        <div class="status {statusClass}">{statusText}</div>
      {/if}
    </section>

    <!-- G-code settings -->
    <section>
      <h3>G-code Settings</h3>

      <label>
        Speed (mm/min)
        <input type="number" min="100" max="10000" step="100"
               value={$settings.feedRate}
               on:change={e => settings.patch({ feedRate: +e.target.value })}>
      </label>
      <label>
        X Offset (mm)
        <input type="number" min="-200" max="200" step="1"
               value={$settings.offsetX}
               on:input={e => settings.patch({ offsetX: +e.target.value })}>
      </label>
      <label>
        Y Offset (mm)
        <input type="number" min="-200" max="200" step="1"
               value={$settings.offsetY}
               on:input={e => settings.patch({ offsetY: +e.target.value })}>
      </label>
      <label>
        Import Scale
        <input type="number" min="0.1" max="10" step="0.1"
               value={$settings.importScale}
               on:change={e => settings.patch({ importScale: +e.target.value })}>
      </label>
    </section>

    <section>
      <h3>Pen</h3>
      <label>
        Pen Mode
        <select value={$settings.penMode}
                on:change={e => settings.patch({ penMode: e.target.value })}>
          <option value="z">Z axis</option>
          <option value="servo">Servo (M3)</option>
        </select>
      </label>
      {#if $settings.penMode === 'z'}
        <label>Pen Up Z
          <input type="number" min="-20" max="20" step="0.5"
                 value={$settings.penUpZ}
                 on:change={e => settings.patch({ penUpZ: +e.target.value })}></label>
        <label>Pen Down Z
          <input type="number" min="-20" max="20" step="0.5"
                 value={$settings.penDownZ}
                 on:change={e => settings.patch({ penDownZ: +e.target.value })}></label>
      {:else}
        <label>Servo Up S
          <input type="number" min="0" max="1000" step="5"
                 value={$settings.penUpS}
                 on:change={e => settings.patch({ penUpS: +e.target.value })}></label>
        <label>Servo Down S
          <input type="number" min="0" max="1000" step="5"
                 value={$settings.penDownS}
                 on:change={e => settings.patch({ penDownS: +e.target.value })}></label>
        <label>Servo Y Comp
          <input type="number" min="-10" max="10" step="0.1"
                 value={$settings.penYComp}
                 on:change={e => settings.patch({ penYComp: +e.target.value })}></label>
      {/if}
    </section>

    <!-- Info -->
    {#if $activePaths.length}
      <section>
        <div class="path-info">
          {$activePaths.length} path{$activePaths.length !== 1 ? 's' : ''}
          {#if $stereoPaths} · stereo{/if}
          {#if $importedPathCount} · imported{/if}
        </div>
      </section>
    {/if}
  </aside>
</div>

<style>
  .layout {
    display: flex;
    height: 100%;
    overflow: hidden;
    background: #0a0a0a;
  }

  .preview-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .preview-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: crosshair;
  }

  .preview-hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: #444;
    font-size: 13px;
    line-height: 1.6;
    pointer-events: none;
  }

  .zoom-reset {
    position: absolute;
    bottom: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 16px;
    opacity: 0.5;
  }
  .zoom-reset:hover { opacity: 1; }

  .settings-panel {
    width: 230px;
    flex-shrink: 0;
    overflow-y: auto;
    padding: 12px;
    border-left: 1px solid #1e1e1e;
    background: #0d0d0d;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  section {
    padding: 8px 0;
    border-bottom: 1px solid #1a1a1a;
  }
  section:last-child { border-bottom: none; }

  h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    margin: 0 0 8px;
  }

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 5px;
    color: #aaa;
    font-size: 12px;
  }

  .btn-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .file-input { display: none; }

  .status { font-size: 11px; margin-top: 6px; }
  .status.done { color: #44bb44; }
  .status.err  { color: #ff6666; }

  .path-info {
    font-size: 11px;
    color: #555;
  }
</style>
