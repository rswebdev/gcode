# Visualization Plugin API

Custom 3D visualization shapes can be installed at runtime in the **Wave** tab. A plugin is a single ES module file with a default export that conforms to the visualizer plugin contract.

> **Note:** This is a separate system from the [GenArt Plugin API](./genart-plugin-api.md). Visualization plugins produce **3D audio-reactive geometry** in the Wave tab. GenArt plugins produce **2D plotter paths** in the Gen Art tab.

---

## Quick start

```js
export default {
  id:    'my-lines',
  label: 'My Lines',

  cameraPosition: { pos: [0, 15, 20], lookAt: [0, 0, 10] },

  buildPerFrame(frameData, frameIndex, isLive, ctx) {
    const data   = ctx.toMono(frameData);
    const N      = data.length;
    const zStep  = ctx.constants.SCENE_DEPTH / ctx.cfg.maxFrames;
    const pos    = new Float32Array(N * 3);

    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (i / (N - 1)) * ctx.constants.SCENE_W - ctx.constants.SCENE_W / 2;
      pos[i * 3 + 1] = data[i] * 4 * ctx.cfg.ampScale;
      pos[i * 3 + 2] = frameIndex * zStep;
    }

    return [ctx.makeLine(pos, frameIndex, isLive)];
  },
};
```

---

## Contract

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique shape identifier. Cannot shadow built-in shape IDs. |
| `label` | `string` | Display name in the Shape dropdown. |
| `cameraPosition` | `object` | Starting camera pose. |
| `cameraPosition.pos` | `[x,y,z]` | Camera position in scene units. |
| `cameraPosition.lookAt` | `[x,y,z]` | Point the camera looks at. |

### Geometry mode — choose one

#### Append mode (`rebuildAll` omitted or `false`)

New frames are added incrementally. Ideal for layered shapes (Linear, Circular, etc.).

```js
buildPerFrame(frameData, frameIndex, isLive, ctx) {
  // Called once per new recorded frame.
  // Returns: THREE.Object3D[]
}
```

#### Rebuild mode (`rebuildAll: true`)

The scene is rebuilt from all frames every tick. Ideal for shapes that depend on the entire recording (Spiral, Harmonograph, etc.).

```js
rebuild(allFrames, isLive, ctx) {
  // Called with ALL recorded frames.
  // Use ctx.addObject() to add geometry.
  // Does NOT return a value.
}
```

---

## Optional exports

### `buildLiveLine(frameData, allFrames, frameCount, ctx) → THREE.Object3D | null`

Renders a real-time preview line while recording is active (the "live" cursor). Called every animation frame. Return `null` to render nothing.

### `getProjectedPaths() → Array<Array<{nx, ny}>>`

Override the default camera-projection export. Return paths in NDC `[-1, +1]` if your shape has non-standard geometry that doesn't project correctly through the default perspective projection.

---

## The `ctx` context object

Every plugin callback receives `ctx`:

```js
ctx = {
  // Three.js reference — import THREE objects without bundling the library
  THREE,

  // The current THREE.Scene — add/remove objects directly if needed
  scene,

  // Current configuration
  cfg: {
    ampScale: number,   // amplitude scale factor (user-configurable)
    maxFrames: number,  // maximum frames in recording
  },
  scaleFactor: number,  // global scale applied to scene geometry

  // Scene dimension constants
  constants: {
    SCENE_W:      20,   // total scene width in scene units (X: -10 to +10)
    SCENE_DEPTH:  20,   // total scene depth in scene units (Z: 0 to +20)
    INNER_R:     0.5,   // polar inner radius (scene units)
    OUTER_R:     9.0,   // polar outer radius (scene units)
    SPIRAL_TURNS:  3,   // full rotations for spiral-type shapes
    LISS_SCALE:    7,   // scene units for Lissajous extents
  },

  // Helpers
  makeLine(pos, frameIndex, isLive),  // Create a styled THREE.Line from a Float32Array of XYZ triples
  toMono(frameData),                  // Convert stereo frame → mono Float32Array (averages channels)
  isStereo(frameData),                // Returns true if frameData is interleaved stereo
  addObject(obj),                     // Add obj to waveLines list and to the THREE scene (use in rebuild mode)
}
```

---

## Working with audio data

`frameData` is a `Float32Array` of audio samples. The format depends on the **Data Mode** setting:

| Data Mode | Format | Notes |
|---|---|---|
| Time | Mono `Float32Array` | Time-domain samples, range ≈ [−1, +1] |
| Frequency | Mono `Float32Array` | Frequency bins, range [0, 255] (normalise to [0, 1]) |
| Stereo | Interleaved `Float32Array` | Even indices = left, odd = right; use `ctx.isStereo()` to detect |

Use `ctx.toMono(frameData)` to safely collapse any format to a mono array.

---

## Installing a plugin

1. Open the **Wave** tab.
2. Click **Plugins** in the sidebar.
3. Paste your ES module source or click **Load file**.
4. Click **Install** — the shape appears immediately in the Shape dropdown.
5. Plugins are persisted in `localStorage` (key: `gcode-viz-user-plugins`) and restored on reload.

---

## Security

Plugin code runs in the **main app context** with full browser origin access (localStorage, DOM, network). This is intentional for a local developer tool. Never install plugins from untrusted sources.

---

## Scene coordinate system

```
        Y (up)
        │
        │
        └──── X (right, -10 to +10)
       /
      Z (toward viewer, 0 to +20)
```

Frames are stacked along the **Z axis**. Frame 0 starts at `Z = 0`; each subsequent frame steps back by `SCENE_DEPTH / maxFrames`. The camera typically looks from a raised Y position toward the stacked layers.

---

## Built-in shapes (for reference)

| Shape | Mode | Description |
|---|---|---|
| `linear` | Append | Joy Division-style stacked horizontal wave rows |
| `circular` | Append | Concentric rings; amplitude modulates radius |
| `spiral` | Rebuild | All frames joined into one continuous outward spiral |
| `lissajous` | Append | Left vs right channel XY scatter/trace |
| `terrain` | Rebuild | Horizon-masked ridges with painters-algorithm occlusion |
| `landscape` | Rebuild | Terrain with opaque black fill polygons and crest lines |
| `harmonograph` | Rebuild | DFT-derived two-pendulum Lissajous with damping |
| `moire` | Append | Two offset concentric ring families producing interference fringes |
| `heatmap` | Append | Frequency spectrogram grid; amplitude → circle radius per cell |
| `quantized` | Rebuild | Joy Division with 8 quantized amplitude bands; gap regions hatched |
