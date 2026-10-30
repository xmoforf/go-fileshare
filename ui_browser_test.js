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
  const trigger = page.getByRole('button', { name: 'Choose theme', exact: true });
  if (await trigger.getAttribute('title') !== 'Choose theme' || (await trigger.textContent()).trim() !== '') {
    throw new Error('theme trigger must be icon-only with accessible name and tooltip');
  }
  if (await trigger.locator('svg[aria-hidden="true"]').count() !== 1) throw new Error('theme trigger needs decorative inline SVG');
  const failures = await page.evaluate(() => {
    const failures = [];
    const rect = id => document.getElementById(id).getBoundingClientRect();
    const breadcrumbs = document.getElementById('breadcrumbs');
    const original = breadcrumbs.innerHTML;
    const statsEl = document.getElementById('stats');
    const originalCount = statsEl.textContent;
    try {
      // Stress layout only; navigation and real shared-folder access run separately.
      for (const stress of [false, true]) {
        if (stress) {
          breadcrumbs.textContent = 'Root / ' + 'long-folder-name-'.repeat(30) + ' / child';
          statsEl.textContent = '9999 / 10000 items';
        }
        const header = document.querySelector('.page-header').getBoundingClientRect();
        const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
        const search = rect('search');
        const theme = rect('themeToggle');
        const stats = rect('stats');
        const center = r => r.top + r.height / 2;
        if (Math.abs(toolbar.top - header.bottom - 4) > 1) failures.push('path row needs 4px gap');
        if (Math.abs(header.height - rect('breadcrumbs').height) > 1) failures.push('path row must be text-height');
        const field = rect('searchField');
        const modes = rect('searchModes');
        if (modes.left < search.right || modes.right > field.right || modes.top < field.top || modes.bottom > field.bottom) failures.push('modes must fit inside field after text');
        if (Math.abs(center(search) - center(modes)) > 1) failures.push('inline modes must align with input');
        if (innerWidth > 700 && Math.abs(center(search) - center(theme)) > 1) {
          failures.push('desktop filter/theme must stay on same row');
        }
        if (stats.top < toolbar.bottom || stats.bottom > rect('thead').top) failures.push('count must sit below controls, before sort headers');
        const statsStyle = getComputedStyle(statsEl);
        if (stats.height < 16 || stats.height > 24 || parseFloat(statsStyle.fontSize) < 12 || statsStyle.textAlign !== 'left') failures.push('count row must be short and readable');
        if (statsEl.closest('.toolbar') || statsEl.scrollWidth > statsEl.clientWidth) failures.push('count must fit its own row');
        if (search.width < 120 || theme.width < 36 || theme.height < 36) failures.push('filter and theme targets must remain usable');
        const controls = [...document.querySelectorAll('#search, .toolbar button')].filter(el => el.getClientRects().length);
        const boxes = controls.map(el => el.getBoundingClientRect());
        for (const [i, box] of boxes.entries()) {
          if (box.left < 0 || box.right > innerWidth || box.top < toolbar.top || box.bottom > toolbar.bottom) failures.push('control outside toolbar/viewport');
          if (controls[i].scrollWidth > controls[i].clientWidth) failures.push('clipped control');
          const minimum = matchMedia('(pointer: coarse)').matches ? 44 : controls[i].closest('#searchModes') ? 28 : 36;
          if (controls[i].tagName === 'BUTTON' && box.height < minimum) failures.push('button target shrank');
          if (innerWidth > 700 && Math.abs(center(box) - center(search)) > 1) failures.push('desktop controls need one row');
          for (const other of boxes.slice(i + 1)) {
            if (box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom) failures.push('overlapping controls');
          }
        }
        if (document.documentElement.scrollWidth > innerWidth) failures.push('horizontal overflow');
        if (toolbar.height > (innerWidth > 700 ? 64 : 160)) failures.push('excess toolbar height');
      }
    } finally {
      breadcrumbs.innerHTML = original;
      statsEl.textContent = originalCount;
    }
    const row = document.querySelector('#viewport .row');
    const copy = row.querySelector('button[data-href]').getBoundingClientRect();
    const size = row.querySelector('.col-size').getBoundingClientRect();
    if (copy.left < size.right) failures.push('row actions must trail metadata');
    if (Math.abs(document.querySelector('[data-sort="size"]').getBoundingClientRect().right - size.right) >= 2) failures.push('size header alignment');
    return failures;
  });
  if (failures.length) throw new Error('compact layout: ' + failures.join(', '));
  return 'PASS: compact path/controls/count rows, accessible palette, long paths, trailing actions and viewport fit';
}

async function checkFileFilter(page) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const search = page.getByLabel('Filter files', { exact: true });
  const rows = page.locator('#viewport .row');
  const error = page.locator('#filterError');
  const message = 'Invalid regular expression. Fix it or clear the filter to show files.';
  const caseButton = page.getByRole('button', { name: 'Case sensitive', exact: true });
  const wholeButton = page.getByRole('button', { name: 'Match phrase', exact: true });
  const regexButton = page.getByRole('button', { name: 'Regular expression', exact: true });
  const buttons = [caseButton, wholeButton, regexButton];
  const labels = ['Aa', '""', '.*'];
  const inactiveColors = [];
  assert(await page.locator('.toolbar button[aria-pressed]').count() === 3, 'three search-mode buttons in filter bar');
  await search.focus();
  for (let i = 0; i < buttons.length; i++) {
    assert(await buttons[i].textContent() === labels[i], 'compact search-mode label');
    assert(await buttons[i].getAttribute('aria-pressed') === 'false', 'search modes start off');
    inactiveColors.push(await buttons[i].evaluate(el => getComputedStyle(el).backgroundColor));
    await page.keyboard.press('Tab');
    assert(await buttons[i].evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), 'mode keeps visible keyboard focus');
  }
  async function state(expected) {
    for (let i = 0; i < buttons.length; i++) {
      assert(await buttons[i].getAttribute('aria-pressed') === String(expected[i]), 'independent case and exclusive matching modes: ' + expected);
      assert(await buttons[i].evaluate(el => ['Top', 'Right', 'Bottom', 'Left'].every(side => getComputedStyle(el)['border' + side + 'Width'] === '0px')), 'mode must be borderless in every state');
      const color = await buttons[i].evaluate(el => getComputedStyle(el).backgroundColor);
      assert((color !== inactiveColors[i]) === expected[i], 'only enabled buttons have highlighted background');
      assert(await buttons[i].evaluate(el => getComputedStyle(el).textDecorationLine.includes('underline')) === expected[i], 'selected mode needs a non-color cue');
    }
  }
  async function matches(query, count) {
    await search.fill(query);
    await page.getByText(count === 208 ? '208 items' : count + ' / 208 items', { exact: true }).waitFor({ state: 'visible' });
    assert(await search.getAttribute('aria-invalid') === 'false', 'valid query clears invalid state');
  }
  await matches('  TXT   ITEM-204  ', 1);
  await matches('/item-204/', 0);
  await matches('/[/', 0);
  await matches('item-20[34]', 0);
  await matches(' \t ', 208);

  // Case toggles independently, using both keyboard activation keys in every mode.
  for (const [mode, query, count] of [[null, 'ITEM-204', 1], [wholeButton, 'ITEM-204', 1], [regexButton, '^ITEM-20[34]\\.txt$', 2]]) {
    if (mode) await mode.click();
    const whole = mode === wholeButton;
    const regex = mode === regexButton;
    await state([false, whole, regex]);
    await matches(query, count);
    await caseButton.focus();
    await caseButton.press('Space');
    await state([true, whole, regex]);
    await page.getByText('0 / 208 items', { exact: true }).waitFor({ state: 'visible' });
    await matches(query.toLowerCase(), count);
    await caseButton.press('Enter');
    await state([false, whole, regex]);
    assert(await caseButton.evaluate(el => el === document.activeElement), 'toggle retains keyboard focus');
    await matches(query, count);
  }
  await caseButton.click();
  await wholeButton.click();
  await state([true, true, false]);
  await regexButton.click();
  await state([true, false, true]);
  await regexButton.click();
  await state([true, false, false]);
  await wholeButton.click();
  await state([true, true, false]);
  await wholeButton.click();
  await state([true, false, false]);
  await caseButton.click();
  await state([false, false, false]);

  await matches('txt item-204', 1);
  await wholeButton.click();
  await page.getByText('0 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  await matches('item-204', 1); // Substring, not whole-filename equality.
  await matches(' #?%é', 1); // Literal regex metacharacters and leading space.
  await matches('  #?%é', 0);
  await matches('a ', 1);
  await matches('a #?%é.txt ', 0);
  await matches(' ', 2);
  await matches('', 208);
  await regexButton.click();
  await state([false, false, true]);
  await matches('^item-20[34]\\.txt$', 2);
  await matches('/item-204/', 0); // No slash delimiter syntax, even in regex mode.
  await matches('', 208);

  for (const [invalid, recovery, count] of [
    ['[', 'ITEM-204', 1],
    ['*', '^item-20[34]\\.txt$', 2],
    ['(', '', 208],
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
  await search.fill('[');
  await page.getByText(message, { exact: true }).waitFor({ state: 'visible' });
  await regexButton.click();
  await state([false, false, false]);
  assert(await error.textContent() === '', 'turning regex off clears error');
  assert(await rows.count() === 0, 'invalid regex becomes literal text when disabled');
  await matches('item-204', 1);
  await checkCompactLayout(page); // Filtered counts must also fit the narrow count row.
  await matches('', 208);
  return 'PASS: search modes, independent case, exclusive toggles/highlights, literal whitespace, raw regex, errors and keyboard focus';
}

async function checkUtilityPolish(page, owner) {
  function assert(value, message) { if (!value) throw new Error(message); }
  const search = page.getByLabel('Filter files', { exact: true });
  const rows = page.locator('#viewport .row');
  assert(await page.locator('#stats').getAttribute('role') === 'status', 'result count must announce changes');
  assert(await page.locator('#searchField #searchModes button').count() === 3, 'all advanced toggles remain inside field');
  await search.focus();
  assert(await search.evaluate(el => getComputedStyle(el.parentElement).outlineStyle !== 'none'), 'search field needs visible focus outline');
  await search.fill('no-matching-item');
  await page.getByText('0 / 208 items', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('No matching files', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
  await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  assert(await search.inputValue() === '' && await search.evaluate(el => el === document.activeElement), 'clear restores results and focus');
  assert(!await page.locator('#emptyState').isVisible(), 'empty state disappears on recovery');
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const geometry = await rows.first().evaluate(row => ({
    height: row.getBoundingClientRect().height,
    controls: [...row.querySelectorAll('a, button')].map(el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; }),
    shareOpacity: row.querySelector('.file-link-action') && getComputedStyle(row.querySelector('.file-link-action')).opacity,
  }));
  if (owner) assert(geometry.shareOpacity === '1', 'Share is visible without hover');
  if (coarse) assert(geometry.height >= 44 && geometry.controls.every(([w, h]) => w >= 44 && h >= 44), 'coarse pointer targets must be at least 44px');
  await rows.first().locator('a').focus();
  await page.keyboard.press('End');
  const last = page.locator('.row[data-index="207"]');
  assert(await last.locator('a').evaluate(el => el === document.activeElement), 'End reaches last row');
  assert(Math.abs((await last.evaluate(el => parseFloat(el.style.top))) - 207 * geometry.height) < 1, 'virtual offsets match rendered row height');
  // Exercise a pointer-metric change without replacing the focused row.
  const changedHeight = geometry.height + 12;
  await page.evaluate(height => {
    document.getElementById('viewport').style.setProperty('--row-height', height + 'px');
    document.getElementById('scrollWrap').dispatchEvent(new Event('scroll'));
  }, changedHeight);
  await page.waitForFunction(height => [...document.querySelectorAll('#viewport .row')].every(row => parseFloat(row.style.top) === Number(row.dataset.index) * height), changedHeight);
  assert(await last.locator('a').evaluate(el => el === document.activeElement), 'metric changes preserve focused row');
  await page.evaluate(() => {
    document.getElementById('viewport').style.removeProperty('--row-height');
    document.getElementById('scrollWrap').dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(height => parseFloat(document.querySelector('.row[data-index="207"]').style.top) === 207 * height, geometry.height);
  await page.keyboard.press('Home');
  if (owner) {
    const current = page.url();
    await page.goto(new URL('/', current).href);
    await page.locator('#shareCurrent').click();
    assert(await page.locator('#shareTarget').textContent() === 'All files and folders', 'root target must be explicit');
    assert((await page.locator('#shareScope').textContent()).includes('all files and folders'), 'root scope warning must be explicit');
    await page.locator('#shareDialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('link', { name: /empty$/ }).click();
    await page.getByText('This folder is empty', { exact: true }).waitFor({ state: 'visible' });
    assert(!await page.getByRole('button', { name: 'Clear filter', exact: true }).isVisible(), 'empty folder does not suggest clearing absent filter');
    await page.goto(current);
    await page.getByText('208 items', { exact: true }).waitFor({ state: 'visible' });
  }
  return 'PASS: inline modes, focus, result announcements, empty recovery, visible sharing, root scope and pointer-aware virtualization';
}

if (typeof module !== 'undefined') module.exports = { checkUI, checkShareCopyReset, checkCompactLayout, checkFileFilter, checkUtilityPolish };
