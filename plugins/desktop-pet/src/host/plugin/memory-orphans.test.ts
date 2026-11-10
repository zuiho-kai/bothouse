/**
 * 孤儿历史（已删宠物残留分桶）的判定与清理。
 *
 * 配置走真实文件（仓库内的 assets/config.jsonc），记忆文件用内存替身——
 * 这样既能验证「配置里有/没有」的判定，又不需要真的写盘。
 *
 * 跑法：node --experimental-strip-types --test src/host/plugin/memory-orphans.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createMemoryOrphans } from './memory-orphans.ts';
import type { ConfigPaths } from '../config.ts';

type Messages = { role: 'user' | 'assistant'; content: string; ts: number }[];
type MemoryFile = Record<string, Record<string, { messages: Messages }>>;

/** 临时工作区：默认配置指回仓库，用户层为空。 */
function tempConfig(): { configPaths: ConfigPaths; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-orphans-test-'));
  const configPaths: ConfigPaths = {
    defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(configPaths.userFile, '{}');
  return { configPaths, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 造一份带记忆替身的孤儿模块：读写都落在同一个对象上。 */
function makeOrphans(initial: MemoryFile) {
  const config = tempConfig();
  const mem = structuredClone(initial);
  const orphans = createMemoryOrphans({
    configPaths: config.configPaths,
    readMemory: async () => mem,
    writeMemory: async (next) => {
      // next 与 mem 是同一个对象（被测代码原地修改后写回）：先克隆再清空，否则会把自己抹掉
      const copy = structuredClone(next);
      for (const key of Object.keys(mem)) delete mem[key];
      Object.assign(mem, copy);
    },
    withLock: async (fn) => fn(),
    log: { info: () => {} },
  });
  return { orphans, mem, clean: config.clean };
}

describe('createMemoryOrphans —— 已删宠物的残留历史', () => {
  test('配置里已没有的宠物 → 列出来（条数 + 最后时间）', async () => {
    const suite = makeOrphans({
      main: {
        main: { messages: [{ role: 'user', content: '在吗', ts: 1 }] },
        gone: {
          messages: [
            { role: 'user', content: '旧问题', ts: 1000 },
            { role: 'assistant', content: '旧回答', ts: 1000 },
          ],
        },
      },
    });
    try {
      const list = await suite.orphans.orphanHistory();
      assert.deepEqual(list, [{ entry: 'main', petId: 'gone', messages: 2, lastTs: 1000 }]);
    } finally {
      suite.clean();
    }
  });

  test('全部宠物都还在 → 空列表（不误报）', async () => {
    const suite = makeOrphans({ main: { main: { messages: [] } } });
    try {
      assert.deepEqual(await suite.orphans.orphanHistory(), []);
    } finally {
      suite.clean();
    }
  });

  test('清理只删孤儿：现有宠物原样保留，空条目一并摘掉', async () => {
    const suite = makeOrphans({
      main: {
        main: { messages: [{ role: 'user', content: '留着', ts: 1 }] },
        gone: { messages: [{ role: 'user', content: '删掉', ts: 2 }] },
      },
      empty: { ghost: { messages: [{ role: 'user', content: '删掉', ts: 3 }] } },
    });
    try {
      const result = await suite.orphans.deleteOrphans();
      assert.deepEqual(result, { ok: true, pets: 2, messages: 2 });
      assert.deepEqual(Object.keys(suite.mem), ['main'], '空条目应被摘掉');
      assert.deepEqual(Object.keys(suite.mem.main ?? {}), ['main'], '现有宠物不能被误删');
    } finally {
      suite.clean();
    }
  });

  test('没有孤儿 → 不写文件，计数全 0', async () => {
    let writes = 0;
    const config = tempConfig();
    const orphans = createMemoryOrphans({
      configPaths: config.configPaths,
      readMemory: async () => ({ main: { main: { messages: [] } } }),
      writeMemory: async () => {
        writes += 1;
      },
      withLock: async (fn) => fn(),
      log: { info: () => {} },
    });
    try {
      assert.deepEqual(await orphans.deleteOrphans(), { ok: true, pets: 0, messages: 0 });
      assert.equal(writes, 0, '没有可删的东西时不该重写记忆文件');
    } finally {
      config.clean();
    }
  });
});
