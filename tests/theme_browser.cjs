const assert = require('node:assert/strict');

async function checkRenderedContrast(page) {
  const failures = await page.evaluate(() => {
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const luminance = color => color.slice(0, 3).reduce((sum, c, i) => {
      c /= 255;
      return sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    const ratio = (a, b) => {
      const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
      return (values[1] + 0.05) / (values[0] + 0.05);
    };
    const failures = [];
    const modal = document.querySelector('dialog[open]');
    for (const el of document.querySelectorAll('body, .breadcrumbs a, .stats, .thead button, .row a, .col-size, .col-date, .copy-btn, .action, #search, #searchModes button, .search-field, dialog[open], dialog[open] input, dialog[open] select, dialog[open] button, #themeCurrent, #themeResults, .status')) {
      if (!el.getClientRects().length || el.disabled || (modal && !modal.contains(el))) continue;
      const style = getComputedStyle(el);
      if (Number(style.opacity) === 0) continue;
      let parent = el;
      while (parent && rgb(getComputedStyle(parent).backgroundColor)[3] === 0) parent = parent.parentElement;
      if (!parent) continue;
      const bg = rgb(getComputedStyle(parent).backgroundColor);
      const fg = rgb(style.color).map((v, i) => i < 3 ? v * Number(style.opacity) + bg[i] * (1 - Number(style.opacity)) : v);
      const name = el.id || el.className || el.tagName;
      if (ratio(fg, bg) < 4.5) failures.push(name + ': text');
      if (el.matches('select, .action, .search-field, dialog[open] input, dialog[open] button') && ratio(rgb(style.borderTopColor), bg) < 3) failures.push(name + ': boundary');
      if (el.matches('input') && ratio(rgb(getComputedStyle(el, '::placeholder').color), bg) < 4.5) failures.push(name + ': placeholder');
      if (style.outlineStyle !== 'none' && ratio(rgb(style.outlineColor), bg) < 3) failures.push(name + ': focus');
    }
    return failures;
  });
  assert.deepEqual(failures, [], 'rendered text/control contrast');
}

async function checkThemes(page) {
  const trigger = page.getByRole('button', { name: 'Choose theme', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Choose theme', exact: true });
  const search = page.getByLabel('Search themes', { exact: true });
  const select = page.getByLabel('Theme', { exact: true });
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
  const current = () => page.locator('html').getAttribute('data-theme');
  const initial = await current();
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  await trigger.focus();
  await trigger.press('Enter');
  assert(await search.evaluate(el => el === document.activeElement), 'search focus; active=' + await page.evaluate(() => document.activeElement.id));
  const options = await select.locator('option').allTextContents();
  assert.deepEqual(new Set(options), new Set(['Light', 'Nord', 'Catppuccin Mocha', 'Rose Pine', 'Rose Pine Dawn']));
  assert.deepEqual(options, [...options].sort((a, b) => a.localeCompare(b)));
  await search.fill('nOrD');
  assert.deepEqual(await select.locator('option:enabled').allTextContents(), ['Nord']);
  assert.equal(await select.locator('option:checked:disabled').textContent(), 'Choose a theme');
  assert.equal(await select.inputValue(), '', 'filter cannot silently select first match');
  assert(await apply.isDisabled());
  await search.press('Enter');
  assert(await dialog.isVisible(), 'Enter in search cannot commit');
  assert.equal(await current(), initial);
  await search.press('Tab');
  assert(await select.evaluate(el => el === document.activeElement));
  await select.press('ArrowDown');
  assert.equal(await select.inputValue(), 'nord');
  assert.equal(await current(), initial, 'draft has no preview');
  await select.press('Tab');
  assert(await apply.evaluate(el => el === document.activeElement));
  await apply.press('Enter');
  assert.equal(await current(), 'nord');
  assert(await trigger.evaluate(el => el === document.activeElement));
  const cookies = (await page.context().cookies()).filter(cookie => cookie.name === '__Host-file-share-theme');
  assert.equal(cookies.length, 1);
  const cookie = cookies[0];
  assert.equal(cookie.value, 'nord');
  assert.equal(cookie.domain, new URL(page.url()).hostname, 'host-only, no Domain attribute');
  assert.equal(cookie.path, '/');
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, false, 'non-auth preference is JS-readable');
  assert.equal(cookie.sameSite, 'Lax');
  assert(Math.abs(cookie.expires - Date.now() / 1000 - 31536000) < 10, 'one-year lifetime');
  assert.equal((await page.context().cookies('https://localhost/')).some(c => c.name === cookie.name), false, 'no unrelated host preference');
  await page.reload();
  assert.equal(await current(), 'nord');
  await trigger.click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await select.inputValue(), 'nord');
  await search.fill('[');
  assert.equal(await select.locator('option').count(), 0, 'search is literal, not regex');
  assert(await apply.isDisabled());
  assert.equal(await page.locator('#themeResults').textContent(), 'No matching themes');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await current(), 'nord');
  assert(await trigger.evaluate(el => el === document.activeElement));
  await trigger.click();
  await select.selectOption('catppuccin-mocha');
  await select.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await current(), 'nord');
  assert(await trigger.evaluate(el => el === document.activeElement));
  // Every palette reaches actual CSS and native controls without external assets.
  for (const id of await page.evaluate(() => Object.keys(JSON.parse(document.getElementById('themeCatalog').textContent)))) {
    await trigger.click();
    await select.selectOption(id);
    await apply.click();
    assert.equal(await current(), id);
    assert(await page.evaluate(id => {
      const theme = JSON.parse(document.getElementById('themeCatalog').textContent)[id];
      const root = getComputedStyle(document.documentElement);
      return root.colorScheme === theme.scheme && Object.entries(theme.colors).every(([key, color]) => root.getPropertyValue('--' + key).trim() === color);
    }, id));
    await page.locator('#viewport .row').first().hover();
    await page.locator('#viewport .copy-btn').first().focus();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#viewport .copy-btn')).opacity === '1');
    await checkRenderedContrast(page);
    await page.getByRole('button', { name: 'Case sensitive', exact: true }).click();
    await page.getByLabel('Filter files', { exact: true }).focus();
    await checkRenderedContrast(page);
    await page.getByRole('button', { name: 'Case sensitive', exact: true }).click();
    await trigger.click();
    await search.focus();
    await checkRenderedContrast(page);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  // Sample the first frame of a palette change while a row is highlighted.
  await page.evaluate(() => applyTheme('nord'));
  await page.locator('#viewport .row').first().hover();
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await page.evaluate(() => applyTheme('light'));
  await checkRenderedContrast(page);
  await trigger.click();
  await search.fill('no matches');
  await dialog.getByRole('button', { name: 'Use system default', exact: true }).click();
  assert.equal((await page.context().cookies()).some(cookie => cookie.name === '__Host-file-share-theme'), false);
  assert.equal(await current(), await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'nord'));
  assert(await trigger.evaluate(el => el === document.activeElement));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  return 'PASS themes: native keyboard search/apply/cancel/Escape/reset, five palettes, host-only Secure Lax one-year cookie and focus';
}

async function checkThemeStorage(browser, url, viewport) {
  for (const [saved, expected, colorScheme = 'light', denied = false] of [
    ['light', 'light'], ['nord', 'nord'], ['catppuccin-mocha', 'catppuccin-mocha'],
    ['rose-pine', 'rose-pine'], ['rose-pine-dawn', 'rose-pine-dawn'],
    ['', 'light'], ['%', 'light'], ['removed', 'light'], ['__proto__', 'light'],
    ['dark', 'light'], ['catppuccin-latte', 'light'], ['{"id":"nord"}', 'light'],
    [null, 'light'], [null, 'nord', 'dark'], ['removed', 'nord', 'dark'],
    [null, 'light', 'light', 'throws'], [null, 'light', 'light', 'ignored'],
  ]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, colorScheme });
    try {
      if (saved !== null) await context.addCookies([{ name: '__Host-file-share-theme', value: saved, url, secure: true, sameSite: 'Lax' }]);
      await context.addInitScript(({ denied }) => {
        // Old per-path preferences are deliberately not migrated.
        localStorage.setItem(location.pathname.replace(/\/$/, '') + ':theme', '"rose-pine"');
        if (denied) Object.defineProperty(document, 'cookie', {
          get() { if (denied === 'throws') throw new Error('denied'); return ''; },
          set() { if (denied === 'throws') throw new Error('denied'); },
        });
        window.themeFrames = [];
        function capture() {
          if (document.styleSheets.length) window.themeFrames.push(document.documentElement.dataset.theme);
          if (window.themeFrames.length < 3) requestAnimationFrame(capture);
        }
        requestAnimationFrame(capture);
      }, { denied });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url + '/');
      await page.waitForFunction(() => window.themeFrames.length === 3);
      assert.deepEqual(await page.evaluate(() => window.themeFrames), [expected, expected, expected], 'restored before rendered frames');
      assert.equal(await page.locator('html').getAttribute('data-theme'), expected);
      await page.getByRole('dialog', { name: 'Owner login' }).waitFor({ state: 'visible' });
      await checkRenderedContrast(page);
      if (denied) {
        // Synthetic modal close isolates the theme control from authentication.
        await page.locator('#loginDialog').evaluate(el => el.close());
        await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
        await page.getByLabel('Theme', { exact: true }).selectOption('nord');
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'nord');
        await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
        await page.getByRole('button', { name: 'Use system default', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, colorScheme: 'light' });
  try {
    const page = await context.newPage();
    await page.goto(url.replace('127.0.0.1', 'localhost') + '/');
    await page.getByRole('dialog', { name: 'Owner login' }).waitFor({ state: 'visible' });
    await page.locator('#loginDialog').evaluate(el => el.close());
    await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
    await page.getByLabel('Theme', { exact: true }).selectOption('nord');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.equal((await context.cookies()).find(c => c.name === '__Host-file-share-theme').domain, 'localhost');
    // Playwright's cookies(URL) filter ignores host-only scope; test real navigation.
    await page.goto(url.replace('127.0.0.1', 'child.localhost') + '/');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'host-only cookie excludes subdomains');
    assert.equal(await page.evaluate(() => document.cookie.includes('__Host-file-share-theme=')), false);
    await page.goto(url + '/');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'another hostname gets system default');
  } finally { await context.close(); }
}

module.exports = { checkThemes, checkThemeStorage };
