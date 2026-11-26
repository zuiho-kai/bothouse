'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { classify } = require('./classify.cjs');
const full = { go: true, dsh: true, docs_only: false };

test('README and prose skip all existing test jobs', () => {
  assert.deepEqual(classify(['README.md', 'docs/assets/demo.gif']), {
    go: false, dsh: false, docs_only: true,
  });
});
test('workflow, helper, lockfile, script and embedded inputs force full coverage', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/ci/classify.cjs',
    'dsh/package-lock.json', 'dsh/collab/tasks.mjs',
    'bridge/core/dsh_bundle/team-mode-rules.md', 'unknown/input',
    'patches/jiuwenswarm/manifest.json', 'patches/jiuwenswarm/workswarm-0.2.8/runtime_prompt_rail.patch',
    'jiuwenswarm/plugin-pkg/files.txt', 'bridge/contrib/wiki/template/MEMORY.md']) {
    assert.deepEqual(classify([path]), full, path);
  }
});
test('DSH client keeps client regressions without Go', () => {
  assert.deepEqual(classify(['dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx']), {
    go: false, dsh: true, docs_only: false,
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
  for (const job of ['bridge', 'bridge-fork']) {
    const start = workflow.indexOf(`\n  ${job}:\n`);
    const next = workflow.slice(start + 4).search(/\n  \S/);
    const end = next === -1 ? -1 : start + 4 + next;
    const block = workflow.slice(start, end === -1 ? undefined : end);
    // bridge / bridge-fork aggregate shard results and must run even when the run is
    // cancelled, otherwise a skipped required check counts as passing.
    const guard = job.startsWith('bridge') ? /always\(\)/ : /!cancelled\(\)/;
    assert.match(block, guard, job);
    assert.match(block, /needs\.changes\.result != 'success'/, job);
  }
});
