<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { settings } from '../stores/settings.js';
  import {
    activePaths, stereoPaths, shadingPasses, cameraAspect, exportParams,
    importedPathCount, hasPlottablePaths,
  } from '../stores/gcode.js';
  import { appState } from '../stores/wave.js';
  import * as gcode from '../lib/gcode.js';
  import ImageToGcodeDialog from './ImageToGcodeDialog.svelte';
  let previewCanvas;
  let fileInput;
  let zoomLevel  = 1;
  let panX       = 0;
  let panY       = 0;
  let _isDragging = false;
  let _dragLast   = { x: 0, y: 0 };
  let showPaths  = true;
  let showImageDialog = false;

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------
  // Multi-pass playback: contour paths as pass 0 (cyan), then shade passes.
  // Each segment has a precomputed lenMm for feed-rate based advancement.
  let playPasses   = [];     // [{label, color, segs:[{type,nx1,ny1,nx2,ny2,lenMm}]}]
  let playPassIdx  = 0;      // active pass index
  let playSegIdx   = 0;      // segment index within active pass
  let playDistMm   = 0;      // mm consumed into current segment (sub-seg precision)
  let playing      = false;
  let playPausedM0 = false;  // waiting for manual resume at M0
  let playRaf      = null;
  let speedMult    = 1;      // playback speed multiplier (×feedRate)
  let playOptimized = false;
  let playTravelPct = null;

  function _computeNdcToMm() {
    const s = get(settings);
    const pw = paper.w, ph = paper.h;
    const plotW = pw - 2 * MARGIN;
    const plotH = ph - 2 * MARGIN;
    const centerX = MARGIN + plotW / 2;
    const centerY = MARGIN + plotH / 2;
    const aspect = get(cameraAspect) || 1;
    const plotScale = +s.importScale || 1;
    const offsetX = +s.offsetX || 0;
    const offsetY = +s.offsetY || 0;
    const { sx: sxR, sy: syR } = ndcScales(aspect, pw, ph);
    const sx = sxR * plotScale;
    const sy = syR * plotScale;
    return {
      toMmX: (nx) => centerX + nx * sx + offsetX,
      toMmY: (ny) => centerY + ny * sy + offsetY,
    };
  }

  function _pathsToPassSegs(paths, toMmX, toMmY) {
    const segs = [];
    // Initialise pen at machine home ≈ NDC (-1,-1), matching _sortPaths origin.
    let penNx = -1, penNy = -1;
    for (const path of paths) {
      if (path.length < 1) continue;
      segs.push({
        type: 'travel',
        nx1: penNx, ny1: penNy, nx2: path[0].nx, ny2: path[0].ny,
        lenMm: Math.hypot(toMmX(path[0].nx) - toMmX(penNx), toMmY(path[0].ny) - toMmY(penNy)),
      });
      for (let i = 1; i < path.length; i++) {
        segs.push({
          type: 'draw',
          nx1: path[i-1].nx, ny1: path[i-1].ny,
          nx2: path[i].nx,   ny2: path[i].ny,
          lenMm: Math.hypot(toMmX(path[i].nx) - toMmX(path[i-1].nx), toMmY(path[i].ny) - toMmY(path[i-1].ny)),
        });
      }
      penNx = path[path.length - 1].nx;
      penNy = path[path.length - 1].ny;
    }
    return segs;
  }

  function _calcTravelMm(paths, toMmX, toMmY) {
    // Start from machine home ≈ NDC (-1,-1) to match _sortPaths origin.
    let penNx = -1, penNy = -1, travel = 0;
    for (const path of paths) {
      if (!path.length) continue;
      travel += Math.hypot(toMmX(path[0].nx) - toMmX(penNx), toMmY(path[0].ny) - toMmY(penNy));
      penNx = path[path.length - 1].nx;
      penNy = path[path.length - 1].ny;
    }
    return travel;
  }

  function buildPlayPasses() {
    const raw = get(activePaths);
    if (!raw.length) return;

    const { toMmX, toMmY } = _computeNdcToMm();
    const passes = [];
    const shadePassColors = ['#cc5500', '#e07700', '#f0a020', '#f8cc60'];

    // Pass 0: Contours (optionally sorted)
    let contourPaths = raw;
    if (playOptimized) {
      const sorted = gcode.sortPaths(raw);
      const rawTravel = _calcTravelMm(raw, toMmX, toMmY);
      const optTravel = _calcTravelMm(sorted, toMmX, toMmY);
      playTravelPct = rawTravel > 0 ? Math.round((1 - optTravel / rawTravel) * 100) : null;
      contourPaths = sorted;
    } else {
      playTravelPct = null;
    }
    passes.push({ label: 'Contours', color: '#00d4ff', segs: _pathsToPassSegs(contourPaths, toMmX, toMmY) });

    // Shade passes — always sorted to match imageGCode() output
    const shading = get(shadingPasses);
    if (shading?.length) {
      for (let i = 0; i < shading.length; i++) {
        passes.push({
          label: shading[i].label,
          color: shadePassColors[i] ?? shadePassColors.at(-1),
          segs: _pathsToPassSegs(gcode.sortPaths(shading[i].paths), toMmX, toMmY),
        });
      }
    }

    playPasses = passes;
  }

  function onPlayToggle() {
    if (playing) { pausePlay(); return; }
    if (!playPasses.length) buildPlayPasses();
    if (playPassIdx >= playPasses.length) { playPassIdx = 0; playSegIdx = 0; playDistMm = 0; }
    playing = true;
    playPausedM0 = false;
    schedulePlayFrame();
  }

  function onResumeM0() {
    if (!playPausedM0) return;
    playPassIdx++;
    playSegIdx = 0;
    playDistMm = 0;
    playPausedM0 = false;
    playing = true;
    schedulePlayFrame();
  }

  function pausePlay() {
    playing = false;
    if (playRaf) { cancelAnimationFrame(playRaf); playRaf = null; }
  }

  function resetPlay() {
    pausePlay();
    playPassIdx = 0; playSegIdx = 0; playDistMm = 0;
    playPausedM0 = false;
    playPasses = [];
    redraw();
  }

  function schedulePlayFrame() {
    playRaf = requestAnimationFrame(() => {
      if (!playing) return;

      const s = get(settings);
      const baseFeed  = Math.max(100, +s.feedRate || 3000) * speedMult; // mm/min
      const rapidRate = baseFeed * 5; // mm/min for travels
      let   timeBudget = 1 / 60;     // seconds per frame (60 fps assumed)

      const pass = playPasses[playPassIdx];
      if (!pass) { playing = false; return; }

      while (timeBudget > 1e-9) {
        if (playSegIdx >= pass.segs.length) {
          playing = false;
          if (playPassIdx < playPasses.length - 1) playPausedM0 = true;
          timeBudget = 0;
          break;
        }
        const seg  = pass.segs[playSegIdx];
        const rate = (seg.type === 'travel' ? rapidRate : baseFeed) / 60; // mm/s
        if (rate <= 0 || seg.lenMm <= 0) { playSegIdx++; playDistMm = 0; continue; }
        const segLeft = seg.lenMm - playDistMm;
        const timeForSeg = segLeft / rate;
        if (timeForSeg <= timeBudget) {
          timeBudget  -= timeForSeg;
          playSegIdx++;
          playDistMm = 0;
        } else {
          playDistMm += timeBudget * rate;
          timeBudget = 0;
        }
      }

      redraw();
      if (playing) schedulePlayFrame();
    });
  }

  // Invalidate play state when paths or optimized toggle change
  $: $activePaths && resetPlay();
  $: $shadingPasses, resetPlay();
  $: playOptimized, resetPlay();

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

    const ndcToMmX = (nx) => centerX + nx * sx + offsetX;
    const ndcToMmY = (ny) => centerY + ny * sy + offsetY;

    // Zoom + pan transform (zoom around canvas center offset by pan)
    ctx.save();
    ctx.translate(W / 2 + panX, H / 2 + panY);
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

    // Draw paths / play trace
    if (playPasses.length > 0 && (playPassIdx > 0 || playSegIdx > 0 || playDistMm > 0 || playPausedM0)) {
      // Play mode: render completed passes + current pass partial trace

      // Completed passes — draw their pen-down strokes fully
      for (let pi = 0; pi < playPassIdx; pi++) {
        const p = playPasses[pi];
        ctx.strokeStyle = p.color;
        ctx.lineWidth   = 0.8;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.beginPath();
        for (let si = 0; si < p.segs.length; si++) {
          const seg = p.segs[si];
          if (seg.type !== 'draw') continue;
          const x1 = toCanX(ndcToMmX(seg.nx1)), y1 = toCanY(ndcToMmY(seg.ny1));
          const x2 = toCanX(ndcToMmX(seg.nx2)), y2 = toCanY(ndcToMmY(seg.ny2));
          if (si === 0 || p.segs[si - 1].type !== 'draw') ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }

      // Current pass
      const pass = playPasses[playPassIdx];
      if (pass) {
        // Dashed gray travel lines for current pass (up to playSegIdx)
        ctx.strokeStyle = 'rgba(120,120,120,0.45)';
        ctx.lineWidth   = 0.6;
        ctx.setLineDash([3, 4]);
        for (let si = 0; si < playSegIdx; si++) {
          const seg = pass.segs[si];
          if (seg.type !== 'travel') continue;
          ctx.beginPath();
          ctx.moveTo(toCanX(ndcToMmX(seg.nx1)), toCanY(ndcToMmY(seg.ny1)));
          ctx.lineTo(toCanX(ndcToMmX(seg.nx2)), toCanY(ndcToMmY(seg.ny2)));
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // Pen-down draws for current pass (fully drawn segs up to playSegIdx)
        ctx.strokeStyle = pass.color;
        ctx.lineWidth   = 0.8;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.beginPath();
        for (let si = 0; si < playSegIdx; si++) {
          const seg = pass.segs[si];
          if (seg.type !== 'draw') continue;
          const x1 = toCanX(ndcToMmX(seg.nx1)), y1 = toCanY(ndcToMmY(seg.ny1));
          const x2 = toCanX(ndcToMmX(seg.nx2)), y2 = toCanY(ndcToMmY(seg.ny2));
          if (si === 0 || pass.segs[si - 1].type !== 'draw') ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();

        // Partial current segment
        if (playDistMm > 0 && playSegIdx < pass.segs.length) {
          const seg = pass.segs[playSegIdx];
          if (seg.type === 'draw' && seg.lenMm > 0) {
            const t = Math.min(playDistMm / seg.lenMm, 1);
            const mx = seg.nx1 + (seg.nx2 - seg.nx1) * t;
            const my = seg.ny1 + (seg.ny2 - seg.ny1) * t;
            ctx.strokeStyle = pass.color;
            ctx.lineWidth   = 0.8;
            ctx.lineJoin    = 'round';
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(toCanX(ndcToMmX(seg.nx1)), toCanY(ndcToMmY(seg.ny1)));
            ctx.lineTo(toCanX(ndcToMmX(mx)), toCanY(ndcToMmY(my)));
            ctx.stroke();
          }
        }

        // Pen dot at current position
        let dotNx, dotNy;
        if (playDistMm > 0 && playSegIdx < pass.segs.length) {
          const seg = pass.segs[playSegIdx];
          const t = seg.lenMm > 0 ? Math.min(playDistMm / seg.lenMm, 1) : 0;
          dotNx = seg.nx1 + (seg.nx2 - seg.nx1) * t;
          dotNy = seg.ny1 + (seg.ny2 - seg.ny1) * t;
        } else if (playSegIdx > 0 && playSegIdx <= pass.segs.length) {
          const seg = pass.segs[playSegIdx - 1];
          dotNx = seg.nx2; dotNy = seg.ny2;
        }
        if (dotNx !== undefined) {
          ctx.fillStyle = '#ff4444';
          ctx.beginPath();
          ctx.arc(toCanX(ndcToMmX(dotNx)), toCanY(ndcToMmY(dotNy)), 4 / zoomLevel, 0, Math.PI * 2);
          ctx.fill();
        }
      }

    } else if (showPaths) {
      // Static mode: draw shading passes first (behind contours), then contours
      const shadeColors = ['#cc550044', '#e0770055', '#f0a02066', '#f8cc6077'];
      const shading = get(shadingPasses);
      if (shading?.length) {
        ctx.lineWidth = 0.6;
        ctx.lineJoin  = 'round';
        ctx.lineCap   = 'round';
        for (let si = 0; si < shading.length; si++) {
          ctx.strokeStyle = shadeColors[si] ?? shadeColors[shadeColors.length - 1];
          for (const path of shading[si].paths) {
            if (path.length < 2) continue;
            ctx.beginPath();
            for (let i = 0; i < path.length; i++) {
              const { nx, ny } = path[i];
              if (i === 0) ctx.moveTo(toCanX(ndcToMmX(nx)), toCanY(ndcToMmY(ny)));
              else         ctx.lineTo(toCanX(ndcToMmX(nx)), toCanY(ndcToMmY(ny)));
            }
            ctx.stroke();
          }
        }
      }

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
  $: previewCanvas && ($activePaths, $shadingPasses, $cameraAspect, $settings.offsetX, $settings.offsetY, $settings.importScale, showPaths, redraw());

  onMount(() => redraw());
  onDestroy(() => pausePlay());

  function onWheel(e) {
    e.preventDefault();
    const rect = previewCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W  = rect.width, H = rect.height;
    const factor  = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.25, Math.min(8, zoomLevel * factor));
    // Keep the canvas point under the cursor fixed while zooming
    panX = panX + (mx - W / 2 - panX) * (1 - newZoom / zoomLevel);
    panY = panY + (my - H / 2 - panY) * (1 - newZoom / zoomLevel);
    zoomLevel = newZoom;
    redraw();
  }

  function onCanvasMouseDown(e) {
    if (e.button !== 0) return;
    _isDragging = true;
    _dragLast = { x: e.offsetX, y: e.offsetY };
  }
  function onCanvasMouseMove(e) {
    if (!_isDragging) return;
    panX += e.offsetX - _dragLast.x;
    panY += e.offsetY - _dragLast.y;
    _dragLast = { x: e.offsetX, y: e.offsetY };
    redraw();
  }
  function onCanvasMouseUp() { _isDragging = false; }

  function resetZoom() { zoomLevel = 1; panX = 0; panY = 0; redraw(); }

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
      shadingPasses.set(null);
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

  function onTestPattern() {    const pw = paper.w, ph = paper.h;
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
    shadingPasses.set(null);
    cameraAspect.set(testAspect);
    exportParams.set(null);
    statusText  = `Test pattern loaded — ${paths.length} paths`;
    statusClass = 'done';
  }

  // ---------------------------------------------------------------------------
  // Import Image → G-code dialog
  // ---------------------------------------------------------------------------

  function onImageApply({ detail }) {
    const { contourPaths, shadingPasses: passes, aspect } = detail;
    const allPaths = contourPaths;
    importedPathCount.set(contourPaths.length);
    activePaths.set(allPaths);
    stereoPaths.set(null);
    shadingPasses.set(passes?.length ? passes : null);
    cameraAspect.set(aspect);
    exportParams.set(null);
    const passInfo = passes?.length ? ` + ${passes.length} shade pass${passes.length !== 1 ? 'es' : ''}` : '';
    statusText  = `Image imported — ${contourPaths.length} contour${passInfo}`;
    statusClass = 'done';
    showImageDialog = false;
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
    const cfg    = _buildGcodeConfig();
    const shading = get(shadingPasses);
    const params  = get(exportParams) || {};
    let content, filename;
    if (shading?.length) {
      content  = gcode.imageGCode(paths, shading, cfg);
      filename = gcode.generateFilename(params).replace('.gcode', '-image.gcode');
      statusText = `G-code exported (${1 + shading.length} passes)`; statusClass = 'done';
    } else {
      content  = gcode.projectedPathsToGCode(paths, cfg);
      filename = gcode.generateFilename(params);
      statusText = 'G-code exported'; statusClass = 'done';
    }
    gcode.downloadGCode(content, filename);
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
            class:dragging={_isDragging}
            on:wheel|nonpassive|preventDefault={onWheel}
            on:mousedown={onCanvasMouseDown}
            on:mousemove={onCanvasMouseMove}
            on:mouseup={onCanvasMouseUp}
            on:mouseleave={onCanvasMouseUp}></canvas>
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
        <button on:click={() => showImageDialog = true}>Import Image</button>
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

    <!-- Playback -->
    <section>
      <h3>Playback</h3>
      <div class="btn-group">
        <button disabled={!$hasPlottablePaths || playPausedM0} on:click={onPlayToggle}>
          {playing ? 'Pause' : (playPasses.length && !playPausedM0 && (playPassIdx > 0 || playSegIdx > 0)) ? 'Resume' : 'Play'}
        </button>
        <button disabled={playPasses.length === 0 && playPassIdx === 0 && playSegIdx === 0} on:click={resetPlay}>Reset</button>
      </div>
      {#if playPausedM0}
        <div class="m0-pause">
          <span class="m0-label">M0 — swap pen for: <strong>{playPasses[playPassIdx + 1]?.label ?? 'next pass'}</strong></span>
          <button on:click={onResumeM0}>Continue</button>
        </div>
      {/if}
      <label style="margin-top:6px">
        Speed
        <input type="range" min="0.25" max="8" step="0.25" bind:value={speedMult}>
        <span class="speed-label">{speedMult}×</span>
      </label>
      <label class="checkbox-label" style="margin-top:4px">
        <input type="checkbox" bind:checked={playOptimized}>
        Optimized order
      </label>
      {#if playPasses.length > 0}
        <div class="path-info">
          {#if playing || playPausedM0 || playSegIdx > 0}
            Pass {playPassIdx + 1}/{playPasses.length}: {playPasses[playPassIdx]?.label}
            · seg {playSegIdx}/{playPasses[playPassIdx]?.segs.length ?? 0}
          {:else}
            {$activePaths.length} paths
          {/if}
          {#if playTravelPct !== null}
            · <span class="travel-saving">−{playTravelPct}% travel</span>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Paper -->
    <section>
      <h3>Paper</h3>
      <label>
        Size
        <select value={$settings.paperSize}
                on:change={e => settings.patch({ paperSize: e.target.value })}>
          {#each Object.entries(PAPER_SIZES) as [key, p] (key)}
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

{#if showImageDialog}
  <ImageToGcodeDialog
    on:apply={onImageApply}
    on:cancel={() => showImageDialog = false}
  />
{/if}

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
    cursor: grab;
  }
  .preview-canvas.dragging { cursor: grabbing; }

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

  .travel-saving {
    color: #44bb44;
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

  .m0-pause {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    padding: 8px;
    background: #1a1000;
    border: 1px solid #664400;
    border-radius: 5px;
    font-size: 12px;
    color: #cc8800;
  }
  .m0-label { color: #cc8800; }
  .speed-label { color: #888; font-size: 11px; min-width: 28px; }
</style>
