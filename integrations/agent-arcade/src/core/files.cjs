'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Windows readers can briefly deny delete sharing, which also denies an atomic
// replacement with EPERM. Retry only the rename and keep the old file in place.
const WINDOWS_RENAME_DELAYS_MS = [8, 16, 32, 64];
function replaceStagedFile(tmp, file) {
  let waitSignal;
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(tmp, file); }
    catch (error) {
      const delay = WINDOWS_RENAME_DELAYS_MS[attempt];
      if (process.platform !== 'win32' || error.code !== 'EPERM' || delay === undefined) throw error;
      waitSignal ??= new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(waitSignal, 0, 0, delay);
    }
  }
}
function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    replaceStagedFile(tmp, file);
  }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function readJSON(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function drainInbox(root, store, { captureResults = false } = {}) {
  const dir = path.join(root, 'inbox');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const entries = [];
  for (const name of fs.readdirSync(dir).filter(n => /^\d+-[\w-]+\.json$/.test(n)).slice(0, 500)) {
    const file = path.join(dir, name);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    // A 16,000-character reply is up to three UTF-8 bytes per character, so the
    // bound must hold the largest event the hook itself can write.
    if (stat.size > 65536) { fs.unlinkSync(file); continue; }
    const event = readJSON(file, null);
    entries.push({ file, event });
  }
  entries.sort((a,b) => (a.event?.at || 0) - (b.event?.at || 0) || a.file.localeCompare(b.file));
  const changes = [];
  for (const { event } of entries) { if (event && typeof event === 'object' && !captureResults) event.result = ''; const c = store.apply(event); if (c) changes.push(c); }
  // Save before acknowledging the inbox. Replays after a crash are idempotent.
  if (entries.length) {
    atomicJSON(path.join(root, 'state.json'), store.export());
    for (const { file } of entries) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  return changes;
}
module.exports = { atomicJSON, readJSON, drainInbox };
