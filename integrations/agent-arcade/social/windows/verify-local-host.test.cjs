'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { boot } = require('../../test/helpers/platform-main-harness.cjs');
const { createSocialView } = require('./social-view.cjs');

test('the existing local Electron host retains its IPC handlers with a separate social view', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network is needed for this isolation rehearsal.'));
  const host = await boot(t, { platform: 'win32' });
  const snapshot = await host.invoke('snapshot');
  const initialCards = await host.invoke('charactersList');
  const productionPreload = host.window.options.webPreferences.preload;
  assert.ok(productionPreload.endsWith('preload.cjs'));
  assert.equal(snapshot.bot.hasKey, false);
  const channels = [...host.handlers.keys()];
  assert(channels.includes('arcade:botDisconnect'));
  assert(channels.includes('arcade:taskPickProject'));
  assert(channels.includes('arcade:charactersList'));
  const localContents = host.window.webContents;

  class RemoteView {
    constructor({ webPreferences }) {
      assert.match(webPreferences.preload,/[\\/]privacy-preload\.cjs$/);
      assert.equal(webPreferences.nodeIntegration, false);
      assert.equal(webPreferences.sandbox, true);
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {},
        loadURL: async url => assert.equal(url, 'http://127.0.0.1:8765'),
      });
    }
  }
  const remoteSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {} },
  });
  const guest = createSocialView({
    WebContentsView: RemoteView,
    session: { fromPartition: () => remoteSession },
    configuration: { mode: 'test', origin: 'http://127.0.0.1:8765' },
  });
  // The production-window mock has no composition methods. Rehearse just the
  // host attachment boundary without creating or operating a native window.
  const attached = [];
  host.window.contentView = { addChildView: view => attached.push(view) };
  host.window.contentView.addChildView(guest.view);
  await guest.load();
  assert.equal(attached.length, 1);
  assert.notEqual(guest.view.webContents, localContents);
  assert.equal(host.window.webContents, localContents);
  assert.equal(host.window.options.webPreferences.preload, productionPreload);
  assert.deepEqual([...host.handlers.keys()], channels);
  assert.deepEqual(await host.invoke('charactersList'), initialCards);
  const taskPick = await host.invoke('taskPickProject');
  assert.equal(taskPick.code, 'cancelled');
  const after = await host.invoke('snapshot');
  assert.equal(after.accounts.selectedId, snapshot.accounts.selectedId);
  assert.equal(after.bot.hasKey, false);
});
