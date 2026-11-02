import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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