import { describe, expect, it } from 'vitest';
import {
  aggregateRoleStatus,
  getBusySessionCount,
  getDeduplicatedSpeech,
  getRoleKey,
  type RoleSessionState,
} from './roleAggregation';
import { calculateFramePosition } from './plugins/dshPetPlugin';

describe('roleAggregation - 角色状态防串与多开会话状态合并规范', () => {
  it('生成唯一 roleKey：同名不同 source 不串', () => {
    // 两个同名 deep 角色，一个来自主桥 (bridge)，一个来自 DSH
    const bridgeDeepKey = getRoleKey({ name: 'deep', source: 'bridge' });
    const dshDeepKey = getRoleKey({ name: 'deep', source: 'dsh' });

    expect(bridgeDeepKey).toBe('bridge:deep');
    expect(dshDeepKey).toBe('dsh:deep');
    expect(bridgeDeepKey).not.toBe(dshDeepKey);

    // 默认 source 为 bridge
    expect(getRoleKey('deep')).toBe('bridge:deep');
    expect(getRoleKey('bridge:deep')).toBe('bridge:deep');
  });

  it('两个角色事件互不影响：按 roleKey 严格隔离', () => {
    const events: Record<string, { type: string; task?: string }> = {};

    const keyDeep = getRoleKey({ name: 'deep', source: 'bridge' });
    const keyGjiang = getRoleKey({ name: 'gjiang', source: 'bridge' });

    // 肥鱼收到 celebrate 事件
    events[keyDeep] = { type: 'celebrate', task: '完成 PR 审核' };
    // 大豆包收到 working 事件
    events[keyGjiang] = { type: 'working', task: '开发桌宠插件' };

    expect(events[keyDeep].type).toBe('celebrate');
    expect(events[keyGjiang].type).toBe('working');

    // 修改大豆包状态不影响肥鱼
    events[keyGjiang] = { type: 'error', task: '编译出错' };
    expect(events[keyDeep].type).toBe('celebrate');
    expect(events[keyGjiang].type).toBe('error');
  });

  it('同一角色多开：两个会话一忙一闲 → 聚合为干活中 (working)', () => {
    const sessions: RoleSessionState[] = [
      {
        sessionId: 'sess-1',
        type: 'idle',
        task: '聊天待命',
        timestamp: '2026-11-08T23:00:00Z',
      },
      {
        sessionId: 'sess-2',
        type: 'working',
        task: '工作区1干活中',
        timestamp: '2026-11-08T23:01:00Z',
      },
    ];

    const aggregated = aggregateRoleStatus(sessions, 'idle');
    expect(aggregated).toBe('working');

    const busyCount = getBusySessionCount(sessions);
    expect(busyCount).toBe(1);
  });

  it('同一角色多开：一个出错一个忙 → 聚合为出错 (error，最高优先级)', () => {
    const sessions: RoleSessionState[] = [
      {
        sessionId: 'sess-1',
        type: 'working',
        task: '跑自动化测试',
        timestamp: '2026-11-08T23:00:00Z',
      },
      {
        sessionId: 'sess-2',
        type: 'error',
        task: '额度耗尽或抛出异常',
        timestamp: '2026-11-08T23:02:00Z',
      },
      {
        sessionId: 'sess-3',
        type: 'celebrate',
        task: '之前交的活',
        timestamp: '2026-11-08T22:50:00Z',
      },
    ];

    const aggregated = aggregateRoleStatus(sessions, 'idle');
    // 出错优先级高于干活与庆祝
    expect(aggregated).toBe('error');
  });

  it('同一角色多开：一干活一庆祝 → 聚合为干活中 (working > celebrate)', () => {
    const sessions: RoleSessionState[] = [
      {
        sessionId: 'sess-1',
        type: 'celebrate',
        task: '任务A完成庆祝',
        timestamp: '2026-11-08T23:00:00Z',
      },
      {
        sessionId: 'sess-2',
        type: 'working',
        task: '任务B正在开发',
        timestamp: '2026-11-08T23:01:00Z',
      },
    ];

    expect(aggregateRoleStatus(sessions, 'idle')).toBe('working');
  });

  it('气泡去重：按时间排序取最新一条，防止多会话刷屏叠词', () => {
    const sessions: RoleSessionState[] = [
      {
        sessionId: 'sess-1',
        type: 'working',
        speechText: '较早的一句话',
        timestamp: '2026-11-08T23:00:00Z',
      },
      {
        sessionId: 'sess-2',
        type: 'working',
        speechText: '最新的核心汇报内容！',
        timestamp: '2026-11-08T23:05:00Z',
      },
    ];

    const speech = getDeduplicatedSpeech(sessions);
    expect(speech).toBe('最新的核心汇报内容！');
  });

  it('精灵图帧位置计算：按列数和帧尺寸精确换算 x, y 偏移', () => {
    // 8 列，640x360
    expect(calculateFramePosition(0, 8, 640, 360)).toEqual({ col: 0, row: 0, x: 0, y: 0 });
    expect(calculateFramePosition(7, 8, 640, 360)).toEqual({ col: 7, row: 0, x: 4480, y: 0 });
    expect(calculateFramePosition(8, 8, 640, 360)).toEqual({ col: 0, row: 1, x: 0, y: 360 });
    expect(calculateFramePosition(15, 8, 640, 360)).toEqual({ col: 7, row: 1, x: 4480, y: 360 });
    expect(calculateFramePosition(16, 8, 640, 360)).toEqual({ col: 0, row: 2, x: 0, y: 720 });
    // 异常列数保护
    expect(calculateFramePosition(5, 0, 640, 360)).toEqual({ col: 0, row: 5, x: 0, y: 1800 });
  });
});
