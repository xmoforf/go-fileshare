// Run with a Playwright-compatible page logged into TestBrowserFixture at /#/folder/.
// No dependencies; call await checkUI(page). Uses synthetic data only.
async function checkUI(page) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const rows = page.locator('#viewport .row');
  const search = page.getByLabel('Filter files', { exact: true });
  const name = page.locator('[data-sort="name"]');
  const status = page.locator('#pageStatus');
  await search.fill('');
  // Normalize saved sort without changing the persistence contract.
  if (!(await name.getAttribute('aria-label')).includes('ascending, sort priority 1')) await name.click();
  if (!(await name.getAttribute('aria-label')).includes('ascending, sort priority 1')) await name.click();
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await rows.count() === 100, 'DOM must be bounded to 100 rows');
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
  // Native Tab must reach every link/action, including rows beyond original viewport.
  await rows.first().locator('a').focus();
  for (let i = 0; i < 100; i++) {
    const row = rows.nth(i);
    assert(await row.locator('a').evaluate(el => el === document.activeElement), 'Tab reaches row ' + i);
    await page.keyboard.press('Tab');
    assert(await row.locator('button').nth(0).evaluate(el => el === document.activeElement), 'Tab reaches copy ' + i);
    await page.keyboard.press('Tab');
    assert(await row.locator('button').nth(1).evaluate(el => el === document.activeElement), 'Tab reaches share ' + i);
    await page.keyboard.press('Tab');
  }
  assert(await page.locator('#nextPage').evaluate(el => el === document.activeElement), 'Tab reaches Next after final row');
  await page.keyboard.press('Enter');
  assert(await status.textContent() === 'Page 2 of 3', 'Next shows second page');
  assert(await rows.first().locator('a').evaluate(el => el === document.activeElement), 'page change focuses first link');
  assert((await rows.first().textContent()).includes('item-097.txt'), 'page boundary has no skipped items');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  assert(await status.textContent() === 'Page 3 of 3' && await rows.count() === 8, 'last page has remainder');
  assert(await page.locator('#nextPage').isDisabled(), 'Next disabled at end');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  assert(await status.textContent() === 'Page 2 of 3', 'Previous works');
  await search.fill('item-204');
  await page.getByText('1 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await rows.count() === 1 && (await rows.first().textContent()).includes('item-204.txt'), 'filter covers all pages');
  assert(await page.locator('#pagination').isHidden(), 'single-page filter hides paging');
  await search.fill('no-matching-item');
  await page.getByText('0 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await rows.count() === 0, 'empty filter removes old rows');
  await search.fill('');
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await status.textContent() === 'Page 1 of 3', 'filter resets page');

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
  return 'PASS: native sort, scroll focus, 300 Tabs, page boundaries/filter, duration bounds and one-second creation';
}
