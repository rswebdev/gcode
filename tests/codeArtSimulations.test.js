import { test, expect } from '@playwright/test';
import { generate } from '../src/lib/genart/codeArtSandbox.js';
import { codeArtExamples } from '../src/lib/genart/codeArtExamples.js';
import { marchingSquares } from '../src/lib/genart/_marchingSquares.js';

const migrated = codeArtExamples.filter(example => example.dimension === 2);
const source = id => codeArtExamples.find(example => example.id === id).code;

function checkPaths(paths) {
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.length).toBeLessThanOrEqual(20000);
  let points = 0;
  for (const path of paths) {
    expect(path.length).toBeGreaterThanOrEqual(2);
    points += path.length;
    expect(path.every(({ nx, ny }) => (
      Number.isFinite(nx) && Number.isFinite(ny) && Math.abs(nx) <= 1 && Math.abs(ny) <= 1
    ))).toBe(true);
  }
  expect(points).toBeLessThanOrEqual(500000);
}

test('contours reuses marching squares with consistent coordinates and interpolation', () => {
  const field = new Float32Array([0, 1, 0, 1]);
  const expected = marchingSquares(field, 2, 0.25);
  expect(generate({ code: 'return contours(new Float32Array([0,1,0,1]), 2, 0.25);' })).toEqual(expected);
  expect(expected).toHaveLength(1);
  expect(expected[0]).toEqual(expect.arrayContaining([
    { nx: -0.5, ny: -1 }, { nx: -0.5, ny: 1 },
  ]));
  expect(generate({ code: 'return contours(new Float64Array([0,1,0,1]), 2, 0.25);' })).toEqual(expected);
  expect(generate({ code: 'return contours([0,1,0,1], 2, 0.25);' })).toEqual(expected);
  expect(generate({ code: 'return contours([0,1,0,1], 2, 2);' })).toEqual([]);
});

test('contours rejects malformed or unbounded scalar grids explicitly', () => {
  for (const size of ['1', '513', '2.5', 'NaN']) {
    expect(() => generate({ code: `return contours([], ${size}, 0.5);` })).toThrow(/grid size/);
  }
  for (const field of ['[0,1,0]', 'null', 'new Uint8Array(4)', '[0,1,0,NaN]', '[0,1,0,Infinity]', '[0,1,0,"1"]', 'new Array(4)']) {
    expect(() => generate({ code: `return contours(${field}, 2, 0.5);` })).toThrow(/Contour/);
  }
  expect(() => generate({ code: 'return contours([0,1,0,1], 2, Infinity);' })).toThrow(/finite/);
});

for (const preset of ['spots', 'maze', 'fingerprints', 'coral']) {
  test(`reaction-diffusion retains the ${preset} chemistry preset`, () => {
    const code = source('reaction-diffusion').replace("const preset = 'maze';", `const preset = '${preset}';`);
    const paths = generate({ code });
    checkPaths(paths);
    expect(generate({ code })).toEqual(paths);
  });
}

test('cyclic automaton is deterministic and its rule settings change the pattern', () => {
  const code = source('cyclic-ca').replace('const size = 140;', 'const size = 60;');
  const paths = generate({ code });
  checkPaths(paths);
  expect(generate({ code })).toEqual(paths);
  expect(generate({ code: code.replace('random(7)', 'random(8)') })).not.toEqual(paths);
  const changed = generate({ code: code.replace('const threshold = 1;', 'const threshold = 2;') });
  checkPaths(changed);
  expect(changed).not.toEqual(paths);
});

for (const preset of ['clifford', 'dejong', 'lorenz', 'rossler', 'halvorsen']) {
  test(`strange attractors retains the ${preset} equations and fitting`, () => {
    const code = source('strange-attractors')
      .replace("const preset = 'clifford';", `const preset = '${preset}';`)
      .replace('const steps = 80000;', 'const steps = 3000;');
    const paths = generate({ code });
    checkPaths(paths);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(3000);
    expect(generate({ code })).toEqual(paths);
    const coords = paths[0].flatMap(({ nx, ny }) => [Math.abs(nx), Math.abs(ny)]);
    expect(Math.max(...coords)).toBeCloseTo(0.95, 10);
  });
}

test('edited attractor coefficients are applied and divergence is an explicit error', () => {
  const code = source('strange-attractors').replace('const steps = 80000;', 'const steps = 100;');
  expect(generate({ code: code.replace('[-1.4, 1.6, 1, 0.7]', '[-1.3, 1.6, 1, 0.7]') }))
    .not.toEqual(generate({ code }));
  expect(() => generate({
    code: code.replace("const preset = 'clifford';", "const preset = 'halvorsen';")
      .replace('halvorsen: [1.4, 0, 0, 0]', 'halvorsen: [1e308, 0, 0, 0]'),
  })).toThrow(/diverged/);
});

test('long attractor plots retain the former chunking convention', () => {
  const paths = generate({ code: source('strange-attractors') });
  expect(paths).toHaveLength(40);
  expect(paths.every(path => path.length === 2000)).toBe(true);
});

test('migrated examples replace algorithm entries and export through the worker', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  const algorithm = page.getByLabel('Algorithm', { exact: true });
  for (const label of ['Reaction-Diffusion', 'Cyclic CA', 'Strange Attractors']) {
    await expect(algorithm.getByRole('option', { name: label, exact: true })).toHaveCount(0);
  }
  for (const example of migrated) {
    await page.getByLabel('Examples', { exact: true }).selectOption(example.id);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.locator('.cm-content[aria-label="Art code"]')).toContainText(example.code.split('\n')[0]);
    expect(await page.evaluate(() => localStorage.getItem('gcode-genart-code'))).toBe(example.code);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const send = page.getByRole('button', { name: '→ G-code', exact: true });
    await expect(send).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('.genart-wrap canvas')).toHaveScreenshot(`${example.id}.png`);
    await send.click();
    await expect(page.getByRole('button', { name: 'G-code', exact: true })).toHaveClass(/active/);
    await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
    await expect(algorithm).toHaveValue('code-art');
  }
  await page.reload();
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  await expect(page.locator('.cm-content[aria-label="Art code"]')).toContainText("const preset = 'clifford';");
});
