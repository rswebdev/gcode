<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { traceImage } from '../lib/imageTrace.js';

  const dispatch = createEventDispatcher();

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let fileInput;
  let previewCanvas;

  // ── Image state ───────────────────────────────────────────────────────────
  let imgElement   = null;
  let imageData    = null;
  let imageAspect  = 1;
  let contourPaths = [];                // Array<Array<{nx,ny}>>
  let shadingPasses = [];               // Array<{label, paths}>

  // ── Trace settings ────────────────────────────────────────────────────────
  let threshold   = 128;
  let invert      = false;
  let simplify    = 4.0;
  let smooth      = 4;
  let minPoints   = 3;
  let fill        = 'none';
  let fillSpacing = 6;
  let shadeLevels = 3;    // 1–4 brightness bands, each a separate M0 pass

  // ── UI state ──────────────────────────────────────────────────────────────
  let statusText = 'Choose an image to begin';
  let isTracing  = false;
  let zoomLevel  = 1;
  let panX       = 0;
  let panY       = 0;
  let _isDragging = false;
  let _dragLast   = { x: 0, y: 0 };

  // ── Reactive re-trace when settings change ────────────────────────────────
  $: if (imageData) retrace(threshold, invert, simplify, smooth, minPoints, fill, fillSpacing, shadeLevels);

  // ── Image loading ─────────────────────────────────────────────────────────

  const MAX_DIM = 800; // max pixels on each axis for performance

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      statusText = 'Not an image file'; return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      imageAspect = image.width / image.height;

      // Downsample into an offscreen canvas for fast tracing
      let w = image.width, h = image.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w >= h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else        { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const offscreen = document.createElement('canvas');
      offscreen.width = w; offscreen.height = h;
      offscreen.getContext('2d').drawImage(image, 0, 0, w, h);

      imageData   = offscreen.getContext('2d').getImageData(0, 0, w, h);
      imgElement  = image;
      URL.revokeObjectURL(url);

      await tick(); // wait for canvas element to mount
      retrace(threshold, invert, simplify, smooth, minPoints, fill, fillSpacing, shadeLevels);
    };
    image.onerror = () => {
      statusText = 'Failed to load image';
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  // ── Tracing ───────────────────────────────────────────────────────────────

  function retrace(_t, _i, _s, _sm, _m, _f, _fs, _sl) {
    if (!imageData) return;
    isTracing = true;
    statusText = 'Tracing…';

    setTimeout(() => {
      const result = traceImage(imageData, {
        threshold, invert, simplify, smooth, minPoints, fill, fillSpacing, shadeLevels,
      });
      contourPaths  = result.contourPaths;
      shadingPasses = result.shadingPasses;

      const totalPaths = contourPaths.length + shadingPasses.reduce((n, p) => n + p.paths.length, 0);
      if (totalPaths === 0) {
        statusText = 'No paths found — try adjusting threshold or invert';
      } else if (shadingPasses.length > 0) {
        const passDesc = shadingPasses.map(p => `${p.paths.length} (${p.label})`).join(', ');
        statusText = `${contourPaths.length} contour + ${shadingPasses.length} shade passes: ${passDesc}`;
      } else {
        statusText = `${contourPaths.length} contour path${contourPaths.length !== 1 ? 's' : ''}`;
      }
      isTracing = false;
      drawPreview();
    }, 0);
  }

  // ── Preview rendering ─────────────────────────────────────────────────────

  function drawPreview() {
    if (!previewCanvas || !imageData) return;

    const dpr  = window.devicePixelRatio || 1;
    const rect = previewCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    previewCanvas.width  = rect.width  * dpr;
    previewCanvas.height = rect.height * dpr;

    const ctx = previewCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    // Apply zoom + pan transform
    ctx.save();
    ctx.translate(W / 2 + panX, H / 2 + panY);
    ctx.scale(zoomLevel, zoomLevel);
    ctx.translate(-W / 2, -H / 2);

    // Letterbox the source image
    const imgA = imageData.width / imageData.height;
    let imgW, imgH;
    if (W / H >= imgA) { imgH = H; imgW = H * imgA; }
    else               { imgW = W; imgH = W / imgA; }
    const imgX = (W - imgW) / 2;
    const imgY = (H - imgH) / 2;

    // Draw dimmed source image as context
    if (imgElement) {
      ctx.globalAlpha = 0.25;
      ctx.drawImage(imgElement, imgX, imgY, imgW, imgH);
      ctx.globalAlpha = 1;
    }

    // Overlay contours in cyan
    ctx.lineWidth = 1;
    ctx.lineJoin  = 'round';
    ctx.lineCap   = 'round';

    function drawPaths(paths, color) {
      ctx.strokeStyle = color;
      for (const path of paths) {
        if (path.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const { nx, ny } = path[i];
          const cx = imgX + (nx + 1) / 2 * imgW;
          const cy = imgY + (1 - ny) / 2 * imgH;
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }

    // Shade passes first (behind contours), darkest → lightest
    const shadeColors = ['#cc5500', '#e07700', '#f0a020', '#f8cc60'];
    for (let i = 0; i < shadingPasses.length; i++) {
      drawPaths(shadingPasses[i].paths, shadeColors[i] ?? shadeColors[shadeColors.length - 1]);
    }

    // Contours on top
    drawPaths(contourPaths, '#00d4ff');

    ctx.restore();
  }

  function onPreviewWheel(e) {
    e.preventDefault();
    const rect = previewCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W  = rect.width, H = rect.height;
    const factor  = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.25, Math.min(16, zoomLevel * factor));
    panX = panX + (mx - W / 2 - panX) * (1 - newZoom / zoomLevel);
    panY = panY + (my - H / 2 - panY) * (1 - newZoom / zoomLevel);
    zoomLevel = newZoom;
    drawPreview();
  }

  function onPreviewMouseDown(e) {
    if (e.button !== 0) return;
    _isDragging = true;
    _dragLast = { x: e.offsetX, y: e.offsetY };
  }
  function onPreviewMouseMove(e) {
    if (!_isDragging) return;
    panX += e.offsetX - _dragLast.x;
    panY += e.offsetY - _dragLast.y;
    _dragLast = { x: e.offsetX, y: e.offsetY };
    drawPreview();
  }
  function onPreviewMouseUp() { _isDragging = false; }
  function resetPreviewZoom() { zoomLevel = 1; panX = 0; panY = 0; drawPreview(); }

  onMount(() => drawPreview());

  // ── Actions ───────────────────────────────────────────────────────────────

  function onApply() {
    if (!contourPaths.length && !shadingPasses.length) return;
    dispatch('apply', { contourPaths, shadingPasses, aspect: imageAspect });
  }

  function onCancel() {
    dispatch('cancel');
  }

  function onOverlayClick(e) {
    if (e.target === e.currentTarget) onCancel();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && (contourPaths.length || shadingPasses.length) && !isTracing) onApply();
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="overlay" on:click={onOverlayClick} role="dialog" aria-modal="true" aria-label="Import image" tabindex="-1">
  <div class="dialog">

    <!-- Header -->
    <div class="dialog-header">
      <h2>Import Image → G-code</h2>
      <button class="close-btn" on:click={onCancel} aria-label="Close">✕</button>
    </div>

    <!-- Body -->
    <div class="dialog-body">

      <!-- Left: preview canvas / drop zone -->
      <div class="preview-pane">
        {#if !imageData}
          <label class="drop-zone" for="img-file-input">
            <span class="drop-icon">🖼️</span>
            <span>Click to choose an image</span>
            <span class="drop-hint">PNG · JPG · WebP · GIF</span>
          </label>
        {:else}
          <div class="canvas-wrap">
            <canvas bind:this={previewCanvas} class="trace-canvas"
                    class:dragging={_isDragging}
                    on:wheel|nonpassive|preventDefault={onPreviewWheel}
                    on:mousedown={onPreviewMouseDown}
                    on:mousemove={onPreviewMouseMove}
                    on:mouseup={onPreviewMouseUp}
                    on:mouseleave={onPreviewMouseUp}></canvas>
            <button class="zoom-reset" on:click={resetPreviewZoom} title="Reset zoom">⊡</button>
          </div>
        {/if}
        <input id="img-file-input" type="file" accept="image/*"
               class="file-input" bind:this={fileInput} on:change={onFileChange}>
      </div>

      <!-- Right: controls -->
      <aside class="controls-pane">

        <section>
          <h3>Image</h3>
          <button on:click={() => fileInput.click()} style="width:100%">
            {imageData ? 'Change Image…' : 'Choose Image…'}
          </button>
        </section>

        <section>
          <h3>Tracing</h3>

          <label for="ctrl-threshold">
            Threshold
            <span class="value-badge">{threshold}</span>
          </label>
          <input id="ctrl-threshold" type="range" min="1" max="254" step="1"
                 bind:value={threshold} class="full-range">

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={invert}>
            Invert (light = foreground)
          </label>
        </section>

        <section>
          <h3>Simplify &amp; Smooth</h3>

          <label for="ctrl-simplify">
            Tolerance
            <span class="value-badge">{simplify}</span>
          </label>
          <input id="ctrl-simplify" type="range" min="0" max="10" step="0.5"
                 bind:value={simplify} class="full-range">

          <label for="ctrl-smooth">
            Smoothing
            <span class="value-badge">{smooth === 0 || smooth === 1 ? 'off' : smooth}</span>
          </label>
          <input id="ctrl-smooth" type="range" min="0" max="8" step="1"
                 bind:value={smooth} class="full-range">

          <label>
            Min. points
            <input type="number" min="2" max="50" step="1"
                   bind:value={minPoints} class="num-input">
          </label>
        </section>

        <section>
          <h3>Fill</h3>
          <label>
            Style
            <select bind:value={fill} class="fill-select">
              <option value="none">None (contours only)</option>
              <option value="lines">Horizontal lines</option>
              <option value="crosshatch">Cross-hatch (H+V)</option>
              <option value="diagonal">Diagonal lines (45°)</option>
              <option value="stipple">Stipple (dots)</option>
            </select>
          </label>
          {#if fill !== 'none'}
            <label for="ctrl-fill-spacing">
              Spacing
              <span class="value-badge">{fillSpacing}px</span>
            </label>
            <input id="ctrl-fill-spacing" type="range" min="2" max="24" step="1"
                   bind:value={fillSpacing} class="full-range">
            <label for="ctrl-shade-levels">
              Shade levels
              <span class="value-badge">{shadeLevels}</span>
            </label>
            <input id="ctrl-shade-levels" type="range" min="1" max="4" step="1"
                   bind:value={shadeLevels} class="full-range">
            {#if shadeLevels > 1}
              <div class="shade-legend">
                {#each Array(shadeLevels) as _, i (i)}
                  <span class="shade-dot" style="background:{['#cc5500','#e07700','#f0a020','#f8cc60'][i]}"></span>
                  <span class="shade-label-text">{['Very Dark','Dark','Medium','Light'].slice(4-shadeLevels)[i]}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </section>

        <section class="status-section">
          <div class="status" class:tracing={isTracing}
               class:ok={!isTracing && (contourPaths.length > 0 || shadingPasses.length > 0)}
               class:warn={!isTracing && contourPaths.length === 0 && shadingPasses.length === 0 && !!imageData}>
            {statusText}
          </div>
        </section>

      </aside>
    </div>

    <!-- Footer -->
    <div class="dialog-footer">
      <button on:click={onCancel}>Cancel</button>
      <button class="btn-primary" disabled={(!contourPaths.length && !shadingPasses.length) || isTracing}
              on:click={onApply}>
        Apply to G-code
      </button>
    </div>

  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    width: min(860px, 95vw);
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #222;
    flex-shrink: 0;
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #ccc;
    letter-spacing: 0.03em;
  }

  .close-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .close-btn:hover { color: #ccc; }

  /* ── Body ────────────────────────────────────────────────────── */
  .dialog-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* Left: preview */
  .preview-pane {
    flex: 1;
    position: relative;
    background: #0a0a0a;
    overflow: hidden;
    min-height: 340px;
  }

  .drop-zone {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #555;
    font-size: 13px;
    cursor: pointer;
    border: 1px dashed #2a2a2a;
    margin: 16px;
    border-radius: 4px;
    transition: border-color 0.15s, color 0.15s;
  }
  .drop-zone:hover { border-color: #444; color: #888; }

  .drop-icon { font-size: 32px; opacity: 0.5; }

  .drop-hint {
    font-size: 11px;
    color: #444;
    letter-spacing: 0.05em;
  }

  .trace-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
  }
  .trace-canvas.dragging { cursor: grabbing; }

  .canvas-wrap {
    position: absolute;
    inset: 0;
  }

  .zoom-reset {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: #1a1a1a;
    border: 1px solid #333;
    color: #666;
    font-size: 14px;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  .zoom-reset:hover { color: #aaa; background: #222; }

  .file-input { display: none; }

  /* Right: controls */
  .controls-pane {
    width: 210px;
    flex-shrink: 0;
    overflow-y: auto;
    padding: 0 12px;
    border-left: 1px solid #1e1e1e;
    background: #0d0d0d;
    display: flex;
    flex-direction: column;
  }

  section {
    padding: 10px 0;
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
    color: #aaa;
    font-size: 12px;
    margin-bottom: 4px;
  }

  label.checkbox-label {
    justify-content: flex-start;
    gap: 6px;
    cursor: pointer;
    margin-top: 6px;
  }

  .value-badge {
    font-size: 11px;
    color: #666;
    font-variant-numeric: tabular-nums;
    min-width: 28px;
    text-align: right;
  }

  .full-range {
    width: 100%;
    margin-bottom: 6px;
  }

  .num-input {
    width: 56px;
    text-align: right;
  }

  .fill-select {
    max-width: 130px;
    font-size: 11px;
  }

  .shade-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-top: 4px;
    font-size: 10px;
    color: #666;
  }

  .shade-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .shade-label-text { color: #666; }

  /* Status */
  .status-section { flex: 1; }

  .status {
    font-size: 11px;
    color: #555;
    line-height: 1.4;
    word-break: break-word;
  }
  .status.tracing { color: #888; }
  .status.ok      { color: #44bb44; }
  .status.warn    { color: #cc8800; }

  /* ── Footer ─────────────────────────────────────────────────── */
  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #222;
    flex-shrink: 0;
  }

  .btn-primary {
    background: #00d4ff22;
    border-color: #00d4ff55;
    color: #00d4ff;
  }
  .btn-primary:hover:not(:disabled) {
    background: #00d4ff33;
    border-color: #00d4ff;
  }
  .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
