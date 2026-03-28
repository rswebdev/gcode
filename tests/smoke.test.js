import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

test('page loads without JS errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(errors).toHaveLength(0);
});

test('page title contains G-code', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/G-code/i);
});

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

test('three tabs are visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Wave' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'G-code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Serial' })).toBeVisible();
});

test('tab switching shows the correct panel', async ({ page }) => {
  await page.goto('/');
  // Wave tab is active by default
  const waveBtn   = page.getByRole('button', { name: 'Wave' });
  const gcodeBtn  = page.getByRole('button', { name: 'G-code' });
  const serialBtn = page.getByRole('button', { name: 'Serial' });

  await expect(waveBtn).toHaveClass(/active/);

  await gcodeBtn.click();
  await expect(gcodeBtn).toHaveClass(/active/);
  await expect(waveBtn).not.toHaveClass(/active/);

  await serialBtn.click();
  await expect(serialBtn).toHaveClass(/active/);
  await expect(gcodeBtn).not.toHaveClass(/active/);
});

// ---------------------------------------------------------------------------
// Help modal
// ---------------------------------------------------------------------------

test('help modal opens on ? click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('help modal closes on × button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '×' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('help modal closes on Escape key', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('help modal closes on backdrop click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '?' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Click outside the modal content (top-left corner of backdrop)
  await dialog.click({ position: { x: 5, y: 5 } });
  await expect(dialog).not.toBeVisible();
});

test('help modal lists all 15 shapes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '?' }).click();
  const modal = page.getByRole('dialog');
  const expectedShapes = [
    'Linear', 'Circular', 'Spiral', 'Lissajous', 'Phyllotaxis',
    'Tube', 'Terrain', 'Landscape', 'Harmonograph', 'Flow Field',
    'Epicycles', 'Chladni', 'Moiré', 'Heatmap', 'Quantized Noise',
  ];
  for (const name of expectedShapes) {
    await expect(modal.getByText(name, { exact: false })).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// Shape selector
// ---------------------------------------------------------------------------

test('shape selector contains all 15 options', async ({ page }) => {
  await page.goto('/');
  const shapeSelect = page.getByLabel('Shape');
  const expectedValues = [
    'linear', 'circular', 'spiral', 'lissajous', 'phyllotaxis',
    'tube', 'terrain', 'harmonograph', 'flowfield', 'epicycles',
    'chladni', 'moire', 'landscape', 'quantized', 'heatmap',
  ];
  for (const value of expectedValues) {
    await expect(shapeSelect.locator(`option[value="${value}"]`)).toHaveCount(1);
  }
});

// ---------------------------------------------------------------------------
// Source selector
// ---------------------------------------------------------------------------

test('source selector has microphone and noise generator options', async ({ page }) => {
  await page.goto('/');
  const sourceSelect = page.getByLabel('Source');
  await expect(sourceSelect.locator('option[value="mic"]')).toHaveCount(1);
  await expect(sourceSelect.locator('option[value="noise"]')).toHaveCount(1);
});
