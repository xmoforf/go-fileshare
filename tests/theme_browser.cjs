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
    for (const el of document.querySelectorAll('body, .breadcrumbs a, .stats, .thead button, .row a, .col-size, .col-date, .copy-btn, .action, dialog[open], dialog[open] input, dialog[open] select, dialog[open] button, #themeCurrent, #themeResults, .status')) {
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
      if (el.matches('input, select, .action, dialog[open] button') && ratio(rgb(style.borderTopColor), bg) < 3) failures.push(name + ': boundary');
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
  assert.equal(options.length, 12);
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
  assert.equal(await page.evaluate(() => localStorage.getItem(location.pathname.replace(/\/$/, '') + ':theme')), '"nord"');
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
  await select.selectOption('catppuccin-latte');
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
    await trigger.click();
    await search.focus();
    await checkRenderedContrast(page);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await trigger.click();
  await search.fill('no matches');
  await dialog.getByRole('button', { name: 'Use system default', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem(location.pathname.replace(/\/$/, '') + ':theme')), null);
  assert.equal(await current(), await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  assert(await trigger.evaluate(el => el === document.activeElement));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  return 'PASS themes: native keyboard search/apply/cancel/Escape/reset, twelve palettes, persistence and focus';
}

async function checkThemeStorage(browser, url, viewport) {
  for (const [saved, expected, denied] of [
    ['"light"', 'light', false], ['"dark"', 'dark', false], ['"catppuccin-mocha"', 'catppuccin-mocha', false],
    ['{', 'light', false], ['"removed"', 'light', false], ['"__proto__"', 'light', false],
    ['{"id":"nord"}', 'light', false], [null, 'light', true],
  ]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, colorScheme: 'light' });
    try {
      await context.addInitScript(({ saved, denied }) => {
        if (saved !== null) localStorage.setItem(':theme', saved);
        if (denied) for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new Error('denied'); };
        window.themeFrames = [];
        function capture() {
          if (document.styleSheets.length) window.themeFrames.push(document.documentElement.dataset.theme);
          if (window.themeFrames.length < 3) requestAnimationFrame(capture);
        }
        requestAnimationFrame(capture);
      }, { saved, denied });
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
}

module.exports = { checkThemes, checkThemeStorage };
