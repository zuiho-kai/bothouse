/**
 * 睡觉闸门（src/host/plugin/pet-lookup.ts 的 sleepBlocked）的契约测试。
 *
 * 钉住三件事：在睡时拒绝并写一句拒绝台词；持锁时让路；醒着时放行。
 * 闸门是「拒绝用户手动触发」的唯一实现，改坏它等于睡觉拦不住任何请求。
 * 跑法：node --experimental-strip-types --test src/host/plugin/pet-lookup.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createPetLookup } from './pet-lookup.ts';
import type { ConfigPaths } from '../config.ts';
import { PollStateStore } from '../state.ts';

/** 建一套临时配置：一只可见宠物 + 一句拒绝台词。 */
function harness(): { lookup: ReturnType<typeof createPetLookup>; state: PollStateStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sleep-gate-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(
    paths.defaultFile,
    JSON.stringify({
      pets: [{ id: 'p', name: 'P', display: 'web' }],
      animations: {
        idle: ['i'],
        turn: [],
        drag: [],
        clicks: [],
        moves: { default: {}, actions: [] },
        categories: [],
        events: { balance: ['b'] },
      },
      sleepRefuseTexts: ['我在睡觉'],
    }),
  );
  const state = new PollStateStore();
  const lookup = createPetLookup({ state, configPaths: paths });
  return { lookup, state, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 取失败实体的 reason（RouteResult 的 json 形态把实体放在 obj 里）。 */
function reasonOf(res: { kind: string; obj?: unknown } | null): string {
  assert.ok(res && res.kind === 'json', '应当返回失败实体');
  return String((res.obj as { reason?: unknown }).reason);
}

describe('sleepBlocked —— 睡觉闸门', () => {
  test('在睡：拒绝并写一句拒绝台词（只弹气泡、不换动画）', () => {
    const { lookup, state, cleanup } = harness();
    try {
      lookup.sleep.enter('p', { start: 's', loop: 'l', end: 'e' });
      assert.equal(reasonOf(lookup.sleepBlocked('p')), 'sleeping');
      const say = state.read().pets.p.say.data as { text?: string; anim?: boolean };
      assert.equal(say.text, '我在睡觉');
      assert.equal(say.anim, false, '拒绝台词不得联动动画');
    } finally {
      cleanup();
    }
  });

  test('醒着：放行（回 null）', () => {
    const { lookup, cleanup } = harness();
    try {
      assert.equal(lookup.sleepBlocked('p'), null);
    } finally {
      cleanup();
    }
  });

  test('持锁：让路（锁的语义就是把控制权交给第三方）', () => {
    const { lookup, cleanup } = harness();
    try {
      lookup.sleep.enter('p', { start: 's', loop: 'l', end: 'e' });
      lookup.lock.acquire({ petId: 'p' });
      assert.equal(lookup.sleepBlocked('p'), null);
    } finally {
      cleanup();
    }
  });
});
