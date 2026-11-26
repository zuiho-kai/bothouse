'use strict';

const {setTimeout: wait} = require('node:timers/promises');

const storeUpdatesPage = 'ms-windows-store://downloadsandupdates';
// Kept in the same order as the Result enum in store-update.cpp.
const results = ['unavailable', 'pending', 'current', 'available', 'completed', 'cancelled', 'power', 'network'];

function createStoreUpdate({version, enabled, getWindow, openExternal, loadNative, isClosing,
  notify = () => {}, delay = wait}) {
  let state = {channel:'store', current:version, status:enabled ? 'idle' : 'test_build'};
  let busy = false;
  const set = status => {
    state = {...state, status};
    notify(state);
    return state;
  };

  async function run(install) {
    if (!enabled || busy || isClosing() || (install && !['available','cancelled'].includes(state.status))) return state;
    busy = true;
    try {
      set(install ? 'installing' : 'checking');
      const window = getWindow();
      if (!window || window.isDestroyed()) return set('unavailable');
      const native = loadNative();
      let result = native.begin(window.getNativeWindowHandle(), Number(install));
      while (results[result] === 'pending') {
        await delay(200);
        result = native.result();
      }
      return set(results[result] ?? 'unavailable');
    } catch { return set('unavailable'); }
    finally { busy = false; }
  }

  async function openStore() {
    if (!enabled || busy || isClosing() || !['unavailable','power','network','store_opened','store_open_failed'].includes(state.status)) return state;
    busy = true;
    try {
      await openExternal(storeUpdatesPage);
      return set('store_opened');
    } catch { return set('store_open_failed'); }
    finally { busy = false; }
  }

  return {state:() => state, check:() => run(false), start:() => run(true), openStore,
    async commit() {}, failed() {}};
}

module.exports = {createStoreUpdate};
