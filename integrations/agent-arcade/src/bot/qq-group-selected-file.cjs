'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

// Callers construct the filename from validated identifiers and a content hash.
function ownedPath(root, directory, filename) {
  const dir = path.join(root, directory);
  if (fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) {
    throw Object.assign(Error('Group media directory changed.'), {code:'changed'});
  }
  return path.join(dir, filename);
}

function writeOwnedFile(target, bytes) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const staging = path.join(dir, randomUUID() + '.tmp');
  try {
    fs.writeFileSync(staging, bytes, {flag:'wx', mode:0o600});
    fs.renameSync(staging, target);
  } finally { fs.rmSync(staging, {force:true}); }
}

// Called after a successful configuration replacement or to retire an
// unreferenced staging result after a failed save. Never follow paths in config.
function retireOwnedFiles(root, oldRows, nextRows, fileFor) {
  if (!Array.isArray(oldRows)) return;
  const kept = new Set();
  for (const row of Array.isArray(nextRows) ? nextRows : []) {
    try { kept.add(fileFor(root, row)); } catch {}
  }
  for (const row of oldRows) {
    try {
      const file = fileFor(root, row);
      if (!kept.has(file)) fs.rmSync(file, {force:true});
    } catch { /* The retired grant is already unusable. */ }
  }
}

module.exports = {ownedPath, writeOwnedFile, retireOwnedFiles};
