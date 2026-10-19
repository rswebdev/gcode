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
  await expect(page.getByRole('button', { name: 'Wave',   exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'G-code', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Serial', exact: true })).toBeVisible();
});

test('tab switching shows the correct panel', async ({ page }) => {
  await page.goto('/');
  // Wave tab is active by default
  const waveBtn   = page.getByRole('button', { name: 'Wave',   exact: true });
  const gcodeBtn  = page.getByRole('button', { name: 'G-code', exact: true });
  const serialBtn = page.getByRole('button', { name: 'Serial', exact: true });

  await expect(waveBtn).toHaveClass(/active/);

  await gcodeBtn.click();
  await expect(gcodeBtn).toHaveClass(/active/);
  await expect(waveBtn).not.toHaveClass(/active/);

  await serialBtn.click();
  await expect(serialBtn).toHaveClass(/active/);
  await expect(gcodeBtn).not.toHaveClass(/active/);
});

test('Code Art runs helper functions and sends paths to G-code', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  await expect(page.getByLabel('Algorithm')).toHaveValue('code-art');
  const editor = page.locator('.cm-content[aria-label="Art code"]');
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  const syntaxColors = await editor.evaluate(element => new Set(
    [...element.querySelectorAll('span')].map(token => getComputedStyle(token).color)
  ).size);
  expect(syntaxColors).toBeGreaterThan(1);
  await editor.fill('sc');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('scene');
  await page.locator('.cm-completionLabel').filter({ hasText: /^scene$/ }).click();
  await expect(editor).toContainText('scene().add()');
  await editor.fill('solid.s');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('sphere');
  await editor.fill('solid.h');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('heightfield');
  await editor.fill('sp');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('sphere');
  await page.locator('.cm-completionLabel').filter({ hasText: /^sphere$/ }).click();
  await expect(editor).toContainText('sphere({ detail: 10');
  await editor.fill(`
    return combine(
      sphere({ detail: 6 }),
      transform(cube({ detail: 6 }), { scale: 0.25, translateX: 0.6 }),
      torus({ detail: 6 }),
      cylinder({ detail: 6 }),
      circle({ radius: 0.2 }),
      polyline([[-0.8, -0.8], [-0.6, -0.8], [-0.6, -0.6]], { close: true }),
      scene().add(
        solid.sphere({ detail: 6 }).scale(0.4).translate(-0.7, 0.2, 0),
        solid.cube({ detail: 6 }).rotate(20, 0, 35).translate(0.7, 0.2, 0)
      ).render({
        position: [4, -6, 4],
        target: [0, 0, 0],
        up: [0, 0, 1],
        fov: 45
      })
    );
  `);
  await page.reload();
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  const reloadedEditor = page.locator('.cm-content[aria-label="Art code"]');
  await expect(reloadedEditor).toContainText(/return combine/);

  const sendButton = page.getByRole('button', { name: '→ G-code' });
  const canvas = page.locator('.genart-wrap canvas');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  const coloredPixels = await canvas.evaluate(element => {
    const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50 && data[i + 1] > 100 && data[i + 2] > 150) count++;
    }
    return count;
  });
  expect(coloredPixels).toBeGreaterThan(0);

  await sendButton.click();
  await expect(page.getByRole('button', { name: 'G-code', exact: true })).toHaveClass(/active/);
});

test('Code Art renders composed objects through a shared scene', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  await expect(page.getByLabel('Algorithm')).toHaveValue('code-art');
  const sendButton = page.getByRole('button', { name: '→ G-code' });
  const examples = page.getByLabel('Examples');
  const editor = page.locator('.cm-content[aria-label="Art code"]');
  const algorithm = page.getByLabel('Algorithm');
  const canvas = page.locator('.genart-wrap canvas');
  for (const example of ['cube-study', 'sphere-study', 'orbital-sculpture', 'helix-tower', 'courtyard', 'droplet-ripples']) {
    await examples.selectOption(example);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(editor).not.toBeEmpty();
    await algorithm.selectOption('spirograph');
    await algorithm.selectOption('code-art');
    await expect(sendButton).toBeDisabled();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });

    const coloredPixels = await canvas.evaluate(element => {
      const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 50 && data[i + 1] > 100 && data[i + 2] > 150) count++;
      }
      return count;
    });
    expect(coloredPixels, `${example} should render scene paths`).toBeGreaterThan(0);
    if (example === 'courtyard') {
      await expect(canvas).toHaveScreenshot('code-art-courtyard.png');
    }
    if (example === 'droplet-ripples') {
      await expect(canvas).toHaveScreenshot('code-art-droplet-ripples.png');
      await sendButton.click();
      await expect(page.getByRole('button', { name: 'G-code', exact: true })).toHaveClass(/active/);
    }
  }
});

test('Code Art height-field grid renders and reports invalid height formulas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  const editor = page.locator('.cm-content[aria-label="Art code"]');
  const generate = page.getByRole('button', { name: 'Generate', exact: true });
  const error = page.locator('.genart-wrap .error-msg');
  await editor.fill(`return scene().add(solid.heightfield({
    height: () => NaN, lines: 12, samples: 24
  })).render();`);
  await generate.click();
  await expect(error).toContainText('Height field height must be finite');
  await editor.fill(`return scene().add(solid.heightfield({
    height: (x, y) => 0.2 * Math.cos(6 * Math.hypot(x, y)),
    lines: 24, samples: 48, style: 'grid'
  }).rotate(0, 0, 15)).render();`);
  await generate.click();
  await expect(error).toHaveCount(0);
  await expect(page.getByRole('button', { name: '→ G-code' })).toBeEnabled();
  const colored = await page.locator('.genart-wrap canvas').evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50 && data[i + 1] > 100 && data[i + 2] > 150) count++;
    }
    return count;
  });
  expect(colored).toBeGreaterThan(1000);
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

test('help modal lists all 10 shapes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '?' }).click();
  const modal = page.getByRole('dialog');
  const expectedShapes = [
    'Linear', 'Circular', 'Spiral', 'Lissajous',
    'Terrain', 'Landscape', 'Harmonograph', 'Moiré', 'Heatmap', 'Quantized Noise',
  ];
  for (const name of expectedShapes) {
    await expect(modal.getByText(name, { exact: true })).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// Shape selector
// ---------------------------------------------------------------------------

test('shape selector contains all 10 options', async ({ page }) => {
  await page.goto('/');
  const shapeSelect = page.getByLabel('Shape');
  const expectedValues = [
    'linear', 'circular', 'spiral', 'lissajous',
    'terrain', 'harmonograph', 'moire', 'landscape', 'quantized', 'heatmap',
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
