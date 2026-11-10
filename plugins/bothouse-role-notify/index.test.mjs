import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyCommand } from './index.mjs';

test('macOS quotes title and body for AppleScript', () => {
  const [cmd, args] = notifyCommand('darwin', 'A "x"', 'b');
  assert.equal(cmd, 'osascript');
  assert.equal(args[1], 'display notification "b" with title "A \\"x\\""');
});
test('linux uses notify-send; others have none', () => {
  assert.deepEqual(notifyCommand('linux', 't', 'b'), ['notify-send', ['t', 'b']]);
  assert.equal(notifyCommand('win32', 't', 'b'), undefined);
});
