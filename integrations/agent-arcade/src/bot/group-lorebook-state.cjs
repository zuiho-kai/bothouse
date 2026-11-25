'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicJSON} = require('../core/files.cjs');
const {LIMITS} = require('../vendor/sillytavern/world-info.cjs');

const SCHEMA = 1;
const MAX_BYTES = 128 * 1024;
const MAX_EFFECT_LENGTH = 100000;
const MAX_TURN = Math.floor((Number.MAX_SAFE_INTEGER - MAX_EFFECT_LENGTH - 1) / 2) - 1;
const DIGEST = /^[a-f0-9]{64}$/;
const ENGINE_KEY = /^\.[a-f0-9]{64}$/;
const storageError = () => Object.assign(new Error('Group world book timing could not be saved.'), {code: 'group_storage_unavailable'});
const digest = value => typeof value === 'string' && DIGEST.test(value);
const object = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const dataProperty = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
};
const exact = (value, keys) => object(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => dataProperty(value, key));
const absolute = file => typeof file === 'string' && path.isAbsolute(file) && !file.includes('\0');

function validGroupLorebookState(state) {
  if (!exact(state, ['approval', 'effects']) || !digest(state.approval)) return false;
  const {effects} = state;
  if (!exact(effects, ['turn', 'sticky', 'cooldown']) || !Number.isSafeInteger(effects.turn) ||
      effects.turn < 0 || effects.turn > MAX_TURN) return false;
  let count = 0;
  for (const type of ['sticky', 'cooldown']) {
    const values = effects[type];
    if (!object(values)) return false;
    const keys = Reflect.ownKeys(values);
    count += keys.length;
    if (count > LIMITS.stateEntries) return false;
    for (const key of keys) {
      if (typeof key !== 'string' || !ENGINE_KEY.test(key) || !dataProperty(values, key)) return false;
      const value = values[key];
      if (!exact(value, ['start', 'end', 'protected']) || !Number.isSafeInteger(value.start) ||
          value.start < 0 || value.start >= 2 * effects.turn || !Number.isSafeInteger(value.end) ||
          value.end <= value.start || value.end - value.start > MAX_EFFECT_LENGTH ||
          typeof value.protected !== 'boolean') return false;
    }
  }
  return true;
}

function validRecord(value) {
  return exact(value, ['schema', 'scope', 'revision', 'state']) && value.schema === SCHEMA &&
    digest(value.scope) && digest(value.revision) && (value.state === null || validGroupLorebookState(value.state));
}

const inspect = file => fs.lstatSync(file, {bigint: true});
const bounded = stat => stat.isFile() && !stat.isSymbolicLink() && stat.size > 0n && stat.size <= BigInt(MAX_BYTES);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

// The caller owns the established group directory. Hold the target file open
// while checking its identity and exact byte bound.
function loadRecord(file) {
  let before;
  try { before = inspect(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!bounded(before)) throw storageError();
  const handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(handle, {bigint: true});
    if (!bounded(opened) || !same(before, opened)) throw storageError();
    const bytes = Buffer.alloc(Number(opened.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = fs.readSync(handle, bytes, offset, bytes.length - offset, offset);
      if (!count) throw storageError();
      offset += count;
    }
    const final = inspect(file);
    if (!bounded(final) || !same(opened, fs.fstatSync(handle, {bigint: true})) || !same(opened, final)) throw storageError();
    const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!validRecord(record)) throw storageError();
    return record;
  } finally { fs.closeSync(handle); }
}

function readGroupLorebookState(file, scope, revision) {
  if (!absolute(file) || !digest(scope) || !digest(revision)) return undefined;
  try {
    const record = loadRecord(file);
    if (record?.scope === scope && record.revision === revision) return record.state ?? undefined;
  } catch { /* A missing, foreign or invalid state cannot activate lore. */ }
  return undefined;
}

function writeGroupLorebookState(file, scope, revision, state) {
  if (!absolute(file) || !digest(scope) || !digest(revision) || !validGroupLorebookState(state)) throw storageError();
  try {
    const current = loadRecord(file);
    if (current && current.scope !== scope) throw storageError();
    atomicJSON(file, {schema: SCHEMA, scope, revision, state});
    return true;
  } catch { throw storageError(); }
}

function clearGroupLorebookState(file, scope) {
  if (!absolute(file) || !digest(scope)) return false;
  try {
    const current = loadRecord(file);
    if (!current) return true;
    if (current.scope !== scope) return false;
    if (current.state !== null) atomicJSON(file, {...current, state: null});
    return true;
  } catch { return false; }
}

module.exports = {
  readGroupLorebookState, writeGroupLorebookState, clearGroupLorebookState, validGroupLorebookState,
};
