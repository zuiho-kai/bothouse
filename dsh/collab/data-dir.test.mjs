import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';

// Evaluate the actual Cordis !!js default, not a duplicate resolver.
const patch = readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8');
const expression = patch.match(/^\s+dataDir: !!js (.+)$/m)[1];
const resolve = env => runInNewContext(expression, { process: { env, getBuiltinModule: process.getBuiltinModule } });

// A !!js scalar with a flow indicator in it (`? :` inside `( … )`) is read as a mapping and the
// whole patch fails to load, so DSH drops the plugin and never imports the wizard roles: the
// Windows e2e run 42800252226 sat in "did not import the wizard roles" for 240s on 11-10.
test('the patch is YAML and keeps dataDir a scalar expression', () => {
  const doc = parseDocument(patch);
  assert.deepEqual(doc.errors, [], 'cordis.patch.yml must parse');
  const cfg = doc.toJS()[0].insert.find(e => e.id === 'conest-collab').config;
  assert.equal(typeof cfg.dataDir, 'string', 'the !!js tag must stay on one plain scalar');
  assert.equal(cfg.dataDir, expression);
});

test('channel data keeps the legacy default without BOTHOUSE_DATA_DIR', () => {
  assert.equal(resolve({}), join(homedir(), '.conest-collab'));
  assert.equal(resolve({ BOTHOUSE_DATA_DIR: '' }), join(homedir(), '.conest-collab'));
});

test('channel data follows the isolated data directory', () => {
  const data = join(homedir(), 'isolated bothouse');
  assert.equal(resolve({ BOTHOUSE_DATA_DIR: data }), join(data, 'conest-collab'));
});

test('explicit channel data keeps precedence', () => {
  const explicit = join(homedir(), 'chosen channels');
  assert.equal(resolve({ BOTHOUSE_DATA_DIR: join(homedir(), 'isolated'), CONEST_COLLAB_DATA: explicit }), explicit);
});
