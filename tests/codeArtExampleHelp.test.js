import { test, expect } from '@playwright/test';
import { codeArtExamples } from '../src/lib/genart/codeArtExamples.js';
import {
  codeArtExampleHelp, getExampleCameraHelp, getWalkthroughLine,
} from '../src/lib/genart/codeArtExampleHelp.js';

test('every bundled example has substantial, source-aligned help and numeric coverage', () => {
  expect(Object.keys(codeArtExampleHelp).sort()).toEqual(codeArtExamples.map(example => example.id).sort());
  for (const example of codeArtExamples) {
    const guide = codeArtExampleHelp[example.id];
    expect(guide.summary.length, example.id).toBeGreaterThan(100);
    expect(guide.steps.length, example.id).toBeGreaterThanOrEqual(3);
    expect(guide.parameters.length, example.id).toBeGreaterThanOrEqual(2);
    expect(guide.experiments.length, example.id).toBeGreaterThanOrEqual(3);
    expect(guide.cautions.length, example.id).toBeGreaterThanOrEqual(2);
    const words = JSON.stringify(guide).split(/\s+/).length;
    expect(words, example.id).toBeGreaterThan(200);
    for (const section of guide.steps) {
      expect(section.explanation.length).toBeGreaterThan(90);
      const line = getWalkthroughLine(example, section);
      expect(example.code.split('\n').slice(line - 1).join('\n')).toContain(section.code);
    }
    for (const row of guide.parameters) {
      expect(example.code, `${example.id}: ${row.code}`).toContain(row.code);
      expect(row.meaning.length, `${example.id}: ${row.code}`).toBeGreaterThan(30);
      expect(row.experiment.length).toBeGreaterThan(30);
    }
    const camera = getExampleCameraHelp(example);
    expect(camera).toHaveLength(example.dimension === 2 ? 0 : 4);
    const numericLiterals = text => new Set(text.match(/\b\d+(?:\.\d+)?\b/g));
    const documentedValues = numericLiterals([...guide.parameters, ...camera].map(row => row.code).join(' '));
    for (const number of numericLiterals(example.code.replace(/\/\/.*/g, ''))) {
      expect(documentedValues.has(number), `${example.id}: numeric literal ${number} needs a parameter entry`).toBe(true);
    }
  }
});

test('help source excerpts fail explicitly if example code drifts', () => {
  expect(() => getWalkthroughLine(codeArtExamples[0], { code: 'nonexistent snippet' })).toThrow(/excerpt not found/);
});

async function openHelp(page, exampleId = 'droplet-ripples') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  await page.getByLabel('Examples', { exact: true }).selectOption(exampleId);
  await page.getByRole('button', { name: 'Example help', exact: true }).click();
  return page.getByRole('dialog', { name: codeArtExamples.find(example => example.id === exampleId).label, exact: true });
}

test('help drawer documents every example without replacing or running edited code', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  const editor = page.locator('.cm-content[aria-label="Art code"]');
  const customCode = 'return polyline([[0, 0], [0.5, 0.5]]);';
  await editor.fill(customCode);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const send = page.getByRole('button', { name: '→ G-code', exact: true });
  await expect(send).toBeEnabled();
  const canvas = page.locator('.genart-wrap canvas');
  const before = await canvas.evaluate(element => element.toDataURL());
  await page.getByLabel('Examples', { exact: true }).selectOption('courtyard');
  const helpButton = page.getByRole('button', { name: 'Example help', exact: true });
  await helpButton.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Courtyard', exact: true })).toBeVisible();
  await expect(drawer).toContainText('not your edited code');
  await expect(drawer.getByRole('button', { name: 'Close example help', exact: true })).toBeFocused();
  await expect(drawer).toHaveScreenshot('example-help-desktop.png');

  for (const example of codeArtExamples) {
    await drawer.getByLabel('Guide example', { exact: true }).selectOption(example.id);
    await expect(drawer.getByRole('heading', { name: example.label, exact: true })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Code walkthrough', exact: true })).toBeVisible();
    await expect(drawer.locator('#example-help-overview')).toContainText(codeArtExampleHelp[example.id].summary);
    await expect(drawer.locator('tbody tr')).toHaveCount(codeArtExampleHelp[example.id].parameters.length);
    await expect(drawer.locator('.numbered-source code > span')).toHaveCount(example.code.split('\n').length);
    if (example.dimension === 2) {
      await drawer.getByRole('link', { name: 'Framing', exact: true }).click();
      await expect(drawer.getByRole('heading', { name: '2D framing', exact: true })).toBeInViewport();
      await expect(drawer.locator('#example-help-camera')).toContainText('without a camera');
    }
  }
  await drawer.getByRole('button', { name: 'Close example help', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(helpButton).toBeFocused();
  await expect(editor).toHaveText(customCode);
  await expect(send).toBeEnabled();
  expect(await canvas.evaluate(element => element.toDataURL())).toBe(before);
  await expect(page.getByLabel('Examples', { exact: true })).toHaveValue('courtyard');
  expect(errors).toEqual([]);
});

test('walkthrough links jump to the original source and Escape restores focus', async ({ page }) => {
  const drawer = await openHelp(page, 'droplet-ripples');
  const section = codeArtExampleHelp['droplet-ripples'].steps[2];
  const example = codeArtExamples.find(item => item.id === 'droplet-ripples');
  const line = getWalkthroughLine(example, section);
  await drawer.getByRole('button', { name: `Show source line ${line}`, exact: true }).click();
  const sourceLine = drawer.locator(`#example-source-${line}`);
  await expect(sourceLine).toBeInViewport();
  await expect(sourceLine).toHaveClass(/highlighted/);
  await expect(sourceLine).toContainText(section.code);
  await drawer.getByRole('link', { name: 'Numbers', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Every number and setting', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Example help', exact: true })).toBeFocused();
  await page.getByLabel('Examples', { exact: true }).selectOption('mesh-slices');
  await page.getByRole('button', { name: 'Example help', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Mesh slices', exact: true })).toBeVisible();
});

test('help stays keyboard-contained and readable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = await openHelp(page, 'bounded-function');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveScreenshot('example-help-mobile.png');
  expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: 'Close example help', exact: true })).toBeFocused();
  await drawer.getByRole('link', { name: 'Numbers', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Every number and setting', exact: true })).toBeInViewport();
  expect(await drawer.locator('.table-scroll').evaluate(element => (
    element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === 'auto'
  ))).toBe(true);
  await drawer.getByRole('link', { name: 'Source', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Original source', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
