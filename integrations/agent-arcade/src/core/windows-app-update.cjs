'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');

const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}-preview\.\d{1,6}\.personal\.([1-9]\d{0,5})$/;
const statuses = new Set(['current','available','unavailable','invalid_package','changed','prepared','busy']);

// Provided only by the Windows daily launcher. The renderer supplies neither
// executable paths nor arguments to this bridge.
function dailyUpdateBinding(value, argv) {
  try {
    const marks = argv.filter(arg => /^--arcade-daily-proof=[a-f0-9]{48}$/.test(arg));
    if (marks.length !== 1 || typeof value !== 'string' || value.length > 4096) return null;
    const {node, helper, sha256} = JSON.parse(value);
    if (!path.win32.isAbsolute(node) || path.win32.basename(node).toLowerCase() !== 'node.exe' ||
        !path.win32.isAbsolute(helper) || path.win32.basename(helper) !== 'app-update.cjs' ||
        !/^[a-f0-9]{64}$/.test(sha256)) return null;
    return {node, helper, sha256};
  } catch { return null; }
}

async function openHelper(binding, request) {
  const stat = fs.lstatSync(binding.helper);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 ||
      createHash('sha256').update(fs.readFileSync(binding.helper)).digest('hex') !== binding.sha256) {
    return {result:{status:'unavailable'}};
  }
  const env = {...process.env};
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  }
  const child = spawn(binding.node, [binding.helper], {env, windowsHide:true, detached:true, stdio:['pipe','pipe','ignore']});
  child.stdin.on('error', () => {});
  const cancel = () => child.stdin.end();
  const result = await new Promise(resolve => {
    let done = false, buffer = '';
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (value.status !== 'prepared') cancel();
      resolve(value);
    };
    const timer = setTimeout(() => finish({status:'unavailable'}), 35000);
    child.on('error', () => finish({status:'unavailable'}));
    child.on('close', () => finish({status:'unavailable'}));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) return finish({status:'unavailable'});
      if (!buffer.endsWith('\n')) return;
      try {
        const value = JSON.parse(buffer);
        finish(statuses.has(value?.status) ? {status:value.status, target:value.target} : {status:'unavailable'});
      } catch { finish({status:'unavailable'}); }
    });
    child.stdin.write(JSON.stringify(request)+'\n');
  });
  return {
    result, cancel,
    async commit() {
      if (child.exitCode !== null || child.stdin.destroyed || !child.stdin.writable) throw Error('Update helper is unavailable');
      await new Promise((resolve,reject) => child.stdin.write('commit\n', error => error ? reject(error) : resolve()));
      child.stdin.end();
      child.stdout.destroy();
      child.unref();
    },
  };
}

function createWindowsUpdate({version, binding, identity, isClosing, confirm, quit, notify = () => {}, open = openHelper}) {
  let state = {status:binding ? 'idle' : 'unavailable', current:version}, pending, busy = false;
  const set = (status, target) => {
    state = {...(versionPattern.test(target) ? {target} : {}), status, current:version};
    notify(state);
    return state;
  };
  async function ask(action, target) {
    try {
      return await open(binding, {action, ...identity(), version, target});
    } catch { return {result:{status:'unavailable'}}; }
  }
  async function check() {
    if (busy || pending || isClosing()) return state;
    if (!binding) return set('unavailable');
    busy = true;
    set('checking');
    try {
      const {result} = await ask('check');
      return set(result.status === 'prepared' ? 'unavailable' : result.status, result.target);
    } finally { busy = false; }
  }
  async function start(target) {
    if (busy || pending || isClosing() || !binding || !['available','cancelled','quit_failed'].includes(state.status) ||
        target !== state.target || !versionPattern.test(target)) return state;
    busy = true;
    try {
      if (!await confirm(target)) return set('cancelled', target);
      if (isClosing()) return state;
      set('preparing', target);
      const prepared = await ask('prepare', target);
      if (prepared.result.status !== 'prepared' || prepared.result.target !== target || isClosing()) {
        prepared.cancel?.();
        return set(prepared.result.status === 'prepared' ? 'changed' : prepared.result.status, target);
      }
      pending = prepared;
      set('restarting', target);
      quit();
      return state;
    } catch {
      pending?.cancel();
      pending = null;
      return set('unavailable');
    } finally { busy = false; }
  }
  return {
    state: () => state, check, start,
    async commit() {
      if (pending) await pending.commit();
      pending = null;
    },
    failed() {
      if (!pending) return;
      pending.cancel();
      pending = null;
      set('quit_failed', state.target);
    },
  };
}

module.exports = {createWindowsUpdate, dailyUpdateBinding, versionPattern};
