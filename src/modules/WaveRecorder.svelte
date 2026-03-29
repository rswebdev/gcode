<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { settings, savePreset, loadPreset, clearPreset, hasPreset } from '../stores/settings.js';
  import { appState, frameCount } from '../stores/wave.js';
  import {
    activePaths, stereoPaths, cameraAspect, exportParams, importedPathCount,
  } from '../stores/gcode.js';
  import { activeTab } from '../stores/ui.js';
  import * as audio      from '../lib/audio.js';
  import * as recorder   from '../lib/recorder.js';
  import * as visualizer from '../lib/visualizer.js';
  import * as noise      from '../lib/noise.js';
  import {
    pluginList, userPluginIds,
    installPlugin, uninstallPlugin,
  } from '../lib/pluginLoader.js';

  // ---------------------------------------------------------------------------
  // DOM refs for camera inputs (needed to avoid overwriting while user edits)
  // ---------------------------------------------------------------------------
  let canvas;
  let camPosInput, camTgtInput;

  let audioReady     = false;
  let advancedOpen   = false;
  let pluginPanelOpen = false;
  let pluginCode     = '';
  let installError   = '';
  let installing     = false;
  let rafId        = null;
  let tickCount    = 0;
  const RAF_FPS    = 60;

  // Mirror for use in callbacks / rAF loop
  let s;
  const _unsubSettings = settings.subscribe(v => s = v);

  // ---------------------------------------------------------------------------
  // Config helpers
  // ---------------------------------------------------------------------------
  function getConfig() {
    return {
      maxFrames:        Math.max(8,   Math.min(256,  +s.maxFrames || 64)),
      ampScale:         Math.max(0.1, Math.min(10,   +s.ampScale  || 2.0)),
      feedRate:         Math.max(100, Math.min(10000,+s.feedRate  || 3000)),
      offsetX:          +s.offsetX || 0,
      offsetY:          +s.offsetY || 0,
      penUpZ:           Math.max(-20, Math.min(20,  +s.penUpZ   ?? 5)),
      penDownZ:         Math.max(-20, Math.min(20,  +s.penDownZ ?? 0)),
      penMode:          s.penMode  || 'z',
      penUpS:           Math.max(0, Math.min(1000, +s.penUpS   || 80)),
      penDownS:         Math.max(0, Math.min(1000, +s.penDownS || 50)),
      penYComp:         +s.penYComp || 0,
      fftSize:          Math.max(32, Math.min(2048, +s.fftSize   || 512)),
      recordFps:        Math.max(1,  Math.min(30,  +s.recordFps || 10)),
      smoothing:        +s.smoothing ?? 0.5,
      amplitudeScaleMm: Math.max(0.1, Math.min(10, +s.ampScale || 2.0)),
      coreXY:           s.jogCoreXY || false,
    };
  }

  function getNoiseConfig() {
    return {
      noiseType:   s.noiseType,
      seed:        Math.max(0, +s.noiseSeed || 42),
      speed:       +s.noiseSpeed,
      frequency:   +s.noiseFreq,
      octaves:     +s.noiseOct,
      persistence: +s.noisePers,
      fftSize:     Math.max(32, Math.min(2048, +s.fftSize || 512)),
    };
  }

  function parseVec3(str) {
    const parts = String(str || '').trim().split(/[\s,]+/).map(Number);
    return (parts.length === 3 && !parts.some(isNaN)) ? parts : null;
  }

  // ---------------------------------------------------------------------------
  // Per-source × per-shape defaults (from original main.js)
  // ---------------------------------------------------------------------------
  const SHAPE_SOURCE_DEFAULTS = {
    noise: {
      linear:       { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 64  },
      terrain:      { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 64  },
      landscape:    { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 64  },
      quantized:    { noiseType: 'perlin', noiseSpeed: 0.004, noiseFreq: 1.5, noiseOct: 3, noisePers: 0.6, ampScale: 2.5, maxFrames: 30  },
      circular:     { noiseType: 'perlin', noiseSpeed: 0.008, noiseFreq: 3,   noiseOct: 3, noisePers: 0.5, ampScale: 1.5, maxFrames: 32  },
      spiral:       { noiseType: 'perlin', noiseSpeed: 0.004, noiseFreq: 2,   noiseOct: 4, noisePers: 0.6, ampScale: 0.8, maxFrames: 96  },
      lissajous:    { noiseType: 'sine',   noiseSpeed: 0.01,  noiseFreq: 1.5, noiseOct: 3, noisePers: 0.5, ampScale: 6,   maxFrames: 32  },
      harmonograph: { noiseType: 'perlin', noiseSpeed: 0.003, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 2,   maxFrames: 32  },
      moire:        { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 3, noisePers: 0.5, ampScale: 1,   maxFrames: 32  },
      heatmap:      { noiseType: 'perlin', noiseSpeed: 0.005, noiseFreq: 2,   noiseOct: 4, noisePers: 0.5, ampScale: 1,   maxFrames: 48  },
    },
    mic: {
      linear:       { ampScale: 1.2, maxFrames: 32,  mode: 'time'      },
      terrain:      { ampScale: 1.2, maxFrames: 32,  mode: 'time'      },
      landscape:    { ampScale: 1.2, maxFrames: 32,  mode: 'time'      },
      quantized:    { ampScale: 1.5, maxFrames: 24,  mode: 'time'      },
      circular:     { ampScale: 1.0, maxFrames: 32,  mode: 'frequency' },
      spiral:       { ampScale: 0.5, maxFrames: 64,  mode: 'frequency' },
      lissajous:    { ampScale: 5.0, maxFrames: 16,  mode: 'stereo'    },
      harmonograph: { ampScale: 1.5, maxFrames: 16,  mode: 'frequency' },
      moire:        { ampScale: 1.0, maxFrames: 32,  mode: 'time'      },
      heatmap:      { ampScale: 1.0, maxFrames: 32,  mode: 'frequency' },
    },
  };

  function applyShapeSourceDefaults(source, shape) {
    const d = (SHAPE_SOURCE_DEFAULTS[source] || {})[shape];
    if (!d) return;
    const patch = {};
    if (d.noiseType  != null) patch.noiseType  = d.noiseType;
    if (d.noiseSpeed != null) patch.noiseSpeed = d.noiseSpeed;
    if (d.noiseFreq  != null) patch.noiseFreq  = d.noiseFreq;
    if (d.noiseOct   != null) patch.noiseOct   = d.noiseOct;
    if (d.noisePers  != null) patch.noisePers  = d.noisePers;
    if (d.ampScale   != null) patch.ampScale   = d.ampScale;
    if (d.maxFrames  != null) patch.maxFrames  = d.maxFrames;
    if (d.mode       != null) patch.mode       = d.mode;
    settings.patch(patch);
  }

  // ---------------------------------------------------------------------------
  // Preset helpers
  // ---------------------------------------------------------------------------
  function presetKey() { return `${s.source}:${s.shape}`; }

  function _applyPreset(source, shape) {
    const preset = loadPreset(`${source}:${shape}`);
    if (!preset) return false;
    settings.patch(preset);
    const pos = parseVec3(preset.cameraPos);
    const tgt = parseVec3(preset.cameraTgt);
    if (pos && tgt) visualizer.setCameraState(pos, tgt);
    return true;
  }

  function onSavePreset() {
    const snapshotS = get(settings);
    const cam = visualizer.getCameraState();
    savePreset(presetKey(), {
      mode:       snapshotS.mode,
      noiseType:  snapshotS.noiseType,
      noiseSeed:  snapshotS.noiseSeed,
      noiseSpeed: snapshotS.noiseSpeed,
      noiseFreq:  snapshotS.noiseFreq,
      noiseOct:   snapshotS.noiseOct,
      noisePers:  snapshotS.noisePers,
      maxFrames:  snapshotS.maxFrames,
      ampScale:   snapshotS.ampScale,
      fftSize:    snapshotS.fftSize,
      recordFps:  snapshotS.recordFps,
      smoothing:  snapshotS.smoothing,
      cameraPos:  cam ? cam.position.map(v => +v.toFixed(2)).join(' ') : snapshotS.cameraPos,
      cameraTgt:  cam ? cam.target.map(v => +v.toFixed(2)).join(' ')   : snapshotS.cameraTgt,
    });
    presetHas = true;
  }

  function onClearPreset() {
    clearPreset(presetKey());
    presetHas = false;
  }

  let presetHas = false;
  $: presetHas = hasPreset($settings.source, $settings.shape);

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------
  let statusText  = 'Idle';
  let statusClass = '';

  function _setStatus(text, cls = '') {
    statusText  = text;
    statusClass = cls;
  }

  // Clear imported paths whenever recorder frames exist
  function _clearImported() {
    importedPathCount.set(0);
    activePaths.set([]);
    stereoPaths.set(null);
  }

  // ---------------------------------------------------------------------------
  // Record / Stop
  // ---------------------------------------------------------------------------
  async function onRecord() {
    if (get(appState) === 'RECORDING') {
      recorder.stop();
      appState.set('STOPPED');
      _setStatus(`Captured ${recorder.getFrameCount()} frames`, 'done');
      return;
    }

    const cfg = getConfig();
    try {
      _clearImported();
      visualizer.updateConfig(cfg);
      visualizer.clearWaveLines();

      if (s.source === 'noise') {
        noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
        noise.reset();
      } else {
        if (!audioReady) {
          _setStatus('Requesting microphone…');
          await audio.init(cfg);
          audioReady = true;
        }
      }

      recorder.configure({ maxFrames: cfg.maxFrames, mode: s.mode });
      recorder.start();
      tickCount = 0;
      appState.set('RECORDING');
      _setStatus('Recording…', 'active');
      frameCount.set(0);
    } catch (err) {
      console.error('Failed to start recording:', err);
      _setStatus('Microphone access denied');
      appState.set('IDLE');
    }
  }

  // ---------------------------------------------------------------------------
  // Re-render
  // ---------------------------------------------------------------------------
  function onRerender() {
    if (recorder.getFrameCount() === 0) return;
    visualizer.updateConfig(getConfig());
    visualizer.replayFrames(recorder.getFrames());
  }

  // ---------------------------------------------------------------------------
  // Plugin manager handlers
  // ---------------------------------------------------------------------------

  async function onInstallPlugin() {
    if (!pluginCode.trim()) return;
    installing   = true;
    installError = '';
    try {
      await installPlugin(pluginCode.trim());
      pluginCode = '';
    } catch (err) {
      installError = String(err.message || err);
    } finally {
      installing = false;
    }
  }

  function onUninstallPlugin(id) {
    uninstallPlugin(id);
  }

  function onPluginFileLoad(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { pluginCode = ev.target.result; };
    reader.readAsText(file);
    e.target.value = ''; // reset so the same file can be re-selected
  }

  // ---------------------------------------------------------------------------
  // Shape / Source / Mode change handlers
  // ---------------------------------------------------------------------------
  function onShapeChange(e) {
    const newShape = e.target.value;
    settings.patch({ shape: newShape });
    _clearImported();
    if (!_applyPreset(s.source, newShape)) applyShapeSourceDefaults(s.source, newShape);
    if (s.source === 'noise') {
      const cfg = getConfig();
      noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
    }
    visualizer.setShape(newShape);

    const state = get(appState);
    if (state === 'STOPPED' && recorder.getFrameCount() > 0) {
      onRerender();
    } else {
      recorder.reset();
      frameCount.set(0);
      if (state === 'STOPPED') appState.set('IDLE');
      _setStatus('Idle');
    }
  }

  function onSourceChange(e) {
    const newSource = e.target.value;
    settings.patch({ source: newSource });
    _clearImported();
    if (!_applyPreset(newSource, s.shape)) applyShapeSourceDefaults(newSource, s.shape);

    if (newSource === 'noise') {
      const cfg = getConfig();
      noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
      noise.reset();
    }
    audio.setSmoothing(+s.smoothing);

    recorder.reset();
    visualizer.clearWaveLines();
    frameCount.set(0);
    const state = get(appState);
    if (state === 'STOPPED') appState.set('IDLE');
    _setStatus('Idle');
  }

  async function onModeChange(e) {
    const newMode = e.target.value;
    if (newMode === s.mode) return;
    settings.patch({ mode: newMode });
    _clearImported();
    recorder.reset();
    visualizer.clearWaveLines();
    frameCount.set(0);
    const state = get(appState);
    if (state === 'STOPPED') appState.set('IDLE');
    _setStatus('Idle');

    if (audioReady) {
      try {
        await audio.destroy();
        audioReady = false;
        const cfg = getConfig();
        await audio.init(cfg);
        audioReady = true;
      } catch (err) {
        audioReady = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Noise helpers
  // ---------------------------------------------------------------------------
  function onNoiseTypeChange(e) {
    settings.patch({ noiseType: e.target.value });
    _applyNoiseConfig();
  }

  function onNoiseSeedChange(e) {
    settings.patch({ noiseSeed: +e.target.value });
    _applyNoiseConfig();
    noise.reset();
    if (get(appState) !== 'RECORDING') {
      recorder.reset();
      visualizer.clearWaveLines();
      frameCount.set(0);
      if (get(appState) === 'STOPPED') appState.set('IDLE');
    }
  }

  function _applyNoiseConfig() {
    if (s.source !== 'noise') return;
    const cfg = getConfig();
    noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  function onCameraSet() {
    const pos = parseVec3(s.cameraPos);
    const tgt = parseVec3(s.cameraTgt);
    if (pos && tgt) visualizer.setCameraState(pos, tgt);
  }

  function onCameraReset() {
    visualizer.resetCamera();
  }

  // ---------------------------------------------------------------------------
  // Build export params (snapshot for gcode module)
  // ---------------------------------------------------------------------------
  function buildExportParams() {
    return {
      shape:      s.shape,
      source:     s.source,
      dataMode:   s.mode,
      noiseType:  s.noiseType,
      seed:       +s.noiseSeed || 42,
      noiseSpeed: +s.noiseSpeed,
      noiseFreq:  +s.noiseFreq,
      noiseOct:   +s.noiseOct,
      noisePers:  +s.noisePers,
      maxFrames:  +s.maxFrames || 64,
      ampScale:   +s.ampScale  || 2,
      fftSize:    +s.fftSize   || 512,
      feedRate:   +s.feedRate  || 3000,
      offsetX:    +s.offsetX   || 0,
      offsetY:    +s.offsetY   || 0,
      penUpZ:     +s.penUpZ    ?? 5,
      penDownZ:   +s.penDownZ  ?? 0,
      penMode:    s.penMode    || 'z',
      penUpS:     +s.penUpS    || 80,
      penDownS:   +s.penDownS  || 50,
      penYComp:   +s.penYComp  || 0,
      coreXY:     s.jogCoreXY  || false,
      camera:     visualizer.getCameraState(),
    };
  }

  // ---------------------------------------------------------------------------
  // Pattern → G-code / Stereo G-code (send to gcode module)
  // ---------------------------------------------------------------------------
  function onPatternToGcode() {
    const paths  = visualizer.getProjectedPaths();
    if (!paths.length) return;
    activePaths.set(paths);
    stereoPaths.set(null);
    cameraAspect.set(visualizer.getCameraAspect());
    exportParams.set(buildExportParams());
    importedPathCount.set(0);
    activeTab.set('gcode');
  }

  function onPatternToStereo() {
    const { leftPaths, rightPaths } = visualizer.getStereoPaths(0.65);
    if (!leftPaths.length) return;
    activePaths.set(leftPaths); // left paths drive the 2D preview
    stereoPaths.set({ leftPaths, rightPaths });
    cameraAspect.set(visualizer.getCameraAspect());
    exportParams.set(buildExportParams());
    importedPathCount.set(0);
    activeTab.set('gcode');
  }

  // ---------------------------------------------------------------------------
  // rAF + lifecycle
  // ---------------------------------------------------------------------------
  onMount(() => {
    const cfg = getConfig();
    visualizer.init(canvas, cfg);
    visualizer.setShape(s.shape);

    const pos = parseVec3(s.cameraPos);
    const tgt = parseVec3(s.cameraTgt);
    if (pos && tgt) visualizer.setCameraState(pos, tgt);

    noise.configure({ ...getNoiseConfig(), fftSize: cfg.fftSize });
    audio.setSmoothing(+s.smoothing);
    appState.set('IDLE');
    _setStatus('Idle');

    function loop() {
      rafId = requestAnimationFrame(loop);

      const source = s.source;
      const mode   = s.mode;
      const shape  = s.shape;
      const state  = get(appState);

      if (audioReady || source === 'noise') {
        const frame = source === 'noise'
          ? noise.getFrame(mode)
          : audio.getFrame(mode);

        const allFrames = visualizer.REBUILD_ALL_SHAPES.has(shape)
          ? recorder.getFrames() : null;

        visualizer.updateLiveLine(frame, allFrames, recorder.getFrameCount());

        const recordEveryN = Math.max(1, Math.round(RAF_FPS / (+s.recordFps || 10)));
        if (recorder.isRecording() && tickCount % recordEveryN === 0) {
          recorder.addFrame(frame);
          const count = recorder.getFrameCount();
          frameCount.set(count);
          visualizer.addRecordedFrame(frame, count - 1, recorder.getFrames());

          if (recorder.isFull()) {
            recorder.stop();
            appState.set('STOPPED');
            _setStatus(`Captured ${count} frames`, 'done');
          }
        }
        tickCount++;
      }

      // Sync camera position (every 30 frames)
      if (tickCount % 30 === 0 && visualizer.getCameraState) {
        const cam = visualizer.getCameraState();
        if (cam) {
          const focused = document.activeElement;
          if (focused !== camPosInput && focused !== camTgtInput) {
            const fmt = arr => arr.map(v => parseFloat(v.toFixed(2))).join(' ');
            settings.patch({ cameraPos: fmt(cam.position), cameraTgt: fmt(cam.target) });
          }
        }
      }

      visualizer.render();
    }

    loop();
    return () => {
      _unsubSettings();
      if (rafId) cancelAnimationFrame(rafId);
      visualizer.dispose();
    };
  });

  onDestroy(() => {
    audio.destroy();
  });

  // ---------------------------------------------------------------------------
  // Reactive: auto re-render when ampScale changes in STOPPED state
  // ---------------------------------------------------------------------------
  let prevAmpScale = null;
  $: if ($settings.ampScale !== prevAmpScale) {
    prevAmpScale = $settings.ampScale;
    if (get(appState) === 'STOPPED' && recorder.getFrameCount() > 0) {
      // defer so settings store has settled
      setTimeout(onRerender, 0);
    }
  }

  // Derived helpers for template
  $: isRecording  = $appState === 'RECORDING';
  $: isStopped    = $appState === 'STOPPED';
  $: isIdle       = $appState === 'IDLE';
  $: hasFrames    = $frameCount > 0;
  $: canRender    = isStopped && hasFrames;
  $: canTransfer  = isStopped && (hasFrames || get(importedPathCount) > 0);
  $: isNoise      = $settings.source === 'noise';
  $: isWhiteNoise = $settings.noiseType === 'white';
</script>

<!-- ============================================================ Wave tab -->
<div class="wave-root">
  <canvas bind:this={canvas} class="viz-canvas"></canvas>

  <div class="hud">
    <!-- Top controls row -->
    <div class="ctrl-row">
      <button class:recording={isRecording} on:click={onRecord}
              disabled={false}>
        {isRecording ? 'Stop' : 'Record'}
      </button>

      <button disabled={!canTransfer} on:click={onPatternToGcode}
              title="Project current 3D view → G-code module">
        Pattern → G-code
      </button>

      <button disabled={!canTransfer} on:click={onPatternToStereo}
              title="Project as anaglyph (left + right eye) → G-code module">
        Pattern → Stereo
      </button>

      <button disabled={!canRender} on:click={onRerender}>
        Re-render
      </button>

      <span class="status {statusClass}">{statusText}</span>
      <span class="frame-counter">
        {#if isRecording}
          {$frameCount} / {$settings.maxFrames} frames
        {:else if hasFrames}
          {$frameCount} frames
        {:else}
          0 frames
        {/if}
      </span>
    </div>

    <!-- Source + Shape row -->
    <div class="ctrl-row">
      <label>
        Source
        <select value={$settings.source} on:change={onSourceChange} disabled={isRecording}>
          <option value="mic">Microphone</option>
          <option value="noise">Noise Generator</option>
        </select>
      </label>
      <label>
        Shape
        <select value={$settings.shape} on:change={onShapeChange} disabled={isRecording}>
          {#each $pluginList as plug (plug.id)}
            <option value={plug.id}>{plug.label}</option>
          {/each}
        </select>
      </label>

      <span class="preset-indicator" title="Preset saved">{presetHas ? '★' : ''}</span>
      <button class:active={presetHas} on:click={onSavePreset}
              title="Save current settings as preset for this source + shape">
        Save preset
      </button>
      {#if presetHas}
        <button class="btn-clear" on:click={onClearPreset} title="Remove preset">✕</button>
      {/if}

      <!-- Advanced toggle -->
      <a href="#advanced" class="adv-toggle" on:click|preventDefault={() => advancedOpen = !advancedOpen}>
        Advanced {advancedOpen ? '▾' : '▸'}
      </a>

      <!-- Plugins toggle -->
      <a href="#plugins" class="adv-toggle" on:click|preventDefault={() => pluginPanelOpen = !pluginPanelOpen}>
        Plugins {pluginPanelOpen ? '▾' : '▸'}
      </a>
    </div>

    <!-- Advanced panel -->
    {#if advancedOpen}
    <div class="advanced-panel">

      <!-- Data mode -->
      <div class="ctrl-row">
        <label>
          Data
          <select value={$settings.mode} on:change={onModeChange} disabled={isRecording}>
            <option value="time">Time</option>
            <option value="frequency">Frequency</option>
            <option value="stereo">Stereo</option>
          </select>
        </label>
      </div>

      <!-- Noise controls (only when source = noise) -->
      {#if isNoise}
      <div class="ctrl-row">
        <label>
          Type
          <select value={$settings.noiseType} on:change={onNoiseTypeChange}>
            <option value="perlin">Perlin fBm</option>
            <option value="sine">Sine Sum</option>
            <option value="white">White Noise</option>
          </select>
        </label>
        <label>
          Seed
          <input type="number" value={$settings.noiseSeed} min="0" max="99999" step="1"
                 on:change={onNoiseSeedChange} style="width:70px">
        </label>
        <label>
          Speed
          <input type="range" min="0.001" max="0.04" step="0.001"
                 value={$settings.noiseSpeed}
                 on:input={e => { settings.patch({ noiseSpeed: +e.target.value }); _applyNoiseConfig(); }}>
          <output>{(+$settings.noiseSpeed).toFixed(3)}</output>
        </label>
        <label>
          Frequency
          <input type="range" min="0.5" max="8" step="0.5"
                 value={$settings.noiseFreq}
                 on:input={e => { settings.patch({ noiseFreq: +e.target.value }); _applyNoiseConfig(); }}>
          <output>{$settings.noiseFreq}</output>
        </label>
        {#if !isWhiteNoise}
        <label>
          Octaves
          <input type="range" min="1" max="6" step="1"
                 value={$settings.noiseOct}
                 on:input={e => { settings.patch({ noiseOct: +e.target.value }); _applyNoiseConfig(); }}>
          <output>{$settings.noiseOct}</output>
        </label>
        <label>
          Persistence
          <input type="range" min="0.1" max="0.9" step="0.05"
                 value={$settings.noisePers}
                 on:input={e => { settings.patch({ noisePers: +e.target.value }); _applyNoiseConfig(); }}>
          <output>{$settings.noisePers}</output>
        </label>
        {/if}
      </div>
      {/if}

      <!-- Recording settings -->
      <div class="ctrl-row">
        <label>
          Max Frames
          <input type="number" min="8" max="256" step="1"
                 value={$settings.maxFrames} disabled={isRecording}
                 on:change={e => settings.patch({ maxFrames: +e.target.value })} style="width:60px">
        </label>
        <label>
          Amp Scale
          <input type="number" step="0.1" min="0.1" max="10"
                 value={$settings.ampScale} disabled={isRecording}
                 on:input={e => settings.patch({ ampScale: +e.target.value })} style="width:60px">
        </label>
        <label>
          FFT Size
          <input type="number" min="32" max="2048" step="32"
                 value={$settings.fftSize} disabled={isRecording}
                 on:change={e => settings.patch({ fftSize: +e.target.value })} style="width:60px">
        </label>
        <label>
          Record FPS
          <input type="number" min="1" max="30" step="1"
                 value={$settings.recordFps} disabled={isRecording}
                 on:change={e => settings.patch({ recordFps: +e.target.value })} style="width:55px">
        </label>
        <!-- Smoothing: mic only -->
        {#if !isNoise}
        <label>
          Smoothing
          <input type="number" min="0" max="0.95" step="0.05"
                 value={$settings.smoothing}
                 on:input={e => { settings.patch({ smoothing: +e.target.value }); audio.setSmoothing(+e.target.value); }}>
        </label>
        {/if}
      </div>

      <!-- Camera controls -->
      <div class="ctrl-row">
        <label>
          Cam pos
          <input type="text" bind:this={camPosInput} value={$settings.cameraPos} spellcheck="false"
                 on:change={e => settings.patch({ cameraPos: e.target.value })}
                 on:keydown={e => e.key === 'Enter' && onCameraSet()}
                 style="width:110px">
        </label>
        <label>
          Target
          <input type="text" bind:this={camTgtInput} value={$settings.cameraTgt} spellcheck="false"
                 on:change={e => settings.patch({ cameraTgt: e.target.value })}
                 on:keydown={e => e.key === 'Enter' && onCameraSet()}
                 style="width:110px">
        </label>
        <button on:click={onCameraSet}>Set</button>
        <button on:click={onCameraReset}>Reset</button>
      </div>
    </div>
    {/if}

    <!-- Plugin manager panel -->
    {#if pluginPanelOpen}
    <div class="advanced-panel plugin-panel">
      <!-- Installed user plugins -->
      {#if $userPluginIds.length > 0}
      <div class="ctrl-row">
        <span class="plugin-list-label">Installed:</span>
        {#each $pluginList.filter(p => $userPluginIds.includes(p.id)) as plug (plug.id)}
          <span class="plugin-chip">
            {plug.label}
            <button class="btn-clear" on:click={() => onUninstallPlugin(plug.id)} title="Remove plugin">✕</button>
          </span>
        {/each}
      </div>
      {/if}

      <!-- Install section -->
      <div class="ctrl-row plugin-install-row">
        <textarea
          class="plugin-code"
          bind:value={pluginCode}
          rows="6"
          spellcheck="false"
          placeholder={'// Paste plugin code here, then click Install.\n// Plugin must use: export default { id, label, cameraPosition, buildPerFrame(frameData, frameIndex, isLive, ctx) { ... } }'}
        ></textarea>
        <div class="plugin-actions">
          <label class="plugin-file-label" title="Load a .js file">
            Load .js
            <input type="file" accept=".js" on:change={onPluginFileLoad} style="display:none">
          </label>
          <button on:click={onInstallPlugin} disabled={installing || !pluginCode.trim()}>
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
        {#if installError}
          <span class="plugin-error">{installError}</span>
        {/if}
      </div>
    </div>
    {/if}

  </div>
</div>

<style>
  .wave-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .viz-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .hud {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 5px;
    pointer-events: none;
  }

  .ctrl-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 80%, transparent 100%);
    padding: 5px 6px;
    border-radius: 4px;
    pointer-events: all;
  }

  .advanced-panel {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .status        { font-size: 12px; color: #888; }
  .status.active { color: #00d4ff; }
  .status.done   { color: #44bb44; }

  .frame-counter { font-size: 12px; color: #666; }

  .preset-indicator { color: #f4c430; font-size: 14px; }

  .adv-toggle {
    color: #00d4ff;
    font-size: 12px;
    text-decoration: none;
    cursor: pointer;
  }

  button.recording {
    background: #550000;
    border-color: #ff4444;
    color: #ff8888;
    animation: pulse 1.2s ease-in-out infinite;
  }

  button.active {
    border-color: #f4c430;
    color: #f4c430;
  }
  .btn-clear {
    padding: 2px 6px;
    font-size: 11px;
    color: #888;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.6; }
  }

  .plugin-panel {
    gap: 5px;
  }

  .plugin-list-label {
    font-size: 12px;
    color: #888;
  }

  .plugin-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: rgba(0, 212, 255, 0.1);
    border: 1px solid #00d4ff44;
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 12px;
    color: #00d4ff;
  }

  .plugin-install-row {
    flex-direction: column;
    align-items: stretch;
  }

  .plugin-code {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: #111;
    color: #ccc;
    border: 1px solid #333;
    border-radius: 3px;
    padding: 5px;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.4;
  }

  .plugin-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .plugin-file-label {
    cursor: pointer;
    display: inline-block;
    padding: 2px 8px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 3px;
    font-size: 12px;
    color: #aaa;
  }

  .plugin-error {
    color: #ff6666;
    font-size: 11px;
    margin-top: 3px;
    word-break: break-all;
  }
</style>
