<script>
  import { activeTab } from './stores/ui.js';
  import WaveRecorder from './modules/WaveRecorder.svelte';
  import GcodeHandler from './modules/GcodeHandler.svelte';
  import SerialTransmission from './modules/SerialTransmission.svelte';
  import * as serial from './lib/serial.js';

  let showHelp = false;

  // Disconnect serial on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => serial.disconnect());
  }
</script>

<!-- Tab bar -->
<nav class="tab-bar">
  <button class="tab-btn" class:active={$activeTab === 'wave'}   on:click={() => activeTab.set('wave')}>
    Wave
  </button>
  <button class="tab-btn" class:active={$activeTab === 'gcode'}  on:click={() => activeTab.set('gcode')}>
    G-code
  </button>
  <button class="tab-btn" class:active={$activeTab === 'serial'} on:click={() => activeTab.set('serial')}>
    Serial
  </button>
  <div class="tab-spacer"></div>
  <button class="tab-help" on:click={() => showHelp = true}>?</button>
</nav>

<!-- All modules always mounted — visibility controlled by CSS class -->
<div class="tab-content" class:active={$activeTab === 'wave'}>
  <WaveRecorder />
</div>
<div class="tab-content" class:active={$activeTab === 'gcode'}>
  <GcodeHandler />
</div>
<div class="tab-content" class:active={$activeTab === 'serial'}>
  <SerialTransmission />
</div>

<!-- Help modal -->
{#if showHelp}
<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Help" tabindex="-1"
     on:click|self={() => showHelp = false}
     on:keydown={e => e.key === 'Escape' && (showHelp = false)}>
  <div class="modal-content">
    <button class="modal-close" on:click={() => showHelp = false}>×</button>
    <h2>Audio Wave Visualizer → G-code</h2>

    <h3>Workflow</h3>
    <ol>
      <li>Choose a <strong>Source</strong> (microphone or noise) and a <strong>Shape</strong>.</li>
      <li>Click <strong>Record</strong> — captures frames at the configured Record FPS, auto-stops at Max Frames.</li>
      <li>Orbit the 3D view with the mouse, then click <strong>Pattern → G-code</strong> to pass the current view to the G-code module.</li>
      <li>In the <strong>G-code</strong> tab, export or send the plot to the plotter.</li>
    </ol>

    <h3>Camera</h3>
    <table><tbody>
      <tr><td>Left drag</td><td>Orbit</td></tr>
      <tr><td>Right drag / two-finger</td><td>Pan</td></tr>
      <tr><td>Scroll / pinch</td><td>Zoom</td></tr>
    </tbody></table>
    <p>Cam Pos and Target (in Advanced) show the current coordinates. Paste them back and click <strong>Set</strong> to restore a saved view.</p>

    <h3>Source</h3>
    <table><tbody>
      <tr><td>Microphone</td><td>Live audio from the browser microphone.</td></tr>
      <tr><td>Noise Generator</td><td>Algorithmic signal — no microphone needed. Seed value makes it reproducible.</td></tr>
    </tbody></table>

    <h3>Shape</h3>
    <table><tbody>
      <tr><td>Linear</td><td>Stacked wave rows.</td></tr>
      <tr><td>Circular</td><td>Concentric ring per frame.</td></tr>
      <tr><td>Spiral</td><td>Outward spiral of wave rings.</td></tr>
      <tr><td>Lissajous</td><td>Left vs right channel XY plot.</td></tr>
      <tr><td>Phyllotaxis</td><td>Sunflower / golden-angle spiral.</td></tr>
      <tr><td>Tube</td><td>Helix with radial wave ribs.</td></tr>
      <tr><td>Terrain</td><td>Horizon-occluded ridges (Joy Division style).</td></tr>
      <tr><td>Landscape</td><td>Terrain with opaque filled ridges and cross-lines.</td></tr>
      <tr><td>Harmonograph</td><td>Two-pendulum parametric curve with damping.</td></tr>
      <tr><td>Flow Field</td><td>Streamlines steered by frequency spectrum.</td></tr>
      <tr><td>Epicycles</td><td>DFT arm snapshots per frame.</td></tr>
      <tr><td>Chladni</td><td>Nodal-line patterns from resonance modes.</td></tr>
      <tr><td>Moiré</td><td>Offset concentric rings producing moiré fringes.</td></tr>
      <tr><td>Heatmap</td><td>Frequency spectrogram grid with cross-hatch density.</td></tr>
      <tr><td>Quantized Noise</td><td>Joy Division ridges with stepped amplitude bands; colored hatch fills in the largest gap regions.</td></tr>
    </tbody></table>

    <h3>Advanced — Data</h3>
    <table><tbody>
      <tr><td>Time</td><td>Raw waveform samples.</td></tr>
      <tr><td>Frequency</td><td>FFT magnitude spectrum.</td></tr>
      <tr><td>Stereo</td><td>Average of left and right channels.</td></tr>
    </tbody></table>

    <h3>Advanced — Noise</h3>
    <table><tbody>
      <tr><td>Type</td><td>Perlin fBm, Sine Sum, or White Noise.</td></tr>
      <tr><td>Seed</td><td>Integer seed — same seed always produces the same pattern.</td></tr>
      <tr><td>Speed</td><td>How fast the noise evolves over time.</td></tr>
      <tr><td>Frequency</td><td>Spatial frequency of the noise field.</td></tr>
      <tr><td>Octaves</td><td>Layers of detail (Perlin / Sine only).</td></tr>
      <tr><td>Persistence</td><td>Amplitude falloff per octave (Perlin / Sine only).</td></tr>
    </tbody></table>

    <h3>Advanced — Settings</h3>
    <table><tbody>
      <tr><td>Max Frames</td><td>Frame count at which recording auto-stops (8–256).</td></tr>
      <tr><td>Amp Scale</td><td>Vertical exaggeration of the waveform amplitude.</td></tr>
      <tr><td>FFT Size</td><td>Audio analysis window size. Higher = more frequency detail.</td></tr>
      <tr><td>Record FPS</td><td>Frames captured per second (1–30).</td></tr>
      <tr><td>Smoothing</td><td>Mic frequency-mode averaging (0 = raw, 0.95 = very smooth).</td></tr>
    </tbody></table>

    <h3>G-code Module</h3>
    <table><tbody>
      <tr><td>Pattern → G-code</td><td>Sends the current 3D wave view (as projected G-code paths) to the G-code module.</td></tr>
      <tr><td>Pattern → Stereo</td><td>Sends anaglyph (left + right eye) paths for red-cyan 3D glasses printing.</td></tr>
      <tr><td>Import G-code</td><td>Load an existing .gcode file to preview and re-send.</td></tr>
      <tr><td>Export G-code</td><td>Download the current paths as a GRBL file for your plotter.</td></tr>
    </tbody></table>

    <h3>Serial Module</h3>
    <p>Requires Chrome or Edge over HTTPS / localhost. Connects directly to GRBL over USB Serial (115200 baud).</p>
    <table><tbody>
      <tr><td>Send to Plotter</td><td>Streams G-code line-by-line with GRBL acknowledgement.</td></tr>
      <tr><td>Frame</td><td>Traces the bounding box of the current plot with pen raised.</td></tr>
      <tr><td>Home</td><td>Runs the GRBL homing cycle ($H). Requires limit switches.</td></tr>
      <tr><td>Zero X,Y</td><td>Zeros X and Y work coordinates at the current head position.</td></tr>
      <tr><td>Zero Z</td><td>Zeros Z at the current height.</td></tr>
      <tr><td>Pen Up / Pen Down</td><td>Move pen to configured Z/servo positions.</td></tr>
      <tr><td>Sweep S</td><td>Ramps M3 S0→S1000→S0 to find servo range.</td></tr>
      <tr><td>Cal</td><td>Draws horizontal marks across Y range to calibrate servo Y compensation.</td></tr>
      <tr><td>Jog</td><td>Move the head in X, Y, or Z by the selected step size.</td></tr>
    </tbody></table>

    <h3>Export Filename</h3>
    <p>The filename is a three-word name derived from the generation parameters — the same settings always produce the same name. All parameters are also written as comments at the top of the G-code file.</p>
  </div>
</div>
{/if}

<svelte:window on:keydown={e => { if (e.key === 'Escape') showHelp = false; }} />

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }

  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #0a0a0a;
    color: #e0e0e0;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
  }

  :global(button) {
    background: #1e1e1e;
    color: #e0e0e0;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s, border-color 0.15s;
  }
  :global(button:hover:not(:disabled)) { background: #2a2a2a; border-color: #555; }
  :global(button:disabled) { opacity: 0.45; cursor: default; }

  :global(input[type="number"], input[type="text"], select) {
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #3a3a3a;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 12px;
    width: 80px;
  }
  :global(input[type="range"]) {
    accent-color: #00d4ff;
    width: 90px;
  }
  :global(select) { width: auto; }

  :global(label) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  :global(.hidden) { display: none !important; }

  /* Tab bar */
  .tab-bar {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 44px;
    background: rgba(10,10,10,0.97);
    border-bottom: 1px solid #2a2a2a;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    z-index: 100;
  }

  .tab-btn {
    height: 28px;
    padding: 0 16px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    background: transparent;
    border: 1px solid transparent;
    color: #888;
    transition: all 0.15s;
  }
  .tab-btn:hover  { color: #ccc; background: #1e1e1e; border-color: #3a3a3a; }
  .tab-btn.active { color: #00d4ff; background: #0e2230; border-color: #00d4ff55; }

  .tab-spacer { flex: 1; }

  .tab-help {
    width: 28px; height: 28px;
    border-radius: 50%;
    padding: 0;
    font-size: 14px;
    font-weight: bold;
    border: 1px solid #3a3a3a;
    background: #1e1e1e;
    color: #888;
  }
  .tab-help:hover { color: #e0e0e0; border-color: #555; }

  /* Tab content areas */
  .tab-content {
    display: none;
    position: fixed;
    top: 44px; left: 0; right: 0; bottom: 0;
  }
  .tab-content.active { display: block; }

  /* Help modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal-content {
    background: #141414;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 24px 28px;
    max-width: 620px;
    width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
  }

  .modal-close {
    position: absolute;
    top: 12px; right: 14px;
    font-size: 20px;
    line-height: 1;
    width: 28px; height: 28px;
    padding: 0;
    border-radius: 4px;
  }

  .modal-content h2 { margin: 0 0 16px; font-size: 16px; color: #00d4ff; }
  .modal-content h3 { font-size: 13px; color: #aaa; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }
  .modal-content table { width: 100%; border-collapse: collapse; }
  .modal-content td { padding: 3px 8px; border-bottom: 1px solid #1e1e1e; vertical-align: top; }
  .modal-content td:first-child { color: #00d4ff; white-space: nowrap; width: 160px; }
  .modal-content ol, .modal-content p { margin: 4px 0; line-height: 1.5; }
  .modal-content li { margin-bottom: 4px; }
</style>
