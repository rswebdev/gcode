<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { traceImage } from '../lib/imageTrace.js';

  const dispatch = createEventDispatcher();

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let fileInput;
  let previewCanvas;

  // ── Image state ───────────────────────────────────────────────────────────
  let imgElement   = null;   // HTMLImageElement for drawing the dimmed background
  let imageData    = null;   // ImageData at working resolution
  let imageAspect  = 1;      // width / height of the source image
  let tracedPaths  = [];     // Array<Array<{nx,ny}>>

  // ── Trace settings ────────────────────────────────────────────────────────
  let threshold  = 128;   // 1–254
  let invert     = false;
  let simplify   = 1.5;   // RDP tolerance (doubled-pixel units)
  let minPoints  = 3;     // drop paths shorter than this after simplification

  // ── UI state ──────────────────────────────────────────────────────────────
  let statusText = 'Choose an image to begin';
  let isTracing  = false;

  // ── Reactive re-trace when settings change ────────────────────────────────
  $: if (imageData) retrace(threshold, invert, simplify, minPoints);

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
      retrace(threshold, invert, simplify, minPoints);
    };
    image.onerror = () => {
      statusText = 'Failed to load image';
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  // ── Tracing ───────────────────────────────────────────────────────────────

  function retrace(_t, _i, _s, _m) {
    if (!imageData) return;
    isTracing = true;
    statusText = 'Tracing…';

    // Defer to next task so the UI can show the "Tracing…" state first.
    setTimeout(() => {
      tracedPaths = traceImage(imageData, {
        threshold, invert, simplify, minPoints,
      });
      statusText = tracedPaths.length
        ? `${tracedPaths.length} path${tracedPaths.length !== 1 ? 's' : ''} traced`
        : 'No paths found — try adjusting threshold or invert';
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

    // Overlay traced paths in cyan
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth   = 1;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    for (const path of tracedPaths) {
      if (path.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const { nx, ny } = path[i];
        // NDC → canvas:  nx ∈ [-1,1] → [imgX, imgX+imgW];  ny=+1 → top
        const cx = imgX + (nx + 1) / 2 * imgW;
        const cy = imgY + (1 - ny) / 2 * imgH;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }

  onMount(() => drawPreview());

  // ── Actions ───────────────────────────────────────────────────────────────

  function onApply() {
    if (!tracedPaths.length) return;
    dispatch('apply', { paths: tracedPaths, aspect: imageAspect });
  }

  function onCancel() {
    dispatch('cancel');
  }

  function onOverlayClick(e) {
    if (e.target === e.currentTarget) onCancel();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && tracedPaths.length && !isTracing) onApply();
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="overlay" on:click={onOverlayClick} role="dialog" aria-modal="true" aria-label="Import image">
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
          <canvas bind:this={previewCanvas} class="trace-canvas"></canvas>
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

          <label>
            Threshold
            <span class="value-badge">{threshold}</span>
          </label>
          <input type="range" min="1" max="254" step="1"
                 bind:value={threshold} class="full-range">

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={invert}>
            Invert (light = foreground)
          </label>
        </section>

        <section>
          <h3>Simplify</h3>

          <label>
            Tolerance
            <span class="value-badge">{simplify}</span>
          </label>
          <input type="range" min="0" max="10" step="0.5"
                 bind:value={simplify} class="full-range">

          <label>
            Min. points
            <input type="number" min="2" max="50" step="1"
                   bind:value={minPoints} class="num-input">
          </label>
        </section>

        <section class="status-section">
          <div class="status" class:tracing={isTracing}
               class:ok={!isTracing && tracedPaths.length > 0}
               class:warn={!isTracing && tracedPaths.length === 0 && !!imageData}>
            {statusText}
          </div>
        </section>

      </aside>
    </div>

    <!-- Footer -->
    <div class="dialog-footer">
      <button on:click={onCancel}>Cancel</button>
      <button class="btn-primary" disabled={!tracedPaths.length || isTracing}
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
  }

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
