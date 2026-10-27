const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('browser scope defaults to all engines; quick mode is explicit and strict', () => {
  const runner = path.join(__dirname, 'browser_smoke.cjs');
  assert.ok(/if \(require\.main === module\)/.test(fs.readFileSync(runner, 'utf8')),
    'importing the selector must not start a browser fixture');
  const { browserEngines } = require(runner);
  assert.deepEqual(browserEngines([]).map(([name]) => name), ['chromium', 'firefox', 'webkit']);
  assert.deepEqual(browserEngines(['--chromium-only']).map(([name]) => name), ['chromium']);
  assert.throws(() => browserEngines(['--chromum-only']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  assert.throws(() => browserEngines(['unexpected']), { code: 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' });
});
