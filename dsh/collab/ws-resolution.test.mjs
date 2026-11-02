import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// conest-collab opens its own WebSocket server, so `ws` must be declared by this
// package (install.sh installs it from the lockfile) and must resolve from the
// plugin file itself, not from a transitive copy in the surrounding DSH runtime.
test('collab declares and resolves its own ws', () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies?.ws, 'ws must be a declared dependency of conest-collab');
  const require = createRequire(new URL('./plugin.mjs', import.meta.url));
  const ws = require('ws');
  assert.equal(typeof (ws.WebSocketServer ?? ws.Server), 'function', 'ws must resolve from the plugin itself');
});

// A module-level syntax error (e.g. two `const dsh` in one scope) only shows up when
// DSH actually imports the plugin, so catch it here before shipping.
test('collab plugin parses', () => {
  const plugin = fileURLToPath(new URL('./plugin.mjs', import.meta.url));
  execFileSync(process.execPath, ['--check', plugin], { stdio: 'pipe' });
});