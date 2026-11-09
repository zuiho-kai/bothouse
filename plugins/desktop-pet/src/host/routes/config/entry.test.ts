/**
 * POST /pet-config（整条目写回）的契约测试。
 *
 * 四条契约：
 *   1. 只写该种类自己的文件，`main-config.jsonc` 一个字节都不动；
 *   2. 条目级字段（人设、动画池、自定义键）原样保留，不被白名单重建抹掉；
 *   3. 业务失败一律 200 + 失败实体，且 reason 能区分「参数写错」与「种类没装」；
 *   4. 与其它种类重名的实例 id 在写盘前就被拦住——否则读取时会被静默跳过。
 *
 * 用显式 ConfigPaths + 最小依赖桩：被测的只是 handler，不必起服务（那是端到端脚本的事）。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { savePetLayer } from './entry.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import type { RouteResult } from '../../http.ts';

/** 包内内置默认配置：真实文件，`readAllConfig` 的必填基座。 */
const DEFAULT_FILE = fileURLToPath(new URL('../../../../assets/config.jsonc', import.meta.url));

/** 一只合法实例：字段齐全，测试只改需要的那个。 */
const pet = (id: string) => ({
  id,
  name: id,
  size: 300,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 10, marginY: 10 },
});

interface Harness {
  readonly deps: PetRouteDeps;
  readonly userFile: string;
  readonly packFile: string;
  readonly releases: string[];
  readonly restarts: number;
}

let root = '';
let savedHome: string | undefined;

/** 造一套临时配置目录与最小依赖桩。 */
function makeHarness(): Harness {
  const userFile = join(root, 'main-config.jsonc');
  const petDir = join(root, 'pet');
  const packFile = join(petDir, 'glm-config.json');
  const releases: string[] = [];
  let restarts = 0;
  const deps = {
    configPaths: { defaultFile: DEFAULT_FILE, userFile, petDir },
    userConfigPath: userFile,
    userRoot: root,
    petConfigDir: petDir,
    state: { writeSection: () => {} },
    lock: {
      release: ({ petId }: { petId: string }) => {
        releases.push(petId);
      },
    },
    requestRestart: async () => {
      restarts += 1;
    },
  } as unknown as PetRouteDeps;
  return {
    deps,
    userFile,
    packFile,
    releases,
    get restarts() {
      return restarts;
    },
  };
}

/** 造一次请求；`body` 传字符串时原样发送（用于坏 JSON）。 */
const input = (body: unknown, method = 'POST'): RouteInput => ({
  url: new URL('http://localhost/dsh-pet-7340/pet-config'),
  rest: 'pet-config',
  method,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** 取出 JSON 应答的状态码与实体。 */
function jsonOf(res: RouteResult): { status: number; obj: Record<string, unknown> } {
  if (res.kind !== 'json') throw new Error('期望 JSON 应答，实际是 ' + res.kind);
  return { status: res.status, obj: res.obj as Record<string, unknown> };
}

/** 写一个带自定义字段的种类文件。 */
function writePack(file: string): void {
  mkdirSync(join(root, 'pet'), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      whisperPrompt: 'GLM 的人设',
      note: '手写的自定义键',
      pets: [pet('glm1')],
    }),
    'utf8',
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-config-entry-'));
  savedHome = process.env.DSH_HOME;
  // 告警日志落在这个临时 home 下，别污染真实用户目录。
  process.env.DSH_HOME = join(root, 'home');
});

after(() => {
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('savePetLayer —— 整条目写回', () => {
  test('写回成功：只改该种类文件，人设与自定义键保留，main 不动', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    const res = jsonOf(
      await savePetLayer(h.deps, input({ entry: 'glm', pets: [{ ...pet('glm1'), size: 360, display: 'both' }] })),
    );
    assert.equal(res.status, 200);
    const saved = JSON.parse(readFileSync(h.packFile, 'utf8')) as Record<string, unknown>;
    assert.equal((saved.pets as Array<{ size: number }>)[0].size, 360, '实例字段应写回');
    assert.equal(saved.whisperPrompt, 'GLM 的人设', '条目人设不得被白名单重建抹掉');
    assert.equal(saved.note, '手写的自定义键', '非白名单顶层字段应透传保留');
    const main = JSON.parse(readFileSync(h.userFile, 'utf8')) as { pets: Array<{ id: string }> };
    assert.deepEqual(
      main.pets.map((p) => p.id),
      ['main1'],
      'main 层不应被这个端点碰过',
    );
  });

  test('响应体是成品聚合：main 与改动后的种类都在里面', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    const res = jsonOf(await savePetLayer(h.deps, input({ entry: 'glm', pets: [{ ...pet('glm1'), size: 420 }] })));
    const merged = res.obj as { main?: { pets: unknown[] }; glm?: { pets: Array<{ size: number }> } };
    assert.ok(merged.main?.pets.length, '响应必须带 main 条目');
    assert.equal(merged.glm?.pets[0].size, 420, '响应必须反映刚写回的值');
  });

  test('种类没装：unknown-entry；main 条目：bad-request', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    const missing = jsonOf(await savePetLayer(h.deps, input({ entry: 'nope', pets: [pet('x1')] })));
    assert.equal(missing.obj.reason, 'unknown-entry');
    const main = jsonOf(await savePetLayer(h.deps, input({ entry: 'main', pets: [pet('main1')] })));
    assert.equal(main.obj.reason, 'bad-request', 'main 层要带全局字段，必须走 PUT /config');
  });

  test('参数非法：缺 entry / 空 pets / 非法 entry 都是 bad-request', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    for (const body of [{}, { entry: 'glm' }, { entry: 'glm', pets: [] }, { entry: '../x', pets: [pet('a1')] }]) {
      const res = jsonOf(await savePetLayer(h.deps, input(body)));
      assert.equal(res.obj.reason, 'bad-request', JSON.stringify(body) + ' 应被拒绝');
    }
  });

  test('跨条目 id 冲突：写盘前就拦住，文件保持原样', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    const before = readFileSync(h.packFile, 'utf8');
    const res = jsonOf(await savePetLayer(h.deps, input({ entry: 'glm', pets: [pet('main1')] })));
    assert.equal(res.obj.reason, 'bad-request');
    assert.match(String(res.obj.message), /main1/, '文案要指出冲突的 id');
    assert.equal(readFileSync(h.packFile, 'utf8'), before, '冲突时不得写盘');
  });

  test('协议层失败保留真实状态码：非 POST 405、坏 JSON 400', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    const wrongMethod = jsonOf(await savePetLayer(h.deps, input({}, 'GET')));
    assert.equal(wrongMethod.status, 405);
    const badJson = jsonOf(await savePetLayer(h.deps, input('{')));
    assert.equal(badJson.status, 400);
    assert.equal(badJson.obj.reason, 'invalid-json');
  });

  test('改成 none 的实例会撤销占用锁（与 /pet-display 同口径）', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    await savePetLayer(h.deps, input({ entry: 'glm', pets: [{ ...pet('glm1'), display: 'none' }] }));
    assert.deepEqual(h.releases, ['glm1']);
  });
});
