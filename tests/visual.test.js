// Visual regression tests for all 15 visualization shapes.
//
// First run — generate the golden screenshot baselines:
//   npx playwright test --update-snapshots tests/visual.test.js
//
// Subsequent runs compare the rendered canvas against those stored PNG files.
// Baselines are committed to: tests/visual.test.js-snapshots/

import { test, expect } from '@playwright/test';

const ALL_SHAPES = [
  'linear', 'circular', 'spiral', 'lissajous', 'phyllotaxis',
  'tube', 'terrain', 'harmonograph', 'flowfield', 'epicycles',
  'chladni', 'moire', 'landscape', 'quantized', 'heatmap',
];

// ---------------------------------------------------------------------------
// Helper: select noise source, pick shape, set a fixed seed and small
// maxFrames, then record until the capture is complete.
// ---------------------------------------------------------------------------
async function recordScene(page, shape, { seed = 42, maxFrames = 8 } = {}) {
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

  // Use a small frame count so the recording finishes quickly (~0.8 s).
  const maxFramesInput = page.getByLabel('Max Frames');
  await maxFramesInput.fill(String(maxFrames));
  await maxFramesInput.press('Tab');

  // Start recording, wait for it to begin (button becomes 'Stop')…
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5_000 });

  // …then wait for it to finish (button returns to 'Record').
  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible({ timeout: 15_000 });

  // Give Three.js one more frame to flush rendering.
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Sanity: frame counter shows the expected frame count after recording.
// ---------------------------------------------------------------------------
test('recording fills the requested frame count', async ({ page }) => {
  await recordScene(page, 'linear');
  await expect(page.locator('.frame-counter')).toContainText('8 frames');
});

// ---------------------------------------------------------------------------
// Visual regression: one golden screenshot per shape.
//
// The threshold of 0.2 (the Playwright default) means individual pixels may
// vary up to 20 % in perceived brightness — enough to absorb minor
// GPU-level or anti-aliasing differences between machines.
// ---------------------------------------------------------------------------
test.describe('canvas renders each shape correctly', () => {
  for (const shape of ALL_SHAPES) {
    test(shape, async ({ page }) => {
      await recordScene(page, shape);
      await expect(page.locator('.viz-canvas')).toHaveScreenshot(`${shape}.png`);
    });
  }
});
