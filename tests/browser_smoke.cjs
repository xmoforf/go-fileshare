// Synthetic loopback-only cross-engine gate. Missing engines fail, never skip.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { parseArgs } = require('node:util');
const { chromium, firefox, webkit } = require('playwright');
const { checkUI, checkShareCopyReset, checkCompactLayout, checkFileFilter, checkUtilityPolish } = require('../ui_browser_test.js');
const { checkThemes, checkThemeStorage } = require('./theme_browser.cjs');

// Expected URLs are independent of the renderer's data-href and URL helpers.
async function checkRows(page, listingURL, owner) {
  const origin = new URL(listingURL).origin;
  const directory = 'sub &"\'<>#?%é';
  const encodedDirectory = 'sub%20%26%22\'%3C%3E%23%3F%25%C3%A9/';
  const base = owner ? origin + '/files/folder/' : listingURL;
  const hash = owner ? '#/folder/' : '#/';
  for (const [name, encoded, content] of [
    ['a #?%é.txt', 'a%20%23%3F%25%C3%A9.txt', 'special'],
    [directory, encodedDirectory, null],
  ]) {
    const isDirectory = content === null;
    const search = page.getByLabel('Filter files', { exact: true });
    await search.fill(name);
    await page.getByText('1 / 208 items', { exact: true }).waitFor({ state: 'visible' });
    const row = page.locator('#viewport .row');
    const link = row.getByRole('link', { name, exact: false });
    await link.waitFor({ state: 'visible' });
    const copyLabel = owner ? 'Copy owner-only link' : isDirectory ? 'Copy folder link' : 'Copy link';
    const copy = row.getByTitle(copyLabel, { exact: true });
    assert.equal(await copy.getAttribute('aria-label'), copyLabel + ' for ' + name);
    assert.equal(await row.locator('.fname').textContent(), name);
    assert.equal(await link.getAttribute('href'), isDirectory ? hash + encoded : base + encoded);
    assert.deepEqual(await row.locator('a, button').evaluateAll(controls => controls.map(el => el.tagName)), owner ? ['A', 'BUTTON', 'BUTTON'] : ['A', 'BUTTON']);
    assert.equal(await row.locator('.col-size').textContent(), isDirectory ? '—' : '7 B');
    assert.equal(await row.locator('.icon').textContent(), isDirectory ? '📁' : '📄');
    assert.match(await row.locator('.col-date').textContent(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    if (owner) {
      const shareButton = row.getByRole('button', { name: 'Share ' + name, exact: true });
      await shareButton.focus();
      await shareButton.press('Enter');
      assert.equal(await page.locator('#shareTarget').textContent(), 'folder/' + name);
      await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
      assert(await shareButton.evaluate(el => el === document.activeElement), 'row dialog restores trigger focus');
    }
    // Stub only the browser clipboard boundary; exercise the real delegated click and fallback.
    for (const mode of ['clipboard', 'clipboard-rejected', 'fallback', 'fallback-failed']) {
      await page.evaluate(mode => {
        const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const execCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
        window.copyCalls = [];
        window.restoreClipboard = () => {
          if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
          else delete navigator.clipboard;
          if (execCommand) Object.defineProperty(document, 'execCommand', execCommand);
          else delete document.execCommand;
          delete window.copyCalls;
          delete window.restoreClipboard;
        };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode.startsWith('clipboard') ? {
          writeText(text) {
            window.copyCalls.push(['clipboard', text]);
            return mode === 'clipboard' ? Promise.resolve() : Promise.reject(new Error('denied'));
          },
        } : undefined });
        Object.defineProperty(document, 'execCommand', { configurable: true, value(command) {
          const textarea = document.activeElement;
          window.copyCalls.push([command, textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)]);
          return mode === 'fallback';
        } });
      }, mode);
      try {
        await copy.click();
        const success = mode === 'clipboard' || mode === 'fallback';
        await copy.getByText(success ? '✓' : '✗', { exact: true }).waitFor({ state: 'visible' });
        const expected = isDirectory && owner ? origin + '/' + hash + encoded : base + encoded;
        assert.deepEqual(await page.evaluate(() => window.copyCalls), [[mode.startsWith('clipboard') ? 'clipboard' : 'copy', expected]]);
        assert.equal(await page.locator('textarea').count(), 0, 'fallback removes its textarea');
        assert.equal(await copy.evaluate(el => el.classList.contains('copied')), success);
        await copy.getByText('⎘', { exact: true }).waitFor({ state: 'visible' });
      } finally { await page.evaluate(() => window.restoreClipboard()); }
    }
    if (isDirectory) {
      await link.click();
      await page.getByText('1 items', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).hash, hash + encoded);
      const child = page.getByRole('link', { name: /movie\.mp4$/ });
      assert.equal(await child.getAttribute('href'), base + encoded + 'movie.mp4');
      const response = await page.context().request.get(await child.getAttribute('href'));
      assert.equal(response.status(), 200);
      assert.equal(await response.text(), '0123456789');
      await page.goto(listingURL);
      await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
    } else {
      const downloaded = page.waitForEvent('download');
      await link.click();
      assert.equal((await downloaded).url(), base + encoded);
      const response = await page.context().request.get(base + encoded);
      assert.equal(response.status(), 200);
      assert.equal(await response.text(), content);
    }
  }
}

function browserEngines(args) {
  const { values } = parseArgs({ args, options: { 'chromium-only': { type: 'boolean' } } });
  return Object.entries(values['chromium-only'] ? { chromium } : { chromium, firefox, webkit });
}

async function checkNarrowLayout(page, label, role, work) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 844 });
  console.log(label, `${role}-320`, await checkCompactLayout(page));
  await page.getByLabel('Filter files', { exact: true }).fill('item-204');
  await page.getByText('1 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  console.log(label, `${role}-320-filtered`, await checkCompactLayout(page));
  await page.screenshot({ path: path.join(work, `${label}-${role}-320.png`) });
  await page.getByLabel('Filter files', { exact: true }).fill('');
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  await page.setViewportSize(viewport);
}

async function main() {
  const engines = browserEngines(process.argv.slice(2));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'file-share-browsers-'));
  console.log('Evidence directory:', work);
  const binary = process.env.BROWSER_FIXTURE_BINARY || path.join(work, 'fixture');
  if (!process.env.BROWSER_FIXTURE_BINARY) {
    execFileSync('go', ['test', '-c', '-o', binary, '.'], { stdio: 'inherit' });
  }
  const fixture = spawn(binary, ['-test.run=^TestBrowserFixture$', '-test.v'], {
    env: { ...process.env, FILE_SHARE_BROWSER_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(fixture, 'exit');
  let timer;
  try {
    const url = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('fixture startup timed out')), 30000);
      fixture.once('error', reject);
      fixture.once('exit', () => reject(new Error('fixture exited before ready')));
      const lines = readline.createInterface({ input: fixture.stdout });
      lines.on('line', line => {
        if (line.startsWith('BROWSER_FIXTURE_URL=')) resolve(line.slice('BROWSER_FIXTURE_URL='.length));
      });
    });
    clearTimeout(timer);
    assert.match(url, /^https:\/\/127\.0\.0\.1:\d+$/);
    for (const [engine, type] of engines) {
      const browser = await type.launch();
      try {
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
          const label = `${engine}-${viewport.width}`;
          // Certificate exception is confined to this synthetic loopback context.
          const owner = await browser.newContext({ ignoreHTTPSErrors: true, viewport, colorScheme: 'light', hasTouch: viewport.width < 700 });
          const recipient = await browser.newContext({ ignoreHTTPSErrors: true, viewport, colorScheme: 'light', hasTouch: viewport.width < 700 });
          try {
            const page = await owner.newPage();
            page.setDefaultTimeout(10000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            const external = [];
            owner.on('request', request => { if (new URL(request.url()).origin !== url) external.push(request.url()); });
            recipient.on('request', request => { if (new URL(request.url()).origin !== url) external.push(request.url()); });
            await page.goto(url + '/#/folder/');
            await page.getByLabel('Username', { exact: true }).fill('owner');
            await page.getByLabel('Password', { exact: true }).fill('wrong-password');
            const rejected = page.waitForResponse(response => response.url().endsWith('/api/login'));
            await page.getByRole('button', { name: 'Log in', exact: true }).click();
            assert.equal((await rejected).status(), 401);
            await page.getByRole('status').filter({ hasText: 'Login failed. Check your username and password, then try again.' }).waitFor({ state: 'visible' });
            assert(await page.locator('#loginDialog').isVisible());
            assert.equal((await owner.request.get(url + '/api/list')).status(), 401);
            await page.screenshot({ path: path.join(work, `${label}-login-retry.png`) });
            await page.getByLabel('Password', { exact: true }).fill('test-password');
            await page.getByRole('button', { name: 'Log in', exact: true }).click();
            await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
            console.log(label, await checkUtilityPolish(page, true));
            console.log(label, await checkFileFilter(page));
            console.log(label, await checkShareCopyReset(page));
            console.log(label, await checkCompactLayout(page));
            await page.screenshot({ path: path.join(work, `${label}-owner-header.png`) });
            await checkNarrowLayout(page, label, 'owner', work);
            console.log(label, await checkThemes(page));
            await checkThemeStorage(browser, url, viewport);
            console.log(label, await checkUI(page));
            await checkRows(page, url + '/#/folder/', true);
            await page.locator('#shareCurrent').click();
            await page.getByLabel('Expires after').selectOption('0');
            const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/shares'));
            await page.getByRole('button', { name: 'Create link', exact: true }).click();
            const response = await created;
            assert.equal(response.status(), 201);
            assert.equal(response.request().postDataJSON().seconds, 0);
            assert.equal((await response.json()).expires, 0);
            const link = page.getByLabel('Share link', { exact: true });
            await link.waitFor({ state: 'visible' });
            await page.screenshot({ path: path.join(work, `${label}-share-dialog.png`) });
            const share = await link.inputValue();
            assert.equal(new URL(share).origin, url);
            await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
            await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
            await page.getByLabel('Theme', { exact: true }).selectOption('catppuccin-mocha');
            await page.getByRole('button', { name: 'Apply', exact: true }).click();
            const sameProfile = await owner.newPage();
            await sameProfile.goto(share);
            assert.equal(await sameProfile.locator('html').getAttribute('data-theme'), 'catppuccin-mocha', 'root preference crosses into share path');
            await sameProfile.close();
            const guest = await recipient.newPage();
            await guest.goto(share);
            assert.equal(await guest.locator('html').getAttribute('data-theme'), 'light', 'other profile does not inherit owner theme');
            await guest.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
            assert.equal(await guest.locator('#shareCurrent').isVisible(), false);
            assert.equal(await guest.locator('#manageShares').isVisible(), false);
            assert.equal(await guest.locator('#logout').isVisible(), false);
            console.log(label, 'recipient', await checkUtilityPolish(guest, false));
            console.log(label, 'recipient', await checkFileFilter(guest));
            console.log(label, 'recipient', await checkCompactLayout(guest));
            await guest.screenshot({ path: path.join(work, `${label}-recipient-header.png`) });
            await checkNarrowLayout(guest, label, 'recipient', work);
            console.log(label, 'recipient', await checkThemes(guest));
            await guest.getByRole('button', { name: 'Choose theme', exact: true }).click();
            await guest.getByLabel('Theme', { exact: true }).selectOption('rose-pine-dawn');
            await guest.getByRole('button', { name: 'Apply', exact: true }).click();
            await guest.reload();
            assert.equal(await guest.locator('html').getAttribute('data-theme'), 'rose-pine-dawn');
            await guest.goto(url + '/');
            assert.equal(await guest.locator('html').getAttribute('data-theme'), 'rose-pine-dawn', 'share preference crosses into owner path');
            assert(await guest.getByRole('dialog', { name: 'Owner login' }).isVisible(), 'theme preference grants no owner access');
            await guest.goto(share);
            await guest.getByRole('button', { name: 'Choose theme', exact: true }).click();
            await guest.getByRole('button', { name: 'Use system default', exact: true }).click();
            await guest.goto(url + '/');
            assert.equal(await guest.locator('html').getAttribute('data-theme'), 'light', 'share reset clears preference for owner path');
            await guest.goto(share);
            await page.reload();
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'catppuccin-mocha', 'recipient changes cannot affect owner profile');
            await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
            await checkRows(guest, share, false);
            assert.equal((await recipient.request.get(url + '/files/folder/a%20%23%3F%25%C3%A9.txt')).status(), 401);
            await guest.getByLabel('Filter files', { exact: true }).fill('item-204');
            await guest.getByText('1 / 208 items', { exact: true }).waitFor({ state: 'visible' });
            await guest.screenshot({ path: path.join(work, `${label}-recipient.png`) });
            const download = await recipient.request.get(new URL('item-204.txt', share.endsWith('/') ? share : share + '/').href);
            assert.equal(download.status(), 200);
            assert.equal(await download.text(), 'synthetic browser fixture');
            await page.locator('#manageShares').click();
            const revoke = page.locator('.share-item').filter({ hasText: 'Never expires' }).getByRole('button', { name: 'Revoke', exact: true });
            page.once('dialog', dialog => dialog.accept());
            const removed = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes('/api/shares?'));
            await revoke.click();
            assert.equal((await removed).status(), 204);
            await guest.evaluate(() => { window.location.hash = '#/missing/'; });
            await guest.locator('#scrollWrap .error').waitFor({ state: 'visible' });
            assert.equal(await guest.locator('#scrollWrap .error').textContent(), 'Failed to load directory listing.Link unavailable. Contact the sender for a new link.');
            const denied = await guest.reload();
            assert.equal(denied.status(), 404);
            await guest.getByRole('heading', { name: 'Link unavailable', exact: true }).waitFor({ state: 'visible' });
            await guest.getByText('Contact the sender for a new link.', { exact: true }).waitFor({ state: 'visible' });
            assert.equal(await guest.locator('form, script, a').count(), 0, 'unavailable page offers no login or token-dependent actions');
            assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'unavailable page fits viewport');
            await guest.screenshot({ path: path.join(work, `${label}-revoked.png`) });
            assert.deepEqual(errors, []);
            assert.deepEqual(external, [], 'themes and UI must stay same-origin');
            console.log(`PASS ${label}: owner/recipient file+directory links, clipboard success/fallback/failures, filter/download/revoke`);
          } finally {
            await recipient.close();
            await owner.close();
          }
        }
      } finally { await browser.close(); }
    }
  } finally {
    clearTimeout(timer);
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill('SIGTERM');
    const kill = setTimeout(() => fixture.kill('SIGKILL'), 10000);
    const [code] = await exited;
    clearTimeout(kill);
    assert.equal(code, 0, 'fixture must stop cleanly');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { browserEngines };
