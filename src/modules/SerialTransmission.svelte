<script>
  import { get } from 'svelte/store';
  import { settings } from '../stores/settings.js';
  import { activePaths, cameraAspect, exportParams, hasPlottablePaths, shadingPasses } from '../stores/gcode.js';
  import { connected, sending, available, log, clearLog } from '../stores/serial.js';
  import * as serial from '../lib/serial.js';
  import * as gcode  from '../lib/gcode.js';

  const PAPER_SIZES = {
    'A4P':  { w: 210, h: 297 },
    'A4L':  { w: 297, h: 210 },
    'A3P':  { w: 297, h: 420 },
    'A3L':  { w: 420, h: 297 },
    'LTRP': { w: 216, h: 279 },
    'LTRL': { w: 279, h: 216 },
  };

  let statusText  = '';
  let statusClass = '';
  let monitorOpen = false;
  let monitorLog;
  let monitorInput;
  let cmdHistory = [];
  let historyIdx = -1;

  function _setStatus(text, cls = '') { statusText = text; statusClass = cls; }

  // ---------------------------------------------------------------------------
  // Config helpers
  // ---------------------------------------------------------------------------
  function getConfig() {
    const s = get(settings);
    const paper = PAPER_SIZES[s.paperSize] ?? PAPER_SIZES['A4P'];
    return {
      feedRate:  Math.max(100, Math.min(10000, +s.feedRate  || 3000)),
      penMode:   s.penMode  || 'z',
      penUpZ:    +s.penUpZ  ?? 5,
      penDownZ:  +s.penDownZ ?? 0,
      penUpS:    +s.penUpS  || 80,
      penDownS:  +s.penDownS || 50,
      penYComp:  +s.penYComp || 0,
      coreXY:    s.gcodeCoreXY || false,
      calYMax:   +s.calYMax  || 260,
      calYStep:  +s.calYStep || 20,
      offsetX:   +s.offsetX  || 0,
      offsetY:   +s.offsetY  || 0,
      paperW:    paper.w,
      paperH:    paper.h,
      plotScale: +s.importScale || 1,
    };
  }

  // ---------------------------------------------------------------------------
  // Connect helper
  // ---------------------------------------------------------------------------
  async function _ensureConnected() {
    if (!serial.isConnected()) {
      _setStatus('Connecting to plotter…', 'active');
      await serial.connect();
      connected.set(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Send to Plotter
  // ---------------------------------------------------------------------------
  async function onSend() {
    if (serial.isSending()) { serial.cancelSend(); return; }
    if (serial.isBusy()) return;
    if (!get(hasPlottablePaths)) return;
    try {
      await _ensureConnected();
      const cfg    = getConfig();
      const paths  = get(activePaths);
      const aspect = get(cameraAspect) || 1;
      const params = get(exportParams) || {};
      const shading = get(shadingPasses);
      const content = shading?.length
        ? gcode.imageGCode(paths, shading, { ...cfg, penDownFeedRate: 300, aspect, params })
        : gcode.projectedPathsToGCode(paths, { ...cfg, penDownFeedRate: 300, aspect, params });
      sending.set(true);
      _setStatus('Sending…', 'active');
      const { cancelled } = await serial.sendGCode(content, (sent, total) => {
        _setStatus(`Sending ${sent} / ${total}`, 'active');
      });
      _setStatus(cancelled ? 'Send cancelled' : 'Plot sent', cancelled ? '' : 'done');
    } catch (err) {
      _setStatus(`Plotter error: ${err?.message ?? err}`);
    } finally {
      sending.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  async function onFrame() {
    if (serial.isSending()) { serial.cancelSend(); return; }
    if (serial.isBusy() || !get(hasPlottablePaths)) return;
    try {
      await _ensureConnected();
      const cfg    = getConfig();
      const paths  = get(activePaths);
      const aspect = get(cameraAspect) || 1;
      const content = gcode.frameGCode(paths, {
        penUpZ: cfg.penUpZ, penUpS: cfg.penUpS, penMode: cfg.penMode,
        coreXY: cfg.coreXY, offsetX: cfg.offsetX, offsetY: cfg.offsetY, aspect,
        paperW: cfg.paperW, paperH: cfg.paperH, plotScale: cfg.plotScale,
      });
      if (!content) return;
      _setStatus('Framing…', 'active');
      const { cancelled } = await serial.sendGCode(content);
      _setStatus(cancelled ? 'Frame cancelled' : 'Frame complete');
    } catch (err) {
      _setStatus(`Frame error: ${err?.message ?? err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cal Sweep
  // ---------------------------------------------------------------------------
  async function onCalSweep() {
    if (serial.isSending()) { serial.cancelSend(); return; }
    if (serial.isBusy()) return;
    try {
      await _ensureConnected();
      const cfg     = getConfig();
      const content = gcode.calSweepGCode({
        penMode: cfg.penMode, penUpZ: cfg.penUpZ, penDownZ: cfg.penDownZ,
        penUpS: cfg.penUpS, penDownS: cfg.penDownS, penYComp: cfg.penYComp,
        feedRate: cfg.feedRate, coreXY: cfg.coreXY,
        calYMax: cfg.calYMax, calYStep: cfg.calYStep,
      });
      _setStatus('Calibrating…', 'active');
      const { cancelled } = await serial.sendGCode(content, (s, t) => {
        _setStatus(`Cal ${s} / ${t}`, 'active');
      });
      _setStatus(cancelled ? 'Cal cancelled' : 'Cal complete');
    } catch (err) {
      _setStatus(`Cal error: ${err?.message ?? err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Plotter machine commands
  // ---------------------------------------------------------------------------
  async function _cmd(cmdStr) {
    if (!$available) return;
    if (serial.isBusy()) return;
    try {
      await _ensureConnected();
      await serial.sendCommand(cmdStr);
      _setStatus(`Done: ${cmdStr}`, 'done');
    } catch (err) {
      _setStatus(`Plotter error: ${err?.message ?? err}`);
    }
  }

  function onHome()    { _cmd('$H'); }
  function onZeroXY()  { _cmd('G92 X0 Y0'); }
  function onZeroZ()   { _cmd('G92 Z0'); }

  function onPenUp() {
    const s = get(settings);
    if (s.penMode === 'servo') _cmd(`M3 S${+s.penUpS || 80}`);
    else                       _cmd(`G0 Z${(+s.penUpZ ?? 5).toFixed(3)}`);
  }
  function onPenDown() {
    const s = get(settings);
    if (s.penMode === 'servo') _cmd(`M3 S${+s.penDownS || 50}`);
    else                       _cmd(`G1 Z${(+s.penDownZ ?? 0).toFixed(3)} F300`);
  }

  // ---------------------------------------------------------------------------
  // Servo Sweep — REMOVED per user request
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Connection helpers
  // ---------------------------------------------------------------------------
  async function onReconnect() {
    if (serial.isConnected() || !$available) return;
    try {
      _setStatus('Reconnecting…', 'active');
      await serial.reconnect();
      connected.set(true);
      _setStatus('Reconnected', 'done');
    } catch (err) {
      _setStatus(`Reconnect failed: ${err?.message ?? err}`);
    }
  }

  async function onUnlock() { _cmd('$X'); }

  async function onCycleStart() {
    if (!$available || !$connected) return;
    try {
      serial.sendCycleStart();
      _setStatus('Resumed', 'done');
    } catch (err) {
      _setStatus(`Resume error: ${err?.message ?? err}`);
    }
  }

  async function onPenUpHome() {
    if (serial.isBusy() || !$available) return;
    const s = get(settings);
    const penUpCmd = s.penMode === 'servo'
      ? `M3 S${+s.penUpS || 80}`
      : `G0 Z${(+s.penUpZ ?? 5).toFixed(3)}`;
    try {
      await _ensureConnected();
      await serial.sendGCode(`${penUpCmd}\nG0 X0.000 Y0.000\n`, (sent, total) => {
        _setStatus(`Homing ${sent}/${total}`, 'active');
      });
      _setStatus('Pen up + at home', 'done');
    } catch (err) {
      _setStatus(`Error: ${err?.message ?? err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Jog
  // ---------------------------------------------------------------------------
  async function _jog(axis, dir) {
    if (!$available) return;
    const s        = get(settings);
    const step     = +get(settings).jogStep || 1;
    const feedRate = step <= 0.1 ? 400 : step <= 1 ? 2000 : 5000;
    const d        = dir * step;
    const swapXY   = s.jogSwapXY || false;
    const coreXY   = s.jogCoreXY || false;

    const physAxis = (swapXY && axis !== 'Z')
      ? (axis === 'X' ? 'Y' : 'X') : axis;

    let cmd;
    if (coreXY && physAxis !== 'Z') {
      const ds = d.toFixed(3), dn = (-d).toFixed(3);
      cmd = physAxis === 'X'
        ? `$J=G21 G91 X${ds} Y${ds} F${feedRate}`
        : `$J=G21 G91 X${ds} Y${dn} F${feedRate}`;
    } else {
      cmd = `$J=G21 G91 ${physAxis}${d.toFixed(3)} F${feedRate}`;
    }
    await _cmd(cmd);
  }

  // ---------------------------------------------------------------------------
  // Serial Monitor
  // ---------------------------------------------------------------------------
  function toggleMonitor() {
    monitorOpen = !monitorOpen;
    if (monitorOpen) {
      setTimeout(() => {
        if (monitorLog) monitorLog.scrollTop = monitorLog.scrollHeight;
        if (monitorInput) monitorInput.focus();
      }, 50);
    }
  }

  // Auto-scroll monitor when new lines arrive
  $: if ($log && monitorLog) {
    const atBottom =
      monitorLog.scrollHeight - monitorLog.scrollTop <= monitorLog.clientHeight + 4;
    // eslint-disable-next-line svelte/infinite-reactive-loop
    if (atBottom) setTimeout(() => { if (monitorLog) monitorLog.scrollTop = monitorLog.scrollHeight; }, 0);
  }

  async function monitorSend() {
    const cmd = monitorInput?.value?.trim();
    if (!cmd) return;
    cmdHistory.push(cmd);
    historyIdx = -1;
    monitorInput.value = '';

    if (!$available) { return; }
    try {
      if (!serial.isConnected()) {
        await serial.connect();
        connected.set(true);
      }
      await serial.sendCommand(cmd);
    } catch (err) {
      console.error('Monitor send error:', err);
    }
  }

  function onMonitorKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); monitorSend(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cmdHistory.length) return;
      if (historyIdx === -1) historyIdx = cmdHistory.length - 1;
      else historyIdx = Math.max(0, historyIdx - 1);
      monitorInput.value = cmdHistory[historyIdx];
      monitorInput.setSelectionRange(monitorInput.value.length, monitorInput.value.length);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!cmdHistory.length || historyIdx === -1) return;
      if (historyIdx >= cmdHistory.length - 1) {
        historyIdx = -1; monitorInput.value = ''; return;
      }
      historyIdx += 1;
      monitorInput.value = cmdHistory[historyIdx];
      monitorInput.setSelectionRange(monitorInput.value.length, monitorInput.value.length);
    }
  }

  // ---------------------------------------------------------------------------
  // Jog step stored in settings (not originally there — use local var with no persistence)
  // ---------------------------------------------------------------------------
  let jogStep = '1';
</script>

<div class="serial-layout">

  <!-- Status bar -->
  <div class="status-bar">
    <span>
      <span class="conn-dot" class:connected={$connected}></span>
      {$connected ? 'Connected' : 'Not connected'}
    </span>
    {#if !$connected && $available}
      <button class="btn-inline" on:click={onReconnect} title="Reconnect to last used port without showing port picker">Reconnect</button>
    {/if}
    {#if statusText}
      <span class="status-text {statusClass}">{statusText}</span>
    {/if}
    {#if !$available}
      <span class="warn">Web Serial not available (requires Chrome/Edge + HTTPS/localhost)</span>
    {/if}
  </div>

  <!-- Main action buttons -->
  <div class="panel">
    <h3>Plot</h3>
    <div class="btn-row">
      <button disabled={!$available || !$hasPlottablePaths}
              on:click={onSend}>
        {$sending ? 'Cancel Send' : 'Send to Plotter'}
      </button>
      <button disabled={!$available || !$hasPlottablePaths}
              on:click={onFrame}>
        {serial.isSending() ? 'Stop Frame' : 'Frame'}
      </button>
      <button disabled={!$available} on:click={onCalSweep}>
        {serial.isSending() ? 'Stop Cal' : 'Cal'}
      </button>
    </div>

    {#if $available}
    <div class="settings-row">
      <label>Cal Y Max (mm)
        <input type="number" min="10" max="500" step="10"
               value={$settings.calYMax}
               on:change={e => settings.patch({ calYMax: +e.target.value })} style="width:60px">
      </label>
      <label>Cal Step (mm)
        <input type="number" min="5" max="100" step="5"
               value={$settings.calYStep}
               on:change={e => settings.patch({ calYStep: +e.target.value })} style="width:55px">
      </label>
    </div>
    {/if}
    <div class="settings-row">
      <label title="Apply A=X+Y / B=X-Y motor transform to gcode. Leave off if your firmware (GRBL $32=1) handles CoreXY internally.">
        <input type="checkbox" checked={$settings.gcodeCoreXY}
               on:change={e => settings.patch({ gcodeCoreXY: e.target.checked })}>
        CoreXY gcode
      </label>
    </div>
  </div>

  {#if $available}
  <!-- Machine controls -->
  <div class="panel">
    <h3>Machine</h3>
    <div class="btn-row">
      <button on:click={onHome}   title="Run GRBL homing cycle ($H)">Home</button>
      <button on:click={onZeroXY} title="Zero X, Y at current position">Zero X,Y</button>
      <button on:click={onZeroZ}  title="Zero Z at current position">Zero Z</button>
      <button on:click={onUnlock} title="Send $X to clear GRBL alarm lock">Unlock ($X)</button>
      <button on:click={onPenUpHome} title="Lift pen then travel to X0 Y0">Pen Up + Home</button>
      <button on:click={onCycleStart} disabled={!$connected} title="Resume after M0 pause (pen-swap)">Continue (~)</button>
    </div>
  </div>

  <!-- Pen controls -->
  <div class="panel">
    <h3>Pen</h3>
    <div class="btn-row">
      <button on:click={onPenUp}   title="Lift pen to Pen Up position">Pen Up</button>
      <button on:click={onPenDown} title="Lower pen to Pen Down position">Pen Down</button>
    </div>
    <div class="pen-settings">
      <label>
        Mode
        <select value={$settings.penMode}
                on:change={e => settings.patch({ penMode: e.target.value })}>
          <option value="z">Z axis</option>
          <option value="servo">Servo (M3)</option>
        </select>
      </label>
      {#if $settings.penMode === 'z'}
        <label>Up Z
          <input type="number" min="-20" max="20" step="0.5"
                 value={$settings.penUpZ}
                 on:change={e => settings.patch({ penUpZ: +e.target.value })}></label>
        <label>Down Z
          <input type="number" min="-20" max="20" step="0.5"
                 value={$settings.penDownZ}
                 on:change={e => settings.patch({ penDownZ: +e.target.value })}></label>
      {:else}
        <label>Up S
          <input type="number" min="0" max="1000" step="5"
                 value={$settings.penUpS}
                 on:change={e => settings.patch({ penUpS: +e.target.value })}></label>
        <label>Down S
          <input type="number" min="0" max="1000" step="5"
                 value={$settings.penDownS}
                 on:change={e => settings.patch({ penDownS: +e.target.value })}></label>
        <label>Y Comp
          <input type="number" min="-10" max="10" step="0.1"
                 value={$settings.penYComp}
                 on:change={e => settings.patch({ penYComp: +e.target.value })}></label>
      {/if}
    </div>
  </div>

  <!-- Jog controls -->
  <div class="panel">
    <h3>Jog</h3>
    <div class="jog-settings">
      <label>
        Step
        <select bind:value={jogStep}>
          <option value="0.1">0.1 mm</option>
          <option value="1" selected>1 mm</option>
          <option value="10">10 mm</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={$settings.jogSwapXY}
               on:change={e => settings.patch({ jogSwapXY: e.target.checked })}>
        Swap X,Y
      </label>
      <label>
        <input type="checkbox" checked={$settings.jogCoreXY}
               on:change={e => settings.patch({ jogCoreXY: e.target.checked })}>
        CoreXY
      </label>
    </div>
    <div class="jog-grid">
      <div></div>
      <button on:click={() => _jog('Y',  1)} class="jog-btn">Y+</button>
      <button on:click={() => _jog('Z',  1)} class="jog-btn">Z+</button>
      <button on:click={() => _jog('X', -1)} class="jog-btn">X-</button>
      <button class="jog-center">·</button>
      <button on:click={() => _jog('X',  1)} class="jog-btn">X+</button>
      <div></div>
      <button on:click={() => _jog('Y', -1)} class="jog-btn">Y-</button>
      <button on:click={() => _jog('Z', -1)} class="jog-btn">Z-</button>
    </div>
  </div>

  <!-- Serial Monitor -->
  <div class="panel monitor-panel">
    <div class="monitor-header">
      <h3>Monitor</h3>
      <button class="toggle-btn" class:active={monitorOpen} on:click={toggleMonitor}>
        {monitorOpen ? '▾' : '▸'}
      </button>
      {#if monitorOpen}
        <button class="clear-btn" on:click={clearLog}>Clear</button>
        <span class="conn-status" class:connected={$connected}>
          {$connected ? '● connected' : '○ not connected'}
        </span>
      {/if}
    </div>
    {#if monitorOpen}
    <div class="monitor-log" bind:this={monitorLog}>
      {#each $log as entry (entry.id)}
        <div class="log-line log-{entry.type}" class:log-ok={entry.type==='rx' && entry.text==='ok'} class:log-err={entry.type==='rx' && (entry.text.startsWith('error') || entry.text.startsWith('ALARM'))}>
          {entry.type === 'tx' ? '> ' : entry.type === 'rx' ? '< ' : '  '}{entry.text}
        </div>
      {/each}
    </div>
    <div class="monitor-send">
      <input bind:this={monitorInput} type="text" placeholder="Type GRBL command…"
             spellcheck="false" autocomplete="off"
             on:keydown={onMonitorKeydown}
             style="flex:1; width:auto">
      <button on:click={monitorSend}>Send</button>
    </div>
    {/if}
  </div>
  {/if}
</div>

<style>
  .serial-layout {
    height: 100%;
    overflow-y: auto;
    padding: 12px 16px;
    background: #0a0a0a;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 600px;
  }

  .status-bar {
    font-size: 12px;
    color: #666;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    border-bottom: 1px solid #1a1a1a;
  }

  .conn-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #444;
    margin-right: 4px;
  }
  .conn-dot.connected { background: #44bb44; }

  .status-text       { color: #888; }
  .status-text.active { color: #00d4ff; }
  .status-text.done   { color: #44bb44; }

  .warn { color: #cc6600; font-size: 11px; }

  .btn-inline {
    padding: 2px 8px;
    font-size: 11px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    color: #aaa;
    cursor: pointer;
  }
  .btn-inline:hover { background: #252525; color: #ddd; }

  .panel {
    background: #0d0d0d;
    border: 1px solid #1e1e1e;
    border-radius: 6px;
    padding: 10px 12px;
  }

  h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    margin: 0 0 8px;
  }

  .btn-row { display: flex; flex-wrap: wrap; gap: 6px; }

  .settings-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #aaa;
    font-size: 12px;
    white-space: nowrap;
  }

  .jog-settings {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 8px;
  }

  .pen-settings {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .jog-grid {
    display: grid;
    grid-template-columns: repeat(3, 44px);
    gap: 3px;
  }

  .jog-btn {
    width: 44px; height: 36px;
    padding: 0;
    font-family: monospace;
    font-size: 12px;
  }

  .jog-center {
    width: 44px; height: 36px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
    color: #444;
    cursor: default;
    pointer-events: none;
    background: transparent;
    border: none;
  }

  /* Monitor */
  .monitor-panel { padding-bottom: 0; }

  .monitor-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 0;
  }
  .monitor-header h3 { margin-bottom: 0; }

  .toggle-btn {
    font-size: 14px;
    padding: 0 6px;
    background: none;
    border: none;
    color: #666;
  }
  .toggle-btn.active { color: #00d4ff; }

  .clear-btn { font-size: 11px; color: #555; padding: 2px 6px; }

  .conn-status { font-size: 11px; color: #555; margin-left: auto; }
  .conn-status.connected { color: #44bb44; }

  .monitor-log {
    max-height: 220px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 11px;
    padding: 6px 4px;
    margin-top: 6px;
    background: #080808;
    border-radius: 3px;
  }

  .log-line { padding: 1px 0; color: #666; white-space: pre-wrap; word-break: break-all; }
  .log-tx   { color: #4a9eff; }
  .log-rx   { color: #888; }
  .log-ok   { color: #44bb44; }
  .log-err  { color: #ff6666; }
  .log-info { color: #888; font-style: italic; }

  .monitor-send {
    display: flex;
    gap: 4px;
    padding: 6px 0;
  }
</style>
