/**
 * QQ bridge config: masking, validation, and the view the panel consumes.
 * The child process is not started here (it would dial QQ); start/stop are covered
 * by the panel's manual test on a real bot.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { QqBridge, qqConfigPath } from './qq.mjs';

const quiet = { info() {}, warn() {}, error() {} };
const store = { room: (id) => (id === 1 ? { id: 1, name: 'general' } : id === 2 ? { id: 2, name: 'office' } : undefined) };

function tempBridge() {
  const dir = mkdtempSync(join(tmpdir(), 'qq-bridge-'));
  return { dir, bridge: new QqBridge(store, { dataDir: dir, logger: quiet }) };
}

test('qq: defaults to unconfigured and never echoes the secret', () => {
  const { dir, bridge } = tempBridge();
  const empty = bridge.view();
  assert.equal(empty.configured, false);
  assert.equal(empty.running, false);
  assert.deepEqual(empty.log, []);

  const saved = bridge.save({ appId: ' 123456 ', appSecret: 'super-secret', roomId: 1, defaultMember: '大肥鱼' });
  assert.equal(saved.appId, '123456');
  assert.equal(saved.configured, true);
  assert.equal(saved.appSecretMasked, '••••cret');
  assert.ok(!JSON.stringify(saved).includes('super-secret'), 'the full secret must not reach the panel');

  const onDisk = JSON.parse(readFileSync(qqConfigPath(dir), 'utf8'));
  assert.equal(onDisk.appSecret, 'super-secret');
  assert.equal(statSync(qqConfigPath(dir)).mode & 0o777, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

test('qq: an empty or masked secret keeps the stored one', () => {
  const { dir, bridge } = tempBridge();
  bridge.save({ appId: '1', appSecret: 'first-secret', roomId: 1 });
  assert.equal(bridge.save({ appId: '1', appSecret: '', roomId: 1 }).appSecretMasked, '••••cret');
  assert.equal(bridge.save({ appId: '1', roomId: 1 }).appSecretMasked, '••••cret');
  assert.equal(JSON.parse(readFileSync(qqConfigPath(dir), 'utf8')).appSecret, 'first-secret');
  // A new secret replaces the old one.
  assert.equal(bridge.save({ appId: '1', appSecret: 'second-secret', roomId: 2 }).appSecretMasked, '••••cret');
  assert.equal(JSON.parse(readFileSync(qqConfigPath(dir), 'utf8')).roomId, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('qq: rejects a missing AppID, a missing secret, and an unknown room', () => {
  const { dir, bridge } = tempBridge();
  assert.throws(() => bridge.save({ appId: '', appSecret: 'x', roomId: 1 }), /AppID/);
  assert.throws(() => bridge.save({ appId: '1', roomId: 1 }), /AppSecret/);
  assert.throws(() => bridge.save({ appId: '1', appSecret: 'x', roomId: 99 }), /频道 99 不存在/);
  rmSync(dir, { recursive: true, force: true });
});

test('qq: start refuses without a saved config, stop is idempotent', () => {
  const { dir, bridge } = tempBridge();
  assert.throws(() => bridge.start(), /还没有保存/);
  const stopped = bridge.stop();
  assert.equal(stopped.running, false);
  rmSync(dir, { recursive: true, force: true });
});
