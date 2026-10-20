import { test, expect } from '@playwright/test';

const SHAPES = [
  'linear', 'circular', 'spiral', 'lissajous', 'terrain',
  'harmonograph', 'moire', 'landscape', 'heatmap', 'quantized',
];

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

async function recordWave(page, shape) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('noise');
  await page.getByRole('combobox', { name: 'Shape', exact: true }).selectOption(shape);
  await page.getByRole('link', { name: /^Advanced/ }).click();
  await page.getByLabel('Seed', { exact: true }).fill('42');
  await page.getByLabel('Seed', { exact: true }).press('Tab');
  await page.getByLabel('Max Frames', { exact: true }).fill('30');
  await page.getByLabel('Max Frames', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('link', { name: /^Advanced/ }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.clock.runFor(3100);
  await expect(page.locator('.frame-counter')).toHaveText('30 frames');
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pattern → G-code', exact: true })).toBeEnabled();
}

test.describe('Wave 3D canvas', () => {
  for (const shape of SHAPES) {
    test(shape, async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await recordWave(page, shape);
      await expect(page.locator('.viz-canvas')).toHaveScreenshot(`${shape}.png`);
      expect(errors).toEqual([]);
    });
  }

  for (const [view, position] of [
    ['oblique', '18 12 28'],
    ['low-angle', '18 3 28'],
  ]) {
    test(`quantized fills follow the ridges: ${view}`, async ({ page }) => {
      await recordWave(page, 'quantized');
      await page.getByRole('link', { name: /^Advanced/ }).click();
      await page.getByLabel('Cam pos', { exact: true }).fill(position);
      await page.getByLabel('Target', { exact: true }).fill('0 1 10');
      await page.getByRole('button', { name: 'Set', exact: true }).click();
      await page.getByRole('link', { name: /^Advanced/ }).click();
      await page.clock.runFor(500);
      await expect(page.locator('.viz-canvas')).toHaveScreenshot(`quantized-${view}.png`);
    });
  }
});
