import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

// Evaluate the actual Cordis !!js default, not a duplicate resolver.
const patch = readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8');
const expression = patch.match(/^\s+dataDir: !!js (.+)$/m)[1];
const resolve = env => runInNewContext(expression, { process: { env, getBuiltinModule: process.getBuiltinModule } });

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
