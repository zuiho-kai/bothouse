/**
 * 自播动画决策（src/client/pet/animation/next-animation.ts）的契约测试。
 *
 * 三条契约：
 *   1. idle / turn 只从各自池里抽，并避开当前正在播的那一段；
 *   2. move 档：占用中不重播（返回 null），走位成功就把动作名用于日志，无法移动才退回原地分类动作；
 *   3. 宠物固定（fixed）时不会走到 turn / move——决策层不重复判断，靠调用方传对的类别。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideNextAnimation } from './next-animation.ts';
import type { Animations } from '../../../shared/types.ts';

const animations = {
  idle: ['idle1', 'idle2'],
  turn: ['turn1'],
  drag: [],
  clicks: [],
  moves: { default: {}, actions: [] },
  categories: [{ id: 'wave', weight: 1, actions: ['wave1'] }],
  events: {},
} as unknown as Animations;

const base = { animations, facing: 'left' as const, current: 'idle2' };

describe('decideNextAnimation —— 自播动画决策', () => {
  test('idle：从 idle 池抽，避开当前动画', () => {
    const decision = decideNextAnimation({ ...base, kind: 'idle' });
    assert.equal(decision.kind, 'IDLE');
    assert.equal(decision.anim, 'idle1', '当前是 idle2，应抽到另一个');
    assert.equal(decision.play, true, 'idle 要真的切动画');
  });

  test('idle 池只有一段时宁可重复也不返回 null', () => {
    const single = { ...animations, idle: ['only'] } as unknown as Animations;
    const decision = decideNextAnimation({ ...base, animations: single, current: 'only', kind: 'idle' });
    assert.equal(decision.anim, 'only');
  });

  test('turn：从 turn 池抽', () => {
    const decision = decideNextAnimation({ ...base, kind: 'turn' });
    assert.equal(decision.kind, 'TURN');
    assert.equal(decision.anim, 'turn1');
    assert.equal(decision.play, true);
  });

  test('move 占用中：返回 null（别切动画，切了会打断走位）', () => {
    const decision = decideNextAnimation({ ...base, kind: 'move', move: true });
    assert.deepEqual(decision, { kind: 'MOVES', anim: null, play: false });
  });

  test('move 成功：类别 MOVES，动作名带上（只用于日志，不重复切换）', () => {
    const decision = decideNextAnimation({ ...base, kind: 'move', move: 'walk2' });
    assert.deepEqual(decision, { kind: 'MOVES', anim: 'walk2', play: false });
  });

  test('move 失败：退回原地分类动作，类别用分类 id', () => {
    const decision = decideNextAnimation({ ...base, kind: 'move', move: false });
    assert.deepEqual(decision, { kind: 'wave', anim: 'wave1', play: true });
  });

  test('action 档：分类动作；无分类时回落 idle 池', () => {
    const decision = decideNextAnimation({ ...base, kind: 'action' });
    assert.deepEqual(decision, { kind: 'wave', anim: 'wave1', play: true });

    const noCategories = { ...animations, categories: [] } as unknown as Animations;
    const fallback = decideNextAnimation({ ...base, animations: noCategories, kind: 'action' });
    assert.equal(fallback.kind, 'FALLBACK');
    assert.equal(fallback.anim, 'idle1');
  });
});
