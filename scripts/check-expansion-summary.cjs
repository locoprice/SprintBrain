// Browser regression check. Run with Playwright available via NODE_PATH.
// CHROME_PATH optionally selects an installed Chrome. All snippet data is fake;
// the shipping content scripts run with a local chrome.storage/runtime stand-in.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = process.env.SUMMARY_SCREENSHOTS;
const library = [
  { id: 'hello', shortcut: 'hello', title: 'Hello', lang: 'EN', body: 'Hello, your message is ready.' },
  { id: 'total', shortcut: 'total', title: 'Total', lang: 'EN', body: 'Total: {formtext: name=Quantity; default=2} items, {= Quantity * 3} points.', field_cfg: { Quantity: { type: 'number' } } },
];

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<html><body style="margin:0;background:#fafafa;font:16px system-ui;padding:24px;box-sizing:border-box"><h1>Message</h1><textarea id="editor" aria-label="Plain message" style="box-sizing:border-box;width:100%;height:160px"></textarea><div id="rich" contenteditable="true" role="textbox" aria-label="Formatted message"></div></body></html>');
    await page.evaluate(snippets => {
      window.chrome = {
        storage: { local: { get: (keys, cb) => cb({ snippets, sb_session: { user: { id: 'fixture' } } }), set: () => {} }, onChanged: { addListener: () => {} } },
        runtime: { id: 'fixture', sendMessage: () => {}, onMessage: { addListener: () => {} } },
      };
    }, library);
    await page.addStyleTag({ path: root + '/extension/shared/tokens/colors_and_type.css' });
    for (const file of ['formula-engine.js', 'shared/snippet-stats.js', 'shared/fill-form.js', 'shared/interactive-steps.js', 'content/content.js']) {
      await page.addScriptTag({ path: root + '/extension/' + file });
    }
    async function open(options = {}) {
      await page.mouse.move(0, 0);
      await page.evaluate(options => {
        if (activeCelebrationClose) activeCelebrationClose();
        window.results = { confirm: 0, undo: 0 };
        document.querySelector('#editor').focus();
        showCelebration('A short message with all the details ready to send.', () => results.confirm++, () => results.undo++, { target: document.querySelector('#editor'), ...options });
      }, options);
    }
    async function bar() {
      return page.locator('.sb-cel-track').evaluate(el => ({ visibility: getComputedStyle(el).visibility, height: el.getBoundingClientRect().height, transform: el.firstElementChild.style.transform }));
    }
    async function shot(name) {
      if (output) { fs.mkdirSync(output, { recursive: true }); await page.screenshot({ path: path.join(output, name + '.png') }); }
    }
    await open();
    assert.equal(await page.locator('.sb-cel-confetti i').count(), 12);
    await page.waitForTimeout(220);
    await shot('popup-desktop-burst');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.sb-cel-confetti').count(), 0, 'burst cleans itself up');
    await page.locator('#sb-celebrate').hover();
    const paused = await bar();
    assert.equal(paused.visibility, 'visible', 'hover must not hide the countdown');
    assert.equal(paused.height, 4);
    await page.waitForTimeout(5200);
    assert.equal(await page.locator('#sb-celebrate').count(), 1, 'paused dialog stays open');
    assert.equal((await bar()).transform, paused.transform, 'paused bar stays frozen');
    await shot('popup-desktop-paused');
    await page.getByRole('button', { name: 'Undo insertion' }).click();
    assert.deepEqual(await page.evaluate(() => results), { confirm: 0, undo: 1 });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor');

    for (const [width, height] of [[320, 640], [375, 812], [768, 1024], [1280, 900]]) {
      await page.setViewportSize({ width, height });
      await open();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#sb-cel-cd').textContent(), 'Auto-close paused');
      assert.equal((await bar()).visibility, 'visible');
      const bounds = await page.locator('#sb-celebrate').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, 'dialog stays in viewport');
      await page.waitForTimeout(800);
      await shot('popup-' + width);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'sb-cel-ok', 'focus wraps inside dialog');
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => results), { confirm: 1, undo: 0 });
    }
    await open({ inserted: false });
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => results), { confirm: 0, undo: 1 }, 'Escape cancels pending insertion');
    await open({ inserted: false });
    await page.getByRole('button', { name: 'Insert text', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => results), { confirm: 1, undo: 0 });
    await open();
    await page.waitForTimeout(5300);
    assert.equal(await page.locator('#sb-celebrate').count(), 0);
    assert.deepEqual(await page.evaluate(() => results), { confirm: 1, undo: 0 }, 'automatic completion fires once');
    await open({ warning: 'This snippet is deprecated. Check it is still right before you send it.' });
    assert.equal(await page.locator('.sb-cel-confetti').count(), 0, 'warnings do not celebrate');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open();
    assert.equal(await page.locator('.sb-cel-confetti').count(), 0);
    assert.equal((await bar()).visibility, 'visible', 'reduced motion preserves information');
    await page.keyboard.press('Tab');
    await shot('popup-reduced-motion');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Real typed-trigger flow, using the shipping event handlers and insertion.
    await page.locator('#editor').fill('');
    await page.locator('#editor').pressSequentially('::hello', { delay: 20 });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Insert text', exact: true }).click();
    assert.equal(await page.locator('#editor').inputValue(), library[0].body);
    // Rich-editor insertion and undo through the context-menu entry point.
    await page.evaluate(() => { const el = document.querySelector('#rich'); el.focus(); _proceedContextInsert(el, snippets[0]); });
    assert.equal(await page.locator('#rich').innerText(), library[0].body);
    await page.getByRole('button', { name: 'Undo insertion' }).click();
    assert.equal(await page.locator('#rich').innerText(), '');
    // Field overlay and formula calculation reach the same summary.
    await page.evaluate(() => { const el = document.querySelector('#editor'); el.value = ''; el.focus(); _proceedContextInsert(el, snippets[1]); });
    await page.locator('#sb-overlay input[data-key="Quantity"]').fill('4');
    await page.locator('#sb-overlay .sb-insert').click();
    await page.getByRole('button', { name: 'Insert text', exact: true }).click();
    assert.equal(await page.locator('#editor').inputValue(), 'Total: 4 items, 12 points.');
    assert.deepEqual(errors, [], 'no browser errors');
    console.log('PASS: countdown visibility, pause, confetti cleanup, reduced motion, keyboard, responsive layout, trigger, context insertion/undo and formula overlay.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
