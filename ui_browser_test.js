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

async function checkShareCopyReset(page) {
  await page.evaluate(() => {
    window.testClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
  });
  try {
    await page.getByRole('button', { name: 'Share folder', exact: true }).click();
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    await page.getByLabel('Share link', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ state: 'visible' });
    await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Share folder', exact: true }).click();
    if (await page.locator('#copyShare').textContent() !== 'Copy link') throw new Error('new share must reset Copied feedback');
  } finally {
    await page.evaluate(() => {
      if (window.testClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', window.testClipboardDescriptor);
      else delete navigator.clipboard;
      delete window.testClipboardDescriptor;
    });
    await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
  }
  return 'PASS: new share resets Copied feedback';
}

async function checkCompactLayout(page) {
  const layout = await page.evaluate(() => {
    const rect = id => document.getElementById(id).getBoundingClientRect();
    const row = document.querySelector('#viewport .row');
    const copy = row.querySelector('button[data-href]').getBoundingClientRect();
    const size = row.querySelector('.col-size').getBoundingClientRect();
    return {
      utilitiesAboveFilter: rect('themeToggle').bottom <= rect('search').top && rect('logout').bottom <= rect('search').top,
      trailingActions: copy.left >= size.right,
      headerAligned: Math.abs(document.querySelector('[data-sort="size"]').getBoundingClientRect().right - size.right) < 2,
      listingTop: rect('scrollWrap').top,
      narrow: innerWidth <= 400,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (!layout.utilitiesAboveFilter) throw new Error('theme/logout must sit above filter in utility header');
  if (!layout.trailingActions) throw new Error('row actions must trail metadata');
  if (!layout.headerAligned) throw new Error('size header must align with row metadata');
  if (layout.overflow) throw new Error('compact layout must not overflow horizontally');
  if (layout.narrow && layout.listingTop > 200) throw new Error('narrow listing must start within 200px');
  return 'PASS: compact header, trailing row actions and viewport fit';
}

async function checkFileFilter(page) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const search = page.getByLabel('Filter files', { exact: true });
  const rows = page.locator('#viewport .row');
  const error = page.locator('#filterError');
  const message = 'Invalid regular expression. Fix it or clear the filter to show files.';
  for (const [invalid, recovery, count] of [
    ['/[/', 'ITEM-204', 1],
    ['/item/ii', '/item-20[34]/giy', 2],
    ['/(/', '', 208],
  ]) {
    await search.focus();
    await search.press('ControlOrMeta+A');
    await search.pressSequentially(invalid);
    await page.getByText(message, { exact: true }).waitFor({ state: 'visible' });
    assert(await rows.count() === 0, 'invalid regex must not match all files or retain stale rows');
    assert(await page.locator('#stats').textContent() === '0 / 208 items', 'invalid regex has zero results');
    assert(await search.getAttribute('aria-invalid') === 'true', 'invalid filter marked for assistive technology');
    assert(await search.getAttribute('aria-describedby') === 'filterError', 'error associated with filter');
    assert(await error.getAttribute('role') === 'status', 'error announced without moving focus');
    assert(await search.evaluate(el => el === document.activeElement), 'invalid input keeps keyboard focus');
    await page.locator('[data-sort="name"]').press('Enter');
    assert(await rows.count() === 0 && await error.textContent() === message, 'sorting preserves invalid state');
    await search.fill(recovery);
    await page.getByText(count === 208 ? '208 items' : count + ' / 208 items', { exact: true }).waitFor({ state: 'visible' });
    assert(await error.textContent() === '', 'correcting or clearing filter removes error');
    assert(await search.getAttribute('aria-invalid') === 'false', 'recovery clears invalid state');
    if (count < 208) {
      const names = await rows.locator('.fname').allTextContents();
      assert(names.includes('item-204.txt') && (count === 1 || names.includes('item-203.txt')), 'literal and regex preserve case-insensitive matches');
    }
  }
  return 'PASS: invalid regex feedback, keyboard focus, sorting, literal/regex recovery and reset';
}

if (typeof module !== 'undefined') module.exports = { checkUI, checkShareCopyReset, checkCompactLayout, checkFileFilter };
