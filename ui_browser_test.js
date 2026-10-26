// Run with a Playwright-compatible page logged into TestBrowserFixture at /#/folder/.
// No dependencies; call await checkUI(page). Uses synthetic data only.
async function checkUI(page) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const rows = page.locator('#viewport .row');
  const search = page.getByLabel('Filter files', { exact: true });
  const name = page.locator('[data-sort="name"]');
  const rowAt = i => page.locator('#viewport .row[data-index="' + i + '"]');
  await search.fill('');
  // Normalize saved sort without changing the persistence contract.
  if (!(await name.getAttribute('aria-label')).includes('ascending, sort priority 1')) await name.click();
  if (!(await name.getAttribute('aria-label')).includes('ascending, sort priority 1')) await name.click();
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await rows.count() < 100, 'DOM must contain only visible rows plus overscan');
  assert(await page.locator('#pagination').count() === 0, 'continuous list has no page controls');
  for (const key of ['name', 'size', 'date']) {
    assert(await page.locator('[data-sort="' + key + '"]').evaluate(el => el.tagName === 'BUTTON'), 'sort must be native');
  }
  await name.focus();
  await name.press('Enter');
  assert((await name.getAttribute('aria-label')).includes('descending'), 'Enter reverses sort');
  assert(await name.evaluate(el => el === document.activeElement), 'sort keeps focus');
  await name.press('Space');
  assert((await name.getAttribute('aria-label')).includes('ascending'), 'Space reverses sort');

  assert(await page.evaluate(async () => {
    const link = document.querySelectorAll('#viewport a')[10];
    link.focus();
    document.querySelector('#scrollWrap').scrollTop = 36;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return link.isConnected && document.activeElement === link;
  }), 'scroll must retain focused DOM node');
  // Pin each native control even when its row leaves the rendered window.
  for (const selector of ['a', 'button[data-href]', '.file-link-action']) {
    await rowAt(0).locator(selector).focus();
    assert(await page.evaluate(async () => {
      const focused = document.activeElement;
      const wrap = document.querySelector('#scrollWrap');
      wrap.scrollTop = wrap.scrollHeight;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return focused.isConnected && document.activeElement === focused;
    }), 'distant scroll retains ' + selector);
    await rowAt(0).locator('a').focus();
    await page.keyboard.press('Home');
  }
  // A native destination tests list exit without engine-specific browser-chrome focus.
  await page.evaluate(() => {
    const exit = document.createElement('button');
    exit.id = 'test-list-exit'; exit.textContent = 'Test list exit';
    document.querySelector('#scrollWrap').after(exit);
  });
  // Native Tab must reach every link/action, including rows beyond original viewport.
  await rows.first().locator('a').focus();
  for (let i = 0; i < 208; i++) {
    const row = rowAt(i);
    assert(await row.locator('a').evaluate(el => el === document.activeElement), 'Tab reaches row ' + i);
    await page.keyboard.press('Tab');
    assert(await row.locator('button').nth(0).evaluate(el => el === document.activeElement), 'Tab reaches copy ' + i);
    await page.keyboard.press('Tab');
    assert(await row.locator('button').nth(1).evaluate(el => el === document.activeElement), 'Tab reaches share ' + i);
    await page.keyboard.press('Tab');
  }
  assert(await page.locator('#test-list-exit').evaluate(el => el === document.activeElement), 'Tab exits after final row');
  await page.locator('#test-list-exit').evaluate(el => el.remove());
  await rowAt(207).locator('a').focus();
  await page.keyboard.press('Shift+Tab');
  assert(await rowAt(206).locator('button').last().evaluate(el => el === document.activeElement), 'reverse Tab reaches previous logical row');
  await rowAt(207).locator('a').focus();
  await page.keyboard.press('Home');
  assert(await rowAt(0).locator('a').evaluate(el => el === document.activeElement), 'Home reaches first row');
  await page.keyboard.press('End');
  assert(await rowAt(207).locator('a').evaluate(el => el === document.activeElement), 'End reaches last row');
  assert(await rows.count() < 100, 'keyboard traversal keeps DOM bounded');
  await search.fill('item-204');
  await page.getByText('1 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await rows.count() === 1 && (await rows.first().textContent()).includes('item-204.txt'), 'filter covers the full list');
  assert(await rows.first().getAttribute('aria-setsize') === '1', 'filter updates accessible list size');
  await search.fill('no-matching-item');
  await page.getByText('0 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await rows.count() === 0, 'empty filter removes old rows');
  await search.fill('');
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await page.locator('#scrollWrap').evaluate(el => el.scrollTop) === 0, 'filter resets scroll');

  await page.locator('#shareCurrent').click();
  const lifetime = page.getByLabel('Expires after');
  assert(await lifetime.inputValue() === '604800', 'default expiry is seven days');
  assert((await lifetime.locator('option').evaluateAll(options => options.map(o => o.value))).join(',') === '3600,86400,604800,2592000,0', 'only presets and Never remain');
  assert(await page.locator('#customSeconds, #customLabel').count() === 0, 'custom duration controls removed');
  for (const value of ['3600', '86400', '604800', '2592000']) {
    await lifetime.selectOption(value);
    const before = Math.floor(Date.now() / 1000);
    const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/shares'));
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    const response = await created;
    assert(response.status() === 201, 'preset share created');
    assert(response.request().postDataJSON().seconds === Number(value), 'preset sends API seconds');
    const share = await response.json();
    assert(share.expires >= before + Number(value) && share.expires <= Math.floor(Date.now() / 1000) + Number(value), 'preset expiry matches duration');
    await page.getByLabel('Share link', { exact: true }).waitFor({ state: 'visible' });
    assert((await page.locator('#shareMessage').textContent()).startsWith('Expires '), 'expiry shown');
    await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
    if (value !== '2592000') await page.locator('#shareCurrent').click();
  }
  assert(await page.locator('#shareCurrent').evaluate(el => el === document.activeElement), 'dialog restores trigger focus');
  return 'PASS: native sort, scroll focus, 624 Tabs, reverse Tab/Home/End, full filter, preset-only controls and four preset expiries';
}

if (typeof module !== 'undefined') module.exports = { checkUI };
