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
  assert(await page.evaluate(() => !document.activeElement.closest('#viewport')), 'Tab exits after final row');
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
  await page.getByLabel('Expires after').selectOption('custom');
  const seconds = page.getByLabel('Seconds', { exact: true });
  for (const [value, valid] of [['1', true], ['315360000', true], ['0', false], ['315360001', false], ['1.5', false], ['', false]]) {
    await seconds.fill(value);
    assert(await seconds.evaluate(el => el.checkValidity()) === valid, 'duration boundary ' + value);
  }
  await page.getByLabel('Expires after').selectOption('3600');
  assert(await page.locator('#shareForm').evaluate(el => el.checkValidity()), 'invalid hidden custom input must not block preset');
  await page.getByLabel('Expires after').selectOption('custom');
  await seconds.fill('1');
  await page.getByRole('button', { name: 'Create link', exact: true }).click();
  await page.getByLabel('Share link', { exact: true }).waitFor({ state: 'visible' });
  assert((await page.locator('#shareMessage').textContent()).startsWith('Expires '), 'one-second share created');
  await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
  assert(await page.locator('#shareCurrent').evaluate(el => el === document.activeElement), 'dialog restores trigger focus');
  return 'PASS: native sort, scroll focus, 624 Tabs, reverse Tab/Home/End, full filter, duration bounds and one-second creation';
}
