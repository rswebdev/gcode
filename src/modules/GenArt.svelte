<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { activeTab } from '../stores/ui.js';
  import {
    activePaths, cameraAspect, exportParams, importedPathCount,
  } from '../stores/gcode.js';
  import {
    userGenartPlugins, userGenartIds,
    installGenartPlugin, uninstallGenartPlugin,
    restoreGenartPlugins, registerBuiltinIds,
  } from '../lib/genartPluginLoader.js';

  // Built-in algorithms
  import * as lsystem  from '../lib/genart/lsystem.js';
  import * as flowField from '../lib/genart/flowField.js';
  import * as truchet  from '../lib/genart/truchet.js';
  import * as rdiff    from '../lib/genart/reactionDiffusion.js';

  const BUILTIN = [lsystem, flowField, truchet, rdiff];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let canvas;
  let selectedId   = 'lsystem';
  let paramsByAlg  = {};          // { [algId]: { [paramId]: value } }
  let currentPaths = [];
  let generating   = false;
  let genError     = '';
  let autoGen      = false;

  // Plugin panel
  let pluginPanelOpen = false;
  let pluginCode      = '';
  let pluginFileInput;
  let installError    = '';
  let installing      = false;

  // Canvas resize observer
  let resizeOb;

  // ---------------------------------------------------------------------------
  // Register built-in IDs so plugins cannot shadow them
  // ---------------------------------------------------------------------------
  registerBuiltinIds(BUILTIN.map(a => a.id));

  // Restore persisted plugins on mount
  onMount(async () => {
    await restoreGenartPlugins();
    _setupResizeObserver();
  });

  onDestroy(() => {
    resizeOb?.disconnect();
  });

  // Re-render when this tab becomes active (canvas may have been 0-size before)
  $: if ($activeTab === 'genart') {
    tick().then(() => _renderPaths(currentPaths));
  }

  // ---------------------------------------------------------------------------
  // Available algorithms (built-ins + user plugins)
  // ---------------------------------------------------------------------------

  $: algorithms = [...BUILTIN, ...$userGenartPlugins];
  $: selected   = algorithms.find(a => a.id === selectedId) ?? algorithms[0];

  // Side-effect reactive block: initialize param storage when the algorithm changes.
  // This is a statement block (not a derivation), so mutating paramsByAlg here is safe.
  $: if (selected && !paramsByAlg[selectedId]) {
    const defaults = {};
    for (const p of (selected.params ?? [])) defaults[p.id] = p.default;
    paramsByAlg = { ...paramsByAlg, [selectedId]: defaults };
  }

  // Pure derivation: param descriptor list for the current algorithm
  $: params = selected?.params ?? [];

  /** Update a single param value and trigger auto-gen if enabled. */
  function setParam(id, value) {
    paramsByAlg = {
      ...paramsByAlg,
      [selectedId]: { ...(paramsByAlg[selectedId] ?? {}), [id]: value },
    };
    _scheduleAutoGen();
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  function _setupResizeObserver() {
    if (!canvas) return;
    resizeOb?.disconnect();
    resizeOb = new ResizeObserver(() => {
      const parent = canvas.parentElement;
      if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return;
      _renderPaths(currentPaths);
    });
    resizeOb.observe(canvas.parentElement);
  }

  function _resizeCanvas() {
    if (!canvas) return false;
    const parent = canvas.parentElement;
    if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return false;
    canvas.width  = parent.clientWidth;
    canvas.height = parent.clientHeight;
    return true;
  }

  function _renderPaths(paths) {
    if (!canvas) return;
    if (!_resizeCanvas()) return; // skip if hidden
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    if (!paths || paths.length === 0) return;

    // NDC [-1,+1] → canvas pixels, preserving square aspect within canvas
    const size = Math.min(W, H) * 0.9;
    const ox = W / 2, oy = H / 2;
    function toCanvas(nx, ny) {
      return {
        cx:  ox + nx * (size / 2),
        cy:  oy - ny * (size / 2), // Y flip: NDC +1 is top
      };
    }

    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();

    for (const path of paths) {
      if (path.length < 2) continue;
      const { cx, cy } = toCanvas(path[0].nx, path[0].ny);
      ctx.moveTo(cx, cy);
      for (let i = 1; i < path.length; i++) {
        const { cx: px, cy: py } = toCanvas(path[i].nx, path[i].ny);
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------------

  async function generate() {
    if (generating || !selected) return;
    generating = true;
    genError   = '';
    try {
      // Yield to browser to show spinner, then compute
      await tick();
      await new Promise(resolve => setTimeout(resolve, 0));
      const p = paramsByAlg[selectedId] ?? {};
      const paths = selected.generate(p);
      currentPaths = paths;
      _renderPaths(paths);
    } catch (err) {
      genError = err.message ?? String(err);
      currentPaths = [];
      _renderPaths([]);
    } finally {
      generating = false;
    }
  }

  // Auto-generate: debounced re-run on param change (called explicitly from setParam)
  let _autoTimer;
  function _scheduleAutoGen() {
    if (!autoGen) return;
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(generate, 350);
  }

  // ---------------------------------------------------------------------------
  // Send to G-code
  // ---------------------------------------------------------------------------

  function sendToGcode() {
    if (currentPaths.length === 0) return;
    activePaths.set(currentPaths);
    importedPathCount.set(0);
    cameraAspect.set(1); // square canvas
    exportParams.set({ algorithm: selected?.label ?? selectedId });
    activeTab.set('gcode');
  }

  // ---------------------------------------------------------------------------
  // Plugin panel
  // ---------------------------------------------------------------------------

  async function handleInstallPlugin() {
    if (!pluginCode.trim() || installing) return;
    installing   = true;
    installError = '';
    try {
      await installGenartPlugin(pluginCode.trim());
      pluginCode = '';
    } catch (err) {
      installError = err.message ?? String(err);
    } finally {
      installing = false;
    }
  }

  function handlePluginFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { pluginCode = ev.target.result; };
    reader.readAsText(file);
    e.target.value = '';
  }
</script>

<!-- =========================================================
     Layout: sidebar left + canvas right
     ========================================================= -->
<div class="genart-wrap">

  <!-- Sidebar -->
  <aside class="sidebar">

    <!-- Algorithm selector -->
    <section class="sidebar-group">
      <label class="section-label" for="genart-alg-select">Algorithm</label>
      <select id="genart-alg-select" bind:value={selectedId} on:change={() => { currentPaths = []; _renderPaths([]); }}>
        {#each algorithms as alg (alg.id)}
          <option value={alg.id}>{alg.label}</option>
        {/each}
      </select>
    </section>

    <!-- Actions -->
    <section class="sidebar-group action-row">
      <button class="btn-primary" on:click={generate} disabled={generating}>
        {generating ? 'Generating…' : 'Generate'}
      </button>
      <button class="btn-gcode" on:click={sendToGcode} disabled={currentPaths.length === 0}>
        → G-code
      </button>
    </section>

    <!-- Auto-generate toggle -->
    <section class="sidebar-group">
      <label class="inline-check">
        <input type="checkbox" bind:checked={autoGen} />
        Auto-generate
      </label>
    </section>

    {#if genError}
      <p class="error-msg">{genError}</p>
    {/if}

    <hr class="divider" />

    <!-- Dynamic parameter controls -->
    {#if selected && params.length > 0}
      <section class="sidebar-group param-list">
        {#each params as param (param.id)}
          <div class="param-row">
            <span class="param-label">{param.label}</span>
            <div class="param-control">
              {#if param.type === 'range'}
                <input
                  type="range"
                  min={param.min} max={param.max} step={param.step ?? 1}
                  value={paramsByAlg[selectedId]?.[param.id] ?? param.default}
                  on:input={e => setParam(param.id, +e.target.value)}
                />
                <span class="param-val">{(+(paramsByAlg[selectedId]?.[param.id] ?? param.default)).toFixed(
                  (param.step ?? 1) < 0.01 ? 3 : (param.step ?? 1) < 0.1 ? 2 : (param.step ?? 1) < 1 ? 1 : 0
                )}</span>
              {:else if param.type === 'number'}
                <input
                  type="number"
                  min={param.min} max={param.max} step={param.step ?? 1}
                  value={paramsByAlg[selectedId]?.[param.id] ?? param.default}
                  on:change={e => setParam(param.id, +e.target.value)}
                />
              {:else if param.type === 'select'}
                <select
                  value={paramsByAlg[selectedId]?.[param.id] ?? param.default}
                  on:change={e => setParam(param.id, e.target.value)}
                >
                  {#each (param.options ?? []) as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              {:else if param.type === 'toggle'}
                <input
                  type="checkbox"
                  checked={paramsByAlg[selectedId]?.[param.id] ?? param.default}
                  on:change={e => setParam(param.id, e.target.checked)}
                />
              {/if}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    <!-- Spacer pushes plugin panel to bottom -->
    <div class="spacer"></div>

    <!-- Plugin panel -->
    <section class="plugin-section">
      <button class="panel-toggle" on:click={() => pluginPanelOpen = !pluginPanelOpen}>
        Plugins ▸ <span class="plugin-count">{$userGenartIds.length}</span>
      </button>

      {#if pluginPanelOpen}
        <div class="plugin-panel">

          {#if $userGenartIds.length > 0}
            <div class="installed-list">
              {#each $userGenartIds as uid (uid)}
                <div class="installed-item">
                  <span>{uid}</span>
                  <button class="btn-remove" on:click={() => uninstallGenartPlugin(uid)}>×</button>
                </div>
              {/each}
            </div>
          {/if}

          <textarea
            class="plugin-code"
            placeholder="Paste plugin JS here…"
            bind:value={pluginCode}
            rows="5"
            spellcheck="false"
          ></textarea>

          <div class="plugin-actions">
            <button on:click={() => pluginFileInput.click()}>Load file</button>
            <button
              class="btn-install"
              on:click={handleInstallPlugin}
              disabled={!pluginCode.trim() || installing}
            >{installing ? 'Installing…' : 'Install'}</button>
          </div>

          {#if installError}
            <p class="error-msg">{installError}</p>
          {/if}

          <input
            bind:this={pluginFileInput}
            type="file" accept=".js,.mjs"
            class="hidden"
            on:change={handlePluginFile}
          />
        </div>
      {/if}
    </section>

  </aside>

  <!-- Canvas area -->
  <div class="canvas-area">
    <canvas bind:this={canvas}></canvas>
  </div>

</div>

<style>
  .genart-wrap {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Sidebar ---- */
  .sidebar {
    width: 220px;
    min-width: 200px;
    max-width: 240px;
    flex-shrink: 0;
    background: #111;
    border-right: 1px solid #252525;
    display: flex;
    flex-direction: column;
    padding: 10px 0 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .sidebar-group {
    padding: 6px 12px;
  }

  .section-label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666;
    margin-bottom: 4px;
  }

  .action-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .btn-primary {
    flex: 1;
    background: #0e2230;
    border-color: #00d4ff55;
    color: #00d4ff;
    font-weight: 500;
  }
  .btn-primary:hover:not(:disabled) {
    background: #163444;
    border-color: #00d4ff;
  }

  .btn-gcode {
    flex: 1;
  }

  .inline-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #aaa;
    white-space: nowrap;
  }

  .error-msg {
    margin: 4px 12px;
    font-size: 11px;
    color: #f66;
    word-break: break-word;
  }

  .divider {
    border: none;
    border-top: 1px solid #252525;
    margin: 6px 0;
  }

  /* ---- Params ---- */
  .param-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .param-label {
    width: 72px;
    min-width: 72px;
    font-size: 12px;
    color: #bbb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .param-control {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .param-control input[type="range"] {
    width: 80px;
    min-width: 0;
  }

  .param-val {
    font-size: 11px;
    color: #888;
    min-width: 30px;
    text-align: right;
  }

  /* ---- Spacer ---- */
  .spacer { flex: 1; }

  /* ---- Plugin panel ---- */
  .plugin-section {
    border-top: 1px solid #252525;
  }

  .panel-toggle {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 8px 12px;
    font-size: 12px;
    color: #888;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .panel-toggle:hover { background: #1a1a1a; color: #ccc; border-color: transparent; }

  .plugin-count {
    background: #222;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 0 6px;
    font-size: 10px;
    color: #888;
  }

  .plugin-panel {
    padding: 6px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .installed-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 80px;
    overflow-y: auto;
  }

  .installed-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #1a1a1a;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 11px;
    color: #aaa;
  }

  .btn-remove {
    padding: 0 4px;
    font-size: 13px;
    line-height: 1;
    border-color: transparent;
    background: transparent;
    color: #666;
  }
  .btn-remove:hover { color: #e55; background: #2a1a1a; }

  .plugin-code {
    width: 100%;
    resize: vertical;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 10px;
    line-height: 1.4;
    background: #0e0e0e;
    color: #e0e0e0;
    border: 1px solid #333;
    border-radius: 3px;
    padding: 5px;
    box-sizing: border-box;
    min-height: 60px;
  }

  .plugin-actions {
    display: flex;
    gap: 6px;
  }

  .btn-install {
    flex: 1;
    background: #1a2a1a;
    border-color: #2e6b2e;
    color: #7ecf7e;
  }
  .btn-install:hover:not(:disabled) {
    background: #234023;
    border-color: #5aab5a;
  }

  .hidden { display: none !important; }

  /* ---- Canvas area ---- */
  .canvas-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #0a0a0a;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
