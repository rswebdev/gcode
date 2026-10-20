import { test, expect } from '@playwright/test';
import { createCodeArtWorkerClient } from '../src/lib/genart/codeArtWorkerClient.js';

test('worker client terminates jobs on cancellation, transport errors, and timeout', async () => {
  const originalWorker = globalThis.Worker;
  const workers = [];
  class FakeWorker {
    constructor() {
      workers.push(this);
      this.terminated = false;
    }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const client = createCodeArtWorkerClient({ timeoutMs: 25 });
    const cancelled = client.generate({ code: 'while (true) {}' });
    client.cancel();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminated).toBe(true);

    const restarted = client.generate({ code: '' });
    workers[1].onmessage({ data: { type: 'result', paths: [] } });
    await expect(restarted).resolves.toEqual([]);

    const crashed = client.generate({ code: '' });
    workers[2].onerror({ message: 'Worker runtime failure', preventDefault() {} });
    await expect(crashed).rejects.toThrow('Worker runtime failure');

    const unreadable = client.generate({ code: '' });
    workers[3].onmessageerror();
    await expect(unreadable).rejects.toThrow('Could not read');

    const invalid = client.generate({ code: '' });
    workers[4].onmessage({ data: null });
    await expect(invalid).rejects.toThrow('invalid response');

    await expect(client.generate({ code: '' })).rejects.toThrow('timed out');
    expect(workers.every(worker => worker.terminated)).toBe(true);
  } finally {
    globalThis.Worker = originalWorker;
  }
});

async function openCodeArt(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  return {
    editor: page.locator('.cm-content[aria-label="Art code"]'),
    generate: page.getByRole('button', { name: 'Generate', exact: true }),
    send: page.getByRole('button', { name: '→ G-code', exact: true }),
    error: page.locator('.genart-wrap .error-msg'),
  };
}

test('real worker infinite loop is cancellable and a new generation succeeds', async ({ page }) => {
  const ui = await openCodeArt(page);
  await ui.editor.fill('return polyline([[-0.5, 0], [0.5, 0]]);');
  await ui.generate.click();
  await expect(ui.send).toBeEnabled();
  await ui.editor.fill('while (true) {}');
  await expect(ui.send).toBeDisabled();
  await ui.generate.click();
  await expect(ui.send).toBeDisabled();
  // Allow the real worker to enter the infinite loop before terminating it.
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(ui.error).toContainText('cancelled');
  await expect(ui.send).toBeDisabled();
  await ui.editor.fill('return polyline([[0, 0], [1, 1]]);');
  await ui.generate.click();
  await expect(ui.send).toBeEnabled();
  await expect(ui.error).toHaveCount(0);
});

test('real worker confines code to the explicit Code Art capabilities', async ({ page }) => {
  const ui = await openCodeArt(page);
  await ui.editor.fill(`
    const unavailable = ['fetch', 'XMLHttpRequest', 'WebSocket', 'document', 'window',
      'localStorage', 'indexedDB', 'importScripts', 'self', 'postMessage', 'Worker',
      'navigator', 'location', 'crypto', 'setTimeout'];
    if (unavailable.some(name => name in globalThis)) throw new Error('Unexpected worker global');
    for (const value of [{}, solid.sphere(), random(1)]) {
      let dynamicConstructorBlocked = false;
      try {
        value.constructor.constructor('return globalThis')();
      } catch (error) {
        dynamicConstructorBlocked = error.name === 'TypeError';
      }
      if (!dynamicConstructorBlocked) throw new Error('Dynamic constructor escape was not blocked');
    }
    return polyline([[0, 0], [1, 1]]);
  `);
  await ui.generate.click();
  await expect(ui.send).toBeEnabled();
  await expect(ui.error).toHaveCount(0);
});

test('real worker errors are visible and stale jobs are discarded on edits, examples, and switching', async ({ page }) => {
  const ui = await openCodeArt(page);
  await ui.editor.fill('throw new Error("intentional worker error");');
  await ui.generate.click();
  await expect(ui.error).toContainText('intentional worker error');
  await expect(ui.send).toBeDisabled();

  for (const change of [
    () => ui.editor.fill('return polyline([[0, 0], [1, 1]]);'),
    () => page.getByRole('button', { name: 'Load', exact: true }).click(),
    () => page.getByLabel('Algorithm').selectOption('spirograph'),
  ]) {
    await ui.editor.fill('while (true) {}');
    await ui.generate.click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await change();
    await expect(ui.send).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await expect(ui.error).toHaveCount(0);
  }
  // Existing non-Code Art algorithms continue to generate normally.
  await ui.generate.click();
  await expect(ui.send).toBeEnabled();
});

test('uploaded text and binary assets are available synchronously and removable', async ({ page }) => {
  const ui = await openCodeArt(page);
  await page.getByLabel('Local assets', { exact: true }).setInputFiles([
    { name: 'points.json', mimeType: 'application/json', buffer: Buffer.from('[[0,0],[0.5,0.5]]') },
    { name: 'shape.stl', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) },
  ]);
  await expect(page.getByRole('button', { name: 'Remove points.json', exact: true })).toBeVisible();
  await ui.editor.fill(`
    if (!(assets['shape.stl'] instanceof ArrayBuffer)) throw new Error('STL must be binary');
    return polyline(JSON.parse(assets['points.json']));
  `);
  await ui.generate.click();
  await expect(ui.send).toBeEnabled();
  await page.getByRole('button', { name: 'Remove points.json', exact: true }).click();
  await expect(ui.send).toBeDisabled();
  await ui.generate.click();
  await expect(ui.error).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove points.json', exact: true })).toHaveCount(0);
});

test('uploaded OBJ and ASCII STL run through the mesh API and G-code handoff', async ({ page }) => {
  const ui = await openCodeArt(page);
  const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3';
  const stl = `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle`;
  await page.getByLabel('Local assets', { exact: true }).setInputFiles([
    { name: 'model.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) },
    { name: 'model.stl', mimeType: 'application/octet-stream', buffer: Buffer.from(stl) },
  ]);
  for (const [format, name] of [['obj', 'model.obj'], ['stl', 'model.stl']]) {
    await ui.editor.fill(`return scene().add(mesh.${format}(assets['${name}']).fit()).render();`);
    await ui.generate.click();
    await expect(ui.send).toBeEnabled();
    await expect(ui.error).toHaveCount(0);
  }
  await ui.send.click();
  await expect(page.getByRole('button', {name:'G-code',exact:true})).toHaveClass(/active/);
});
