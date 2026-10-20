import { test, expect } from '@playwright/test';

const storageKey = 'gcode-genart-layout';

async function open(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  return {
    sidebar: page.getByRole('separator', { name: 'Resize Gen Art sidebar' }),
    editor: page.getByRole('separator', { name: 'Resize art code editor' }),
    algorithm: page.getByLabel('Algorithm', { exact: true }),
  };
}

async function drag(page, handle, x, y) {
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + x, startY + y, { steps: 5 });
  await page.mouse.up();
}

const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);

test('dragging resizes the sidebar and editor and restores both after reload', async ({ page }) => {
  const ui = await open(page);
  const code = await page.evaluate(() => localStorage.getItem('gcode-genart-code'));
  await drag(page, ui.sidebar, 150, 0);
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '540');
  await expect(page.locator('.genart-wrap .sidebar')).toHaveCSS('width', '540px');
  await drag(page, ui.editor, 0, 100);
  await expect(ui.editor).toHaveAttribute('aria-valuenow', '420');
  await expect(page.locator('#genart-editor-frame')).toHaveCSS('height', '420px');
  expect(await saved(page)).toEqual({ sidebarWidth: 220, codeSidebarWidth: 540, editorHeight: 420 });
  await page.reload();
  await page.getByRole('button', { name: 'Gen Art', exact: true }).click();
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '540');
  await expect(ui.editor).toHaveAttribute('aria-valuenow', '420');
  expect(await page.evaluate(() => localStorage.getItem('gcode-genart-code'))).toBe(code);
  expect((await page.locator('.genart-wrap .code-editor').boundingBox()).height).toBe(420);
});

test('keyboard resizing enforces limits and remembers independent algorithm widths', async ({ page }) => {
  const ui = await open(page);
  await ui.sidebar.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '400');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '450');
  await ui.algorithm.selectOption('spirograph');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '220');
  await ui.sidebar.focus();
  await page.keyboard.press('ArrowRight');
  await ui.algorithm.selectOption('code-art');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '450');
  await ui.editor.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(ui.editor).toHaveAttribute('aria-valuenow', '220');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await expect(ui.editor).toHaveAttribute('aria-valuenow', '1600');
  await ui.sidebar.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '200');
  expect(await saved(page)).toEqual({ sidebarWidth: 230, codeSidebarWidth: 200, editorHeight: 1600 });
});

test('narrow windows constrain the sidebar without losing the saved desktop preference', async ({ page }) => {
  const ui = await open(page);
  await ui.sidebar.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '440');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const preview = await page.locator('.genart-wrap .canvas-area').boundingBox();
    return preview.width;
  }).toBeGreaterThanOrEqual(128);
  expect((await saved(page)).codeSidebarWidth).toBe(440);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '440');
  await expect(page.locator('.genart-wrap .sidebar')).toHaveCSS('width', '440px');
});

test('resizing redraws existing art without changing code, regenerating, or disabling export', async ({ page }) => {
  const ui = await open(page);
  const editor = page.locator('.cm-content[aria-label="Art code"]');
  await editor.fill('return polyline([[-0.8,-0.5],[0.8,0.5]]);');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const send = page.getByRole('button', { name: '→ G-code', exact: true });
  await expect(send).toBeEnabled();
  const canvas = page.locator('.genart-wrap canvas');
  const before = await canvas.evaluate(element => element.width);
  await drag(page, ui.sidebar, 120, 0);
  await expect.poll(() => canvas.evaluate(element => element.width)).toBeLessThan(before);
  expect(await canvas.evaluate(element => {
    const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
    return data.some((value, i) => i % 4 === 2 && value > 150);
  })).toBe(true);
  await expect(send).toBeEnabled();
  await expect(editor).toHaveText('return polyline([[-0.8,-0.5],[0.8,0.5]]);');
  await drag(page, ui.editor, 0, 80);
  await expect(send).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
});

test('malformed saved sizes are reported and resizing can replace them', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{"sidebarWidth":"wide"}'), storageKey);
  const ui = await open(page);
  await expect(page.getByRole('alert')).toContainText('Could not restore panel sizes');
  await expect(ui.sidebar).toHaveAttribute('aria-valuenow', '390');
  await ui.sidebar.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await saved(page)).codeSidebarWidth).toBe(400);
});

test('storage failures are visible while resizing still works for the current session', async ({ page }) => {
  await page.addInitScript(key => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return setItem.call(this, name, value);
    };
  }, storageKey);
  const ui = await open(page);
  await ui.editor.focus();
  await page.keyboard.press('ArrowDown');
  await expect(ui.editor).toHaveAttribute('aria-valuenow', '330');
  await expect(page.getByRole('alert')).toContainText('Could not save panel sizes');
});
