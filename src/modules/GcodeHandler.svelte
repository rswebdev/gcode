<script>
  import { onMount } from 'svelte';
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
  let zoomLevel  = 1;
  let showPaths  = true;

  const MARGIN = 10;

  const PAPER_SIZES = {
    'A4P':  { w: 210, h: 297, label: 'A4 Portrait'      },
    'A4L':  { w: 297, h: 210, label: 'A4 Landscape'     },
    'A3P':  { w: 297, h: 420, label: 'A3 Portrait'      },
    'A3L':  { w: 420, h: 297, label: 'A3 Landscape'     },
    'LTRP': { w: 216, h: 279, label: 'Letter Portrait'  },
    'LTRL': { w: 279, h: 216, label: 'Letter Landscape' },
  };

  // Current paper dims derived from setting
  let paper = PAPER_SIZES['A4P'];
  $: paper = PAPER_SIZES[$settings.paperSize] ?? PAPER_SIZES['A4P'];
  $: paper && redraw();

  function ndcScales(aspect, pw, ph) {
    const plotW = pw - 2 * MARGIN;
    const plotH = ph - 2 * MARGIN;
    const pa = plotW / plotH;
    let sx, sy;
    if (aspect >= pa) { sx = plotW / 2; sy = sx / aspect; }
    else              { sy = plotH / 2; sx = sy * aspect; }
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

    const s = get(settings);
    const pw = paper.w, ph = paper.h;
    const plotW = pw - 2 * MARGIN;
    const plotH = ph - 2 * MARGIN;
    const centerX = MARGIN + plotW / 2;
    const centerY = MARGIN + plotH / 2;

    // Paper area letterboxed with padding
    const pad = 24;
    const paperAspect = pw / ph;
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

    // mm → canvas pixel (Y flipped: plotter Y=0 is at home/bottom, canvas Y=0 is top)
    const toCanX = (mmX) => paperLeft + (mmX / pw) * paperW;
    const toCanY = (mmY) => paperTop + paperH - (mmY / ph) * paperH;

    // NDC → mm  (matching gcode.js _ndcToPaper, with plotScale)
    const aspect     = get(cameraAspect) || 1;
    const plotScale  = +s.importScale || 1;
    const offsetX    = +s.offsetX || 0;
    const offsetY    = +s.offsetY || 0;
    const { sx: sxR, sy: syR } = ndcScales(aspect, pw, ph);
    const sx = sxR * plotScale;
    const sy = syR * plotScale;

    const ndcToMmX = (nx) => Math.max(MARGIN, Math.min(MARGIN + plotW, centerX + nx * sx + offsetX));
    const ndcToMmY = (ny) => Math.max(MARGIN, Math.min(MARGIN + plotH, centerY + ny * sy + offsetY));

    // Zoom transform around center
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoomLevel, zoomLevel);
    ctx.translate(-W / 2, -H / 2);

    // Paper background + border
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(paperLeft, paperTop, paperW, paperH);

    // 1 cm grid
    ctx.strokeStyle = '#252525';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 10; x < pw; x += 10) {
      const cx = toCanX(x);
      ctx.moveTo(cx, paperTop);
      ctx.lineTo(cx, paperTop + paperH);
    }
    for (let y = 10; y < ph; y += 10) {
      const cy = toCanY(y);
      ctx.moveTo(paperLeft, cy);
      ctx.lineTo(paperLeft + paperW, cy);
    }
    ctx.stroke();

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(paperLeft, paperTop, paperW, paperH);

    // Plot area boundary (MARGIN inset)
    ctx.strokeStyle = '#333';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      toCanX(MARGIN), toCanY(MARGIN + plotH),
      (plotW / pw) * paperW,
      (plotH / ph) * paperH,
    );
    ctx.setLineDash([]);

    // X0,Y0 origin marker at paper corner (0,0)
    const ox = toCanX(0), oy = toCanY(0);
    const armLen = 8;
    ctx.strokeStyle = '#665500';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox - armLen, oy); ctx.lineTo(ox + armLen, oy);
    ctx.moveTo(ox, oy - armLen); ctx.lineTo(ox, oy + armLen);
    ctx.stroke();
    ctx.fillStyle = '#aa8800';
    ctx.font = `${Math.max(8, 10 / zoomLevel)}px monospace`;
    ctx.fillText('X0,Y0', ox + 4, oy - 3);

    // Draw paths
    if (showPaths) {
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
    }

    ctx.restore();

    // HUD: zoom + paper size indicator
    ctx.fillStyle = '#555';
    ctx.font = '11px monospace';
    const hudR = W - 8;
    const hudY = H - 8;
    if (zoomLevel !== 1) {
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(zoomLevel * 100)}%`, hudR, hudY);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#444';
    ctx.fillText(`${pw}×${ph}mm`, 10, H - 8);
  }

  // Redraw whenever paths, aspect, or relevant settings change
  $: previewCanvas && ($activePaths, $cameraAspect, $settings.offsetX, $settings.offsetY, $settings.importScale, showPaths, redraw());

  onMount(() => redraw());

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
      // Convert mm paths → NDC using current paper dims
      const pw = paper.w, ph = paper.h;
      const plotW = pw - 2 * MARGIN;
      const plotH = ph - 2 * MARGIN;
      const cx = MARGIN + plotW / 2;
      const cy = MARGIN + plotH / 2;
      const ndcPaths = paths.map(path =>
        path.map(({ x, y }) => ({
          nx: (x - cx) / (plotW / 2),
          ny: (y - cy) / (plotH / 2),
        }))
      );
      importedPathCount.set(paths.length);
      activePaths.set(ndcPaths);
      stereoPaths.set(null);
      cameraAspect.set(plotW / plotH);
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
    const pw = paper.w, ph = paper.h;
    const plotW = pw - 2 * MARGIN;
    const plotH = ph - 2 * MARGIN;
    const cx = MARGIN + plotW / 2;
    const cy = MARGIN + plotH / 2;

    // With testAspect = plotW/plotH, NDC (±1, ±1) maps exactly to the plot
    // area corners — no letterboxing, clean 1:1 NDC-to-paper correspondence.
    const testAspect = plotW / plotH;
    const nx = x => (x - cx) / (plotW / 2);
    const ny = y => (y - cy) / (plotH / 2);
    const pt = (x, y) => ({ nx: nx(x), ny: ny(y) });

    const paths = [];

    // 1. Plot area boundary — should match the dashed preview rect exactly
    paths.push([
      pt(MARGIN,        MARGIN),
      pt(MARGIN+plotW,  MARGIN),
      pt(MARGIN+plotW,  MARGIN+plotH),
      pt(MARGIN,        MARGIN+plotH),
      pt(MARGIN,        MARGIN),
    ]);

    // 2. Center cross (20 mm arms each direction)
    paths.push([ pt(cx-20, cy),       pt(cx+20, cy) ]);
    paths.push([ pt(cx,    cy-20),    pt(cx,    cy+20) ]);

    // 3. Origin L-mark — 40 mm legs from the bottom-left plot corner.
    //    Should appear in the BOTTOM-LEFT of the paper. If axes are swapped
    //    or Y is flipped, this mark will appear in the wrong corner.
    const L = 40;
    paths.push([
      pt(MARGIN+L, MARGIN),
      pt(MARGIN,   MARGIN),
      pt(MARGIN,   MARGIN+L),
    ]);

    // 4. Scale ticks — 10 mm tall ticks every 50 mm along the bottom edge
    for (let x = MARGIN+50; x < MARGIN+plotW; x += 50) {
      paths.push([ pt(x, MARGIN), pt(x, MARGIN+10) ]);
    }

    // 5. Scale ticks — 10 mm wide ticks every 50 mm up the left edge
    for (let y = MARGIN+50; y < MARGIN+plotH; y += 50) {
      paths.push([ pt(MARGIN, y), pt(MARGIN+10, y) ]);
    }

    // 6. Diagonal — bottom-left to top-right; on portrait paper this should
    //    be a steep line. A shallow diagonal means axes look swapped/rotated.
    paths.push([ pt(MARGIN, MARGIN), pt(MARGIN+plotW, MARGIN+plotH) ]);

    importedPathCount.set(0);
    activePaths.set(paths);
    stereoPaths.set(null);
    cameraAspect.set(testAspect);
    exportParams.set(null);
    statusText  = `Test pattern loaded — ${paths.length} paths`;
    statusClass = 'done';
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
      plotScale:       +s.importScale || 1,
      paperW:          paper.w,
      paperH:          paper.h,
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

    <!-- Paper -->
    <section>
      <h3>Paper</h3>
      <label>
        Size
        <select value={$settings.paperSize}
                on:change={e => settings.patch({ paperSize: e.target.value })}>
          {#each Object.entries(PAPER_SIZES) as [key, p]}
            <option value={key}>{p.label}</option>
          {/each}
        </select>
      </label>
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
        Plot Scale
        <input type="number" min="0.05" max="5" step="0.05"
               value={$settings.importScale}
               on:input={e => settings.patch({ importScale: +e.target.value })}>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={showPaths}>
        Show tool path
      </label>
    </section>

    <section>
      <h3>Pen <span class="section-hint">(set in Serial tab)</span></h3>
      <div class="pen-info">
        <span>{$settings.penMode === 'z' ? 'Z axis' : 'Servo (M3)'}</span>
        {#if $settings.penMode === 'z'}
          <span>Up Z: {$settings.penUpZ}</span>
          <span>Down Z: {$settings.penDownZ}</span>
        {:else}
          <span>Up S: {$settings.penUpS}</span>
          <span>Down S: {$settings.penDownS}</span>
          <span>Y Comp: {$settings.penYComp}</span>
        {/if}
      </div>
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

  label.checkbox-label {
    justify-content: flex-start;
    gap: 6px;
    cursor: pointer;
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

  .section-hint {
    font-size: 9px;
    color: #444;
    text-transform: none;
    letter-spacing: 0;
  }

  .pen-info {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 11px;
    color: #555;
  }
</style>
