'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [action, checkout, ...extra] = process.argv.slice(2);
const here = __dirname;
const privateSegments = new Set(['.local', '.git', 'node_modules', 'roles-local', 'secrets']);
const reviewedDotfiles = new Set([
  'plugins/desktop-pet/.gitignore',
  'plugins/desktop-pet/.prettierignore',
  'plugins/desktop-pet/.prettierrc.json',
]);
const gitOid = /^[a-f0-9]{40}$/u;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function pinnedFiles(manifest, includeDevelopment) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.upstream, 'https://github.com/zuiho-kai/bothouse');
  assert.match(manifest.commit, gitOid, 'Pin the full upstream commit.');
  assert(Array.isArray(manifest.groups) && manifest.groups.length > 0, 'Select explicit groups.');
  const files = new Map();
  const names = new Set(), groups = new Set();
  for (const group of manifest.groups) {
    assert.match(group.name, /^[a-z0-9][a-z0-9-]*$/u);
    assert(!groups.has(group.name), 'Duplicate group: ' + group.name);
    groups.add(group.name);
    assert(Array.isArray(group.files) && group.files.length > 0, 'The group has no pinned files: ' + group.name);
    assert(!group.delivery || group.delivery === 'development', 'Invalid delivery: ' + group.name);
    for (const file of group.files) {
      const segments = file.path.split('/');
      const portable = file.path.toLowerCase();
      assert(segments.every((segment, index) =>
        !segment.endsWith('.') && !privateSegments.has(segment.toLowerCase()) &&
        (/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/u.test(segment) ||
          index === segments.length - 1 && reviewedDotfiles.has(file.path))),
      'Invalid or private source path: ' + file.path);
      assert(!names.has(portable), 'Duplicate source path: ' + file.path);
      assert.match(file.blob, gitOid, 'Pin the Git blob: ' + file.path);
      assert(['100644','100755'].includes(file.mode), 'Expected a regular Git file: ' + file.path);
      if (includeDevelopment || !group.delivery) files.set(file.path, file);
      names.add(portable);
    }
  }
  return files;
}

function verifyBridgeReview(manifest, files) {
  if (!manifest.bridgeReview) return;
  function readReview(name, digest) {
    const bytes = fs.readFileSync(path.join(here, 'provenance', name));
    assert.equal(sha256(bytes), digest, 'Provenance digest mismatch: ' + name);
    return JSON.parse(bytes);
  }
  const review = readReview('allowlist.json', manifest.bridgeReview.allowlistSHA256);
  assert.equal(review.upstream, manifest.upstream);
  assert.equal(review.commit, manifest.commit);
  assert.equal(review.basisInventorySHA256, manifest.inventory.sha256);
  const evidence = readReview('file-evidence.json', review.evidenceSHA256);
  const witnesses = readReview('source-witnesses.json', review.sourceWitnessesSHA256);
  for (const witness of witnesses) {
    if (witness.contentBase64) {
      const bytes = Buffer.from(witness.contentBase64, 'base64');
      assert.equal(bytes.toString('base64'), witness.contentBase64, 'Invalid witness bytes: ' + witness.path);
      verifyBlob(witness.path, bytes, witness.blob);
    }
  }
  assert.equal(evidence.upstreamCommit, review.commit);
  assert.equal(evidence.manifestSHA256, review.basisManifestSHA256);
  assert.equal(evidence.inventorySHA256, review.basisInventorySHA256);
  assert.equal(evidence.rows.length, review.files.length);
  const rows = new Map(evidence.rows.map(row => [row.path, row]));
  const group = manifest.groups.find(group => group.name === 'reviewed-bridge-source');
  assert.equal(group.files.length, review.files.length);
  assert.equal(review.files.length, review.counts.allowed);
  const counts = {};
  for (const row of review.files) {
    const pinned = files.get(row.path);
    const source = rows.get(row.path);
    assert.deepEqual(pinned, {
      path:row.path, blob:row.blob, mode:row.mode, license:row.license, sha256:row.sha256, notices:row.notices,
    }, 'Reviewed file differs from manifest: ' + row.path);
    assert.equal(source.blob, row.blob);
    assert.equal(source.mode, row.mode);
    assert.equal(source.sha256, row.sha256);
    assert.deepEqual(source.introduction, row.introduction);
    assert.deepEqual(source.lastChange, row.lastChange);
    for (const notice of row.notices) {
      assert.equal(files.get(notice)?.blob, review.noticeBlobs[notice], 'Notice differs: ' + notice);
      assert(files.has(notice), 'Notice is missing: ' + notice);
    }
    counts[row.license] = (counts[row.license] ?? 0) + 1;
  }
  assert.deepEqual(counts, review.counts.license);
}

function readUpstream(checkout, commit, files, needContent) {
  const root = fs.realpathSync(checkout);
  const git = (args, input) => execFileSync('git', ['--no-optional-locks', '--no-replace-objects',
    '-c', 'safe.directory=' + root.replaceAll('\\','/'), '-C', root, ...args],
  {windowsHide:true, maxBuffer:64 * 1024 * 1024, input});
  assert.equal(path.resolve(git(['rev-parse', '--show-toplevel']).toString().trim()), root,
    'Give the root of the Bothouse checkout.');
  assert.equal(git(['rev-parse', '--verify', commit + '^{commit}']).toString().trim(), commit);
  const entries = git(['ls-tree', '-r', '-z', commit]).toString().split('\0').filter(Boolean);
  let verified = 0;
  for (const entry of entries) {
    const [metadata, name] = entry.split('\t', 2);
    const pinned = files.get(name);
    if (!pinned) continue;
    assert.equal(metadata, pinned.mode + ' blob ' + pinned.blob, 'Upstream tree differs at ' + name);
    verified++;
  }
  assert.equal(verified, files.size, 'Upstream path set differs from the manifest.');
  const material = new Map();
  if (!needContent || !files.size) return material;
  const byBlob = new Map();
  const ids = [...new Set([...files.values()].map(file => file.blob))];
  const batch = git(['cat-file', '--batch'], ids.join('\n') + '\n');
  let offset = 0;
  for (const blob of ids) {
    const end = batch.indexOf(10, offset);
    assert(end >= offset, 'Truncated header for ' + blob);
    const header = batch.toString('ascii', offset, end).split(' ');
    const size = Number(header[2]);
    assert(header[0] === blob && header[1] === 'blob' && Number.isSafeInteger(size) && size >= 0,
      'Invalid batch result for ' + blob);
    offset = end + 1;
    assert.equal(batch[offset + size], 10, 'Truncated blob ' + blob);
    const bytes = batch.subarray(offset, offset + size);
    verifyBlob(blob, bytes, blob);
    byBlob.set(blob, bytes);
    offset += size + 1;
  }
  assert.equal(offset, batch.length);
  for (const [name, file] of files) {
    const bytes = byBlob.get(file.blob);
    if (file.sha256) assert.equal(sha256(bytes), file.sha256, 'SHA-256 mismatch at ' + name);
    material.set(name, bytes);
  }
  return material;
}

function verifyBlob(name, bytes, expected) {
  const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  assert.equal(actual, expected, 'Blob mismatch at ' + name);
}

function onDisk(rootPath, files) {
  const present = new Set();
  function walk(directory, prefix) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      const key = prefix + entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target, key + '/');
      else {
        const pinned = files.get(key);
        assert(entry.isFile() && pinned, 'Unexpected vendored entry: ' + key);
        const bytes = fs.readFileSync(target);
        verifyBlob(key, bytes, pinned.blob);
        if (pinned.sha256) assert.equal(sha256(bytes), pinned.sha256, 'SHA-256 mismatch at ' + key);
        present.add(key);
      }
    }
  }
  const root = fs.lstatSync(rootPath, {throwIfNoEntry:false});
  if (root) {
    assert(root.isDirectory() && !root.isSymbolicLink(), 'Vendor root is not a real directory.');
    walk(rootPath, '');
  }
  return present;
}

function main() {
  if (action === '--help') {
    console.log('node vendor/bothouse/import.cjs --import BOTHOUSE_CHECKOUT\n' +
      'node vendor/bothouse/import.cjs --check [BOTHOUSE_CHECKOUT]\n' +
      'node vendor/bothouse/import.cjs --materialize BOTHOUSE_CHECKOUT\n' +
      'node vendor/bothouse/import.cjs --check-materialized [BOTHOUSE_CHECKOUT]');
    return;
  }
  const development = ['--materialize', '--check-materialized'].includes(action);
  const writing = ['--import', '--materialize'].includes(action);
  assert(extra.length === 0 && (writing || action === '--check' || action === '--check-materialized') &&
    (!writing || checkout), 'Run --help for usage.');
  const manifest = JSON.parse(fs.readFileSync(path.join(here,'manifest.json'),'utf8'));
  const files = pinnedFiles(manifest, development);
  if (development) verifyBridgeReview(manifest, files);
  const destinationRoot = path.join(here, development ? 'materialized' : 'upstream');
  const present = onDisk(destinationRoot, files);
  const material = checkout ? readUpstream(checkout, manifest.commit, files, writing) : new Map();
  const missing = [...files.keys()].filter(name => !present.has(name));
  if (writing) {
    for (const file of missing) {
      const destination = path.join(destinationRoot, file);
      fs.mkdirSync(path.dirname(destination), {recursive:true});
      fs.writeFileSync(destination, material.get(file), {
        flag:'wx', mode:files.get(file).mode === '100755' ? 0o755 : 0o644
      });
    }
    assert.equal(onDisk(destinationRoot, files).size, files.size);
  } else assert.deepEqual(missing, [], 'Missing vendored files.');
  console.log(JSON.stringify({commit:manifest.commit, groups:manifest.groups.filter(group => development || !group.delivery).length,
    files:files.size, written:writing ? missing.length : 0, checkedSourceTree:!!checkout}));
}

try {main();} catch (error) {console.error(error.message);process.exitCode=1;}
