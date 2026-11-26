#!/usr/bin/env node
'use strict';
// Observer only: never print decisions, deny actions, or fail a Claude hook.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalize } = require('./core/events.cjs');
const { atomicJSON, readJSON } = require('./core/files.cjs');
const timer = setTimeout(() => process.exit(0), 1500);
function observerKey(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, 'observer-key');
  try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  // An independent hook may have just created the file and not finished its
  // tiny write yet. Retry briefly; never replace an existing observer key.
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = fs.readFileSync(file);
    if (key.length === 32) return key;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  return undefined;
}
let data = ''; let bytes = 0;
// Decode across chunk boundaries so a split UTF-8 reply is not corrupted.
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  bytes += Buffer.byteLength(chunk, 'utf8');
  if (bytes > 2 * 1024 * 1024) process.exit(0);
  data += chunk;
});
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const root = process.env.AGENT_ARCADE_HOME || path.join(os.homedir(), '.agent-arcade');
    const config = readJSON(path.join(root, 'config.json'));
    const e = normalize(JSON.parse(data), { captureResults: config.captureResults === true, observerKey: observerKey(root) });
    if (e) {
      const inbox = path.join(root, 'inbox');
      fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
      // Bound offline storage. Drop oldest events after 24h or 2,000 entries.
      const names = fs.readdirSync(inbox).filter(n => /^\d+-[\w-]+\.json$/.test(n)).sort();
      for (let i = 0; i < names.length; i++) if (i < names.length - 1999 || Number(names[i].split('-')[0]) < Date.now() - 86400000) {
        try { fs.unlinkSync(path.join(inbox, names[i])); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      atomicJSON(path.join(inbox, `${e.at}-${e.id}.json`), e);
    }
  } catch { /* Observability must not interrupt the agent. */ }
  clearTimeout(timer);
  process.exit(0);
});
