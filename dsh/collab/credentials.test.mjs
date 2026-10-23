import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveConfig } from './plugin.mjs';
import { loadBotCredentials } from './credentials.mjs';

test('wizard credentials load into the real server config and conflicts fail explicitly', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'collab-credentials-'));
  const config = { dataDir, workspacePath: dataDir };
  assert.equal(resolveConfig(config, {}).botTokens.size, 0);
  writeFileSync(join(dataDir, 'cloud-web-bot-tokens.json'), JSON.stringify({ alpha: 'alpha-test-only', beta: 'beta-test-only' }), { mode: 0o600 });
  const resolved = resolveConfig(config, {});
  assert.equal(resolved.botTokens.get('alpha-test-only'), 'alpha');
  assert.equal(resolved.botTokens.get('beta-test-only'), 'beta');
  assert.throws(() => resolveConfig({ ...config, botTokens: { alpha: 'old-test-only' } }, {}), /conflicting bot credentials/);
  assert.throws(() => resolveConfig(config, { CONEST_COLLAB_BOT_TOKENS: 'alpha:old-test-only' }), /conflicting bot credentials/);
  assert.equal(resolveConfig({ ...config, botTokens: { alpha: 'alpha-test-only' } }, {}).botTokens.size, 2);
});

test('malformed, reserved, duplicated, exposed and symlink credentials fail closed without printing secrets', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'collab-bad-credentials-'));
  const file = join(dataDir, 'cloud-web-bot-tokens.json');
  for (const value of ['{SECRET', 'null', '[]', '{"owner":"SECRET"}', '{"a":"SECRET","b":"SECRET"}']) {
    writeFileSync(file, value, { mode: 0o600 });
    assert.throws(() => resolveConfig({ dataDir, workspacePath: dataDir }, {}), error => !error.message.includes('SECRET'));
  }
  if (process.platform === 'win32') return;
  chmodSync(file, 0o644);
  assert.throws(() => loadBotCredentials(dataDir), /private/);
  const linkDir = mkdtempSync(join(tmpdir(), 'collab-link-credentials-'));
  symlinkSync(file, join(linkDir, 'cloud-web-bot-tokens.json'));
  assert.throws(() => loadBotCredentials(linkDir), /regular private/);
});
