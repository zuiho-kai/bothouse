'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { classify } = require('./classify.cjs');
const full = { go: true, companion: true, dsh: true, docs_only: false };

test('README and prose skip all existing test jobs', () => {
  assert.deepEqual(classify(['README.md', 'docs/assets/demo.gif']), {
    go: false, companion: false, dsh: false, docs_only: true,
  });
});
test('workflow, helper, lockfile, script and embedded inputs force full coverage', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/ci/classify.cjs',
    'dsh/package-lock.json', 'dsh/collab/tasks.mjs', 'companion/tool.py',
    'bridge/core/dsh_bundle/team-mode-rules.md', 'unknown/input']) {
    assert.deepEqual(classify([path]), full, path);
  }
});
test('DSH client keeps client regressions without Go or companion', () => {
  assert.deepEqual(classify(['dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx']), {
    go: false, companion: false, dsh: true, docs_only: false,
  });
});
test('push and manual runs always retain all coverage', () => {
  for (const event of ['push', 'workflow_dispatch']) assert.deepEqual(classify(['README.md'], event), full);
  assert.deepEqual(classify([]), full);
});
test('mixed docs and Go changes retain Go coverage', () => {
  assert.equal(classify(['README.md', 'bridge/core/engine.go']).go, true);
});
test('renames classify both the old and new path', () => {
  const result = classify([{
    filename: 'README.md',
    previous_filename: 'bridge/core/engine.go',
  }]);
  assert.equal(result.go, true);
  assert.equal(result.docs_only, false);
});
test('workflow uses one classifier and fails open when changes fails', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /require\([^)]*classify\.cjs/);
  assert.doesNotMatch(workflow, /const classify = \(/);
  for (const job of ['companion', 'bridge', 'companion-fork', 'bridge-fork']) {
    const start = workflow.indexOf(`\n  ${job}:\n`);
    const next = workflow.slice(start + 4).search(/\n  \S/);
    const end = next === -1 ? -1 : start + 4 + next;
    const block = workflow.slice(start, end === -1 ? undefined : end);
    assert.match(block, /!cancelled\(\)/, job);
    assert.match(block, /needs\.changes\.result != 'success'/, job);
  }
});
