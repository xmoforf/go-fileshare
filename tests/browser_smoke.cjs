// Synthetic loopback-only cross-engine gate. Missing engines fail, never skip.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { chromium, firefox, webkit } = require('playwright');
const { checkUI } = require('../ui_browser_test.js');

async function main() {
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
    for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
      const browser = await type.launch();
      try {
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
          const label = `${engine}-${viewport.width}`;
          // Certificate exception is confined to this synthetic loopback context.
          const owner = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
          const recipient = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
          try {
            const page = await owner.newPage();
            page.setDefaultTimeout(10000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(url + '/#/folder/');
            await page.getByLabel('Username', { exact: true }).fill('owner');
            await page.getByLabel('Password', { exact: true }).fill('test-password');
            await page.getByRole('button', { name: 'Log in', exact: true }).click();
            console.log(label, await checkUI(page));
            await page.locator('#shareCurrent').click();
            await page.getByLabel('Expires after').selectOption('0');
            await page.getByRole('button', { name: 'Create link', exact: true }).click();
            const link = page.getByLabel('Share link', { exact: true });
            await link.waitFor({ state: 'visible' });
            const share = await link.inputValue();
            assert.equal(new URL(share).origin, url);
            await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
            const guest = await recipient.newPage();
            await guest.goto(share);
            await guest.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
            assert.equal(await guest.locator('#shareCurrent').isVisible(), false);
            assert.equal(await guest.locator('#manageShares').isVisible(), false);
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
            const denied = await guest.reload();
            assert.equal(denied.status(), 404);
            await guest.getByText('Not Found', { exact: true }).waitFor({ state: 'visible' });
            await guest.screenshot({ path: path.join(work, `${label}-revoked.png`) });
            assert.deepEqual(errors, []);
            console.log(`PASS ${label}: owner/recipient/filter/download/revoke`);
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
main().catch(error => { console.error(error); process.exitCode = 1; });
