// Fixtures build a tiny root shaped like the repo, so the checks are exercised
// without depending on the real mirror's current contents.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { check, checkBuiltStaleness, compareTree } from './check-dsh-bundle-sync.mjs'
import { COPY_PAIRS } from './dsh-bundle-pairs.mjs'

const collab = COPY_PAIRS[0]

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'dshbundle-'))
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const wrapped = 'window.__ModuleLoader__.load({ id: "x", factory: () => {} })\n'

// check() scans every pair, so the file pairs and a wrapped bundle must exist for a
// fixture to represent a healthy tree.
const healthy = {
  'dsh/install.sh': 'install\n',
  'bridge/core/dsh_bundle/install.sh': 'install\n',
  'dsh/packages/client-ui-discord/package.json': '{}\n',
  'bridge/core/dsh_bundle/packages/client-ui-discord/package.json': '{}\n',
  'dsh/packages/client-ui-discord/lib/client.js': wrapped,
  'bridge/core/dsh_bundle/packages/client-ui-discord/lib/client.js': wrapped,
}

test('identical trees report nothing', () => {
  const root = fixture({
    [`${collab.from}/hub.mjs`]: 'hub\n',
    [`${collab.to}/hub.mjs`]: 'hub\n',
  })
  assert.deepEqual(compareTree(root, collab), [])
})

test('a source file missing from the mirror is reported', () => {
  const root = fixture({
    [`${collab.from}/tasks.mjs`]: 'tasks\n',
    [`${collab.to}/hub.mjs`]: 'hub\n',
    [`${collab.from}/hub.mjs`]: 'hub\n',
  })
  const problems = compareTree(root, collab)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].kind, 'missing')
  assert.match(problems[0].path, /collab\/tasks\.mjs$/)
})

test('a mirror file edited while the source was not is reported', () => {
  const root = fixture({
    [`${collab.from}/hub.mjs`]: 'source\n',
    [`${collab.to}/hub.mjs`]: 'hand edited\n',
  })
  const problems = compareTree(root, collab)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].kind, 'differs')
})

test('a file left in the mirror after its source was deleted is reported', () => {
  const root = fixture({
    [`${collab.to}/gone.mjs`]: 'gone\n',
    [`${collab.from}/hub.mjs`]: 'hub\n',
    [`${collab.to}/hub.mjs`]: 'hub\n',
  })
  const problems = compareTree(root, collab)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].kind, 'stale')
})

test('files the installer generates are not mirrored and do not count', () => {
  const root = fixture({
    [`${collab.from}/hub.mjs`]: 'hub\n',
    [`${collab.to}/hub.mjs`]: 'hub\n',
    [`${collab.from}/package-lock.json`]: '{}\n',
    [`${collab.from}/.npmrc`]: 'registry=x\n',
    [`${collab.from}/test/smoke.mjs`]: 'smoke\n',
  })
  assert.deepEqual(compareTree(root, collab), [])
})

test('an unwrapped frontend bundle is reported', () => {
  const root = fixture({
    ...healthy,
    'bridge/core/dsh_bundle/packages/client-ui-discord/lib/client.js': 'var raw = 1\n',
  })
  const problems = check(root)
  assert.deepEqual(problems.map((p) => p.kind), ['unwrapped'])
})

test('a wrapped frontend bundle passes', () => {
  assert.deepEqual(check(fixture(healthy)), [])
})

test('a bundle registered under another id is reported', () => {
  const root = fixture({
    ...healthy,
    'dsh/packages/client-ui-discord/package.json': '{"name":"@deepseek-ai/other"}\n',
    'bridge/core/dsh_bundle/packages/client-ui-discord/package.json': '{"name":"@deepseek-ai/other"}\n',
  })
  const problems = check(root)
  assert.deepEqual(problems.map((p) => p.kind), ['wrong-id'])
})

test('touching src without the mirror is stale; touching both is fine', () => {
  const pair = {
    src: 'dsh/packages/client-ui-discord/src',
    to: 'bridge/core/dsh_bundle/packages/client-ui-discord/lib',
  }
  const stale = checkBuiltStaleness('', pair, ['dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx'])
  assert.equal(stale.length, 1)
  assert.equal(stale[0].kind, 'unsynced')
  const both = checkBuiltStaleness('', pair, [
    'dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx',
    'bridge/core/dsh_bundle/packages/client-ui-discord/lib/client.js',
  ])
  assert.deepEqual(both, [])
  const untouched = checkBuiltStaleness('', pair, ['bridge/core/task_card.go'])
  assert.deepEqual(untouched, [])
})

test('the real repository mirror is in sync', () => {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  assert.deepEqual(check(repo), [], 'run node scripts/sync-dsh-bundle.mjs')
})
