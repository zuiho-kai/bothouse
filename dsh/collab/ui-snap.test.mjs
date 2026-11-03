// 截图回归入口（Issue #98 U7）。跑法：
//   PUPPETEER_MODULE=/abs/node_modules/puppeteer-core node --test dsh/collab/ui-snap.test.mjs
// 没装浏览器时整条 skip；更新基准用 ui-snap/run.mjs --update。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSnapshots } from './ui-snap/run.mjs';

test('频道页与工作台：桌面/手机 × 亮/暗截图回归', { timeout: 180_000 }, async (t) => {
  const result = await runSnapshots();
  if (result.skip) { t.skip(result.skip); return; }
  t.diagnostic(`artifacts: ${result.artifacts}`);
  const detail = result.failures.map((f) => `${f.case}: ${f.message}`).join('\n');
  assert.equal(result.failures.length, 0, detail || '截图回归失败');
});
