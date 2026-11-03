// Issue #876 E 路：团队工作台端到端驱动的入口测试。
//
// 这是个「有环境才跑」的重测试：它要真起插件、真跑 board.py。CI 里没有 DSH 运行时，
// 也没有 A 路之前的事件写入，所以缺条件时整条跳过并说明缺什么，不让无关环境变红。
// 本机要跑完整版（含截图录屏）用：node dsh/collab/desk-e2e/run.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshRequireBase } from './desk-e2e/host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD_PY = join(HERE, '../../bridge/contrib/gate/board.py');
const RUN = join(HERE, 'desk-e2e/run.mjs');

/** 缺什么就返回什么；都能满足返回 undefined。 */
export function skipReason() {
  try {
    resolveDshRequireBase();
  } catch {
    return '没有 DSH 运行时（resolve 不到 ws / @deepseek-ai/dsh-llm），这套 e2e 只在装了 DSH 的机器上跑';
  }
  try {
    const source = readFileSync(BOARD_PY, 'utf8');
    if (!source.includes('board-events.jsonl')) return '任务板还没有事件写入（A 路未合入）';
  } catch {
    return `读不到任务板实现：${BOARD_PY}`;
  }
  // 插件自身要能 import（collab 依赖装过）。缺依赖时直接跳过，避免把环境问题算成失败。
  try {
    execFileSync('node', ['--input-type=module', '-e', "await import('@agentclientprotocol/sdk')"], { cwd: HERE, stdio: 'ignore' });
  } catch {
    return 'collab 依赖没装（cd dsh/collab && pnpm install --frozen-lockfile）';
  }
  return undefined;
}

const reason = skipReason();

test('desk-e2e：真实 board 事件 → 插件转发 → 桌面页可访问', { skip: reason }, () => {
  const run = spawnSync(process.execPath, [RUN], { encoding: 'utf8', timeout: 180_000 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  assert.equal(run.status, 0, `e2e 有失败项：\n${output}`);
  assert.match(output, /PASS\t事件落盘/);
  assert.match(output, /PASS\t插件启动/);
});