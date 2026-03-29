// Visual regression tests for all 15 visualization shapes.
//
// Strategy: record with a fixed seed, then project to the G-code preview
// (Pattern → G-code). The 2D preview canvas is a static, deterministic
// render — no live animation line — so screenshots are pixel-stable across
// retries and runs.
//
// First run — generate the golden screenshot baselines:
//   npx playwright test --update-snapshots tests/visual.test.js
//
// Subsequent runs compare the rendered canvas against those stored PNG files.
// Baselines are committed to: tests/visual.test.js-snapshots/

import { test, expect } from '@playwright/test';

const ALL_SHAPES = [
  'linear', 'circular', 'spiral', 'lissajous',
  'terrain', 'harmonograph', 'moire', 'landscape', 'quantized', 'heatmap',
];

// Per-shape frame counts — shapes that need more frames to produce visible
// G-code output get their own value; everything else uses the default 12.
const SHAPE_MAX_FRAMES = {
  quantized: 24,   // needs more frames so quantized bands are populated
  landscape: 18,   // ridge fill benefits from a few extra rows
};

// ---------------------------------------------------------------------------
// Helper: select noise source, pick shape, set a fixed seed and small
// maxFrames, record until capture is complete, then project to the
// G-code preview tab (which is a static 2D canvas — no live animation).
// ---------------------------------------------------------------------------
async function recordAndProject(page, shape, { seed = 42, maxFrames = SHAPE_MAX_FRAMES[shape] ?? 12 } = {}) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Use the noise generator — no microphone required.
  await page.getByLabel('Source').selectOption('noise');

  // Select the visualization shape.
  await page.getByLabel('Shape').selectOption(shape);

  // Open the Advanced panel so we can reach the seed and frame controls.
  await page.locator('.adv-toggle').click();

  // Fix the noise seed so output is deterministic across runs.
  const seedInput = page.getByLabel('Seed');
  await seedInput.fill(String(seed));
  await seedInput.press('Tab'); // commit value (fires on:change)

  // Use a small frame count so the recording finishes quickly.
  const maxFramesInput = page.getByLabel('Max Frames');
  await maxFramesInput.fill(String(maxFrames));
  await maxFramesInput.press('Tab');

  // Start recording, wait for it to begin (button becomes 'Stop')…
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5_000 });

  // …then wait for it to finish (button returns to 'Record').
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible({ timeout: 30_000 });

  // Project the 3D view to the G-code tab — this switches to the static 2D
  // preview canvas which has no live-animation line.
  await page.getByRole('button', { name: 'Pattern → G-code' }).click();

  // Guard: confirm the tab actually switched (fails if getProjectedPaths returned 0 paths).
  await expect(page.getByRole('button', { name: 'G-code', exact: true })).toHaveClass(/active/, { timeout: 5_000 });

  // Wait one animation frame for the 2D canvas redraw to flush.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
}

// ---------------------------------------------------------------------------
// Sanity: frame counter shows the expected frame count after recording.
// ---------------------------------------------------------------------------
test('recording fills the requested frame count', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Source').selectOption('noise');
  await page.locator('.adv-toggle').click();
  await page.getByLabel('Max Frames').fill('8');
  await page.getByLabel('Max Frames').press('Tab');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.frame-counter')).toContainText('8 frames');
});

// ---------------------------------------------------------------------------
// Visual regression: one golden screenshot per shape.
// ---------------------------------------------------------------------------
test.describe('canvas renders each shape correctly', () => {
  for (const shape of ALL_SHAPES) {
    test(shape, async ({ page }) => {
      await recordAndProject(page, shape);
      await expect(page.locator('.preview-canvas')).toHaveScreenshot(`${shape}.png`);
    });
  }
});
