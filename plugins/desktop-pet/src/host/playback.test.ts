/**
 * 播放回执（`/dsh-pet-7340/playback/...`）的纯逻辑层单测。
 *
 * 契约核心三条，必须钉死：
 *   ① 终态不可再变——迟到的 ended 不许覆盖 cancelled。渲染端的上报是异步的：
 *      被打断的那一场很可能在上报途中又收到一个 ended，顺序无法保证。
 *   ② 上报幂等——同状态重复上报、终态之后的上报都回 ignored，不改记录。
 *   ③ 等待者不泄漏——超时、主动取消、记录被清理、插件卸载四条路径都必须收尾。
 *      挂起的 HTTP 响应没有第二条收尾途径，漏一条就是永远不结束的请求。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 * 时间：sweep 用注入的 now 控制（不 mock Date）；等待超时用 mock timers 控制 setTimeout。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlaybackStatus,
  isReportableStatus,
  isTerminalStatus,
  MAX_PLAYBACK_WAIT_MS,
  parsePlaybackPath,
  parseWaitQuery,
  PLAYBACK_KEEP_MS,
  PlaybackStore,
  type PlaybackRecord,
} from './playback.ts';

/** 收集一次等待的结论（同一等待者被唤醒两次就是 bug，下面的断言会直接看出来） */
function collector(): {
  seen: Array<{ status: string; matched: boolean }>;
  onWake: (r: PlaybackRecord, m: boolean) => void;
} {
  const seen: Array<{ status: string; matched: boolean }> = [];
  return {
    seen,
    onWake: (r, matched) => seen.push({ status: r.status, matched }),
  };
}

describe('playback —— 状态判定辅助', () => {
  test('终态只有 ended / failed / cancelled', () => {
    assert.equal(isTerminalStatus('ended'), true);
    assert.equal(isTerminalStatus('failed'), true);
    assert.equal(isTerminalStatus('cancelled'), true);
    assert.equal(isTerminalStatus('accepted'), false);
    assert.equal(isTerminalStatus('playing'), false);
    assert.equal(isTerminalStatus('随便写的'), false);
  });

  test('合法状态名含 accepted，但 accepted 不允许渲染端上报', () => {
    assert.equal(isPlaybackStatus('accepted'), true);
    assert.equal(isPlaybackStatus('playing'), true);
    assert.equal(isPlaybackStatus('finished'), false);
    assert.equal(isReportableStatus('accepted'), false, 'accepted 是 host 的受理态，渲染端不许写');
    assert.equal(isReportableStatus('playing'), true);
    assert.equal(isReportableStatus('cancelled'), true);
  });
});

describe('playback —— 路径与查询参数解析（纯函数，路由只做胶水）', () => {
  test('parsePlaybackPath：只认两种形状，正则两端锚定', () => {
    assert.deepEqual(parsePlaybackPath('playback/pb-x'), { playbackId: 'pb-x', isReport: false });
    assert.deepEqual(parsePlaybackPath('playback/pb-x/report'), { playbackId: 'pb-x', isReport: true });
    // 其余形状一律不认——交给下游 thumb/font/pic 分支按各自口径报错，绝不"尽力猜一个 id"
    for (const bad of [
      'playback',
      'playback/',
      'playback/a/b',
      'playback/a/report/extra',
      'playbackx/a',
      'playbacks/a',
      'anim',
      'state',
      '',
    ]) {
      assert.equal(parsePlaybackPath(bad), undefined, `${bad} 不该被 /playback 认领`);
    }
  });

  test('parseWaitQuery：wait 与 timeout 成对必填', () => {
    assert.deepEqual(parseWaitQuery(null, null), { kind: 'none' });
    const onlyWait = parseWaitQuery('ended', null);
    assert.equal(onlyWait.kind, 'error', '只填 wait 会无限挂住，必须拒');
    assert.match(onlyWait.kind === 'error' ? onlyWait.error : '', /together/);
    assert.equal(parseWaitQuery(null, '1000').kind, 'error', '只填 timeout 等于没说要等什么');
  });

  test('parseWaitQuery：wait 支持逗号列表（终态有三个）', () => {
    assert.deepEqual(parseWaitQuery('ended', '1000'), { kind: 'ok', wait: ['ended'], timeoutMs: 1000 });
    assert.deepEqual(parseWaitQuery('ended,failed,cancelled', '1000'), {
      kind: 'ok',
      wait: ['ended', 'failed', 'cancelled'],
      timeoutMs: 1000,
    });
    // 空白与多余逗号容忍（空项被丢掉，不影响其余）
    assert.deepEqual(parseWaitQuery(' ended , failed ,', '1000'), {
      kind: 'ok',
      wait: ['ended', 'failed'],
      timeoutMs: 1000,
    });
  });

  test('parseWaitQuery：非法状态名明确拒绝，不静默忽略', () => {
    const bad = parseWaitQuery('finished', '1000');
    assert.equal(bad.kind, 'error');
    assert.match(bad.kind === 'error' ? bad.error : '', /finished/);
    assert.equal(parseWaitQuery('ended,fake', '1000').kind, 'error', '混了非法名就整体拒绝');
    assert.equal(parseWaitQuery('', '1000').kind, 'error', '空 wait 等于没说要等什么');
    assert.equal(parseWaitQuery(' , ', '1000').kind, 'error');
  });

  test('parseWaitQuery：timeout 只接受 0..上限的整数', () => {
    assert.deepEqual(parseWaitQuery('ended', '0'), { kind: 'ok', wait: ['ended'], timeoutMs: 0 });
    assert.equal(parseWaitQuery('ended', String(MAX_PLAYBACK_WAIT_MS)).kind, 'ok');
    for (const bad of ['-1', '1.5', 'abc', '', ' ', '1e3', '+5', String(MAX_PLAYBACK_WAIT_MS + 1)]) {
      assert.equal(parseWaitQuery('ended', bad).kind, 'error', `timeout=${bad} 应被拒`);
    }
  });
});

describe('playback —— 受理与编号', () => {
  test('create 返回 accepted 记录，字段齐备', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', '拉侧栏-拉拽');
    assert.equal(rec.petId, 'main');
    assert.equal(rec.name, '拉侧栏-拉拽');
    assert.equal(rec.status, 'accepted');
    assert.ok(rec.playbackId.length > 0);
    assert.equal(typeof rec.createdAt, 'number');
    assert.equal(rec.createdAt, rec.updatedAt);
    assert.equal(store.get(rec.playbackId), rec);
  });

  test('编号在运行内唯一（连开多次不重复）', () => {
    const store = new PlaybackStore();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(store.create('pet-' + i, 'A').playbackId);
    assert.equal(ids.size, 50);
  });

  test('查不到的编号返回 undefined（路由据此回 404）', () => {
    const store = new PlaybackStore();
    assert.equal(store.get('pb-nope'), undefined);
  });
});

describe('playback —— 状态机与上报', () => {
  test('accepted → playing → ended 逐步推进', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ok');
    assert.equal(store.get(rec.playbackId)?.status, 'playing');
    assert.equal(store.report(rec.playbackId, 'ended'), 'ok');
    const done = store.get(rec.playbackId);
    assert.equal(done?.status, 'ended');
    assert.equal(typeof done?.endedAt, 'number', 'ended 必须带 endedAt');
  });

  test('failed 带 reason', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report(rec.playbackId, 'failed', 'asset-not-found'), 'ok');
    const hit = store.get(rec.playbackId);
    assert.equal(hit?.status, 'failed');
    assert.equal(hit?.reason, 'asset-not-found');
    assert.equal(hit?.endedAt, undefined, 'endedAt 只属于 ended');
  });

  test('**终态不可再变**：ended 之后的 playing 被忽略', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    store.report(rec.playbackId, 'ended');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ignored');
    assert.equal(store.get(rec.playbackId)?.status, 'ended', '迟到的上报不许把终态改回去');
  });

  test('**终态不可再变**：cancelled 之后的 ended 被忽略（被打断的那一场）', () => {
    const store = new PlaybackStore();
    const first = store.create('main', 'A');
    store.create('main', 'B'); // 顶掉第一场 → cancelled/superseded
    assert.equal(store.get(first.playbackId)?.status, 'cancelled');
    assert.equal(store.report(first.playbackId, 'ended'), 'ignored');
    assert.equal(store.get(first.playbackId)?.status, 'cancelled');
    assert.equal(store.get(first.playbackId)?.reason, 'superseded');
  });

  test('幂等：同状态重复上报被忽略', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ok');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ignored');
    assert.equal(store.get(rec.playbackId)?.status, 'playing');
  });

  test('未知编号 → unknown；非法状态名 → invalid', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report('pb-nope', 'playing'), 'unknown');
    assert.equal(store.report(rec.playbackId, 'finished'), 'invalid');
    assert.equal(store.report(rec.playbackId, 'accepted'), 'invalid', '渲染端不许写受理态');
    assert.equal(store.report(rec.playbackId, ''), 'invalid');
    assert.equal(store.report(rec.playbackId, undefined), 'invalid');
    assert.equal(store.report(rec.playbackId, 42), 'invalid');
    assert.equal(store.get(rec.playbackId)?.status, 'accepted', '非法上报不得改动记录');
  });
});

describe('playback —— 新点播顶掉旧场（pets.<id>.anim 是单叶子）', () => {
  test('同一只宠物的新点播把上一场标为 cancelled/superseded', () => {
    const store = new PlaybackStore();
    const first = store.create('main', 'A');
    const second = store.create('main', 'B');
    assert.equal(store.get(first.playbackId)?.status, 'cancelled');
    assert.equal(store.get(first.playbackId)?.reason, 'superseded');
    assert.equal(store.get(second.playbackId)?.status, 'accepted');
  });

  test('不同宠物互不影响', () => {
    const store = new PlaybackStore();
    const a = store.create('main', 'A');
    const b = store.create('other', 'B');
    assert.equal(store.get(a.playbackId)?.status, 'accepted');
    assert.equal(store.get(b.playbackId)?.status, 'accepted');
  });

  test('已终态的那一场不会被后续点播再标记', () => {
    const store = new PlaybackStore();
    const first = store.create('main', 'A');
    store.report(first.playbackId, 'ended');
    store.create('main', 'B');
    const hit = store.get(first.playbackId);
    assert.equal(hit?.status, 'ended', '正常播完的不能被改写成 cancelled');
    assert.equal(hit?.reason, undefined);
  });
});

describe('playback —— 等待者：唤醒与超时', () => {
  test('状态进入 wait 集合 → 立刻唤醒（matched=true）并摘掉等待者', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    const cancel = store.wait({
      playbackId: rec.playbackId,
      wait: ['playing', 'ended'],
      timeoutMs: 10_000,
      onWake: c.onWake,
    });
    assert.ok(cancel, '编号存在 → 应当注册成功');
    assert.equal(store.waiterCount(), 1);
    store.report(rec.playbackId, 'playing');
    assert.deepEqual(c.seen, [{ status: 'playing', matched: true }]);
    assert.equal(store.waiterCount(), 0, '唤醒后必须摘掉（否则定时器与引用都留着）');
  });

  test('不在 wait 集合里的状态变化不唤醒', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 10_000, onWake: c.onWake });
    store.report(rec.playbackId, 'playing');
    assert.deepEqual(c.seen, [], '只等 ended，playing 不该唤醒');
    assert.equal(store.waiterCount(), 1, '没等到就继续挂着');
    store.report(rec.playbackId, 'ended');
    assert.deepEqual(c.seen, [{ status: 'ended', matched: true }]);
  });

  test('wait 支持逗号列表语义：任一命中即回（终态有三个）', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({
      playbackId: rec.playbackId,
      wait: ['ended', 'failed', 'cancelled'],
      timeoutMs: 10_000,
      onWake: c.onWake,
    });
    store.report(rec.playbackId, 'failed', 'decode-error');
    assert.deepEqual(c.seen, [{ status: 'failed', matched: true }], '失败也是终态，不能白等一整个 timeout');
  });

  test('超时 → matched=false，回当时的状态', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 500, onWake: c.onWake });
    store.report(rec.playbackId, 'playing');
    t.mock.timers.tick(499);
    assert.deepEqual(c.seen, [], '未到点不唤醒');
    t.mock.timers.tick(1);
    assert.deepEqual(c.seen, [{ status: 'playing', matched: false }]);
    assert.equal(store.waiterCount(), 0, '超时后必须摘掉');
  });

  test('timeout=0 → 下一拍立刻唤醒（等价"立刻返回"）', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 0, onWake: c.onWake });
    assert.deepEqual(c.seen, [], '注册时不同步唤醒（避免在 Promise 构造里重入）');
    t.mock.timers.tick(1);
    assert.deepEqual(c.seen, [{ status: 'accepted', matched: false }]);
  });

  test('未知编号 → 返回 undefined（路由据此立刻 404，不挂）', () => {
    const store = new PlaybackStore();
    const c = collector();
    assert.equal(store.wait({ playbackId: 'pb-nope', wait: ['ended'], timeoutMs: 1000, onWake: c.onWake }), undefined);
    assert.equal(store.waiterCount(), 0);
  });

  test('主动取消 → 不再唤醒，也不留定时器', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    const cancel = store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 5000, onWake: c.onWake });
    assert.ok(cancel);
    cancel();
    assert.equal(store.waiterCount(), 0);
    store.report(rec.playbackId, 'ended');
    assert.deepEqual(c.seen, [], '取消后状态变化不该再唤醒');
    t.mock.timers.tick(5000);
    assert.deepEqual(c.seen, [], '取消后定时器也不该再唤醒');
  });

  test('同一场多个等待者一起被唤醒', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const a = collector();
    const b = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 5000, onWake: a.onWake });
    store.wait({ playbackId: rec.playbackId, wait: ['ended', 'failed'], timeoutMs: 5000, onWake: b.onWake });
    assert.equal(store.waiterCount(), 2);
    store.report(rec.playbackId, 'ended');
    assert.deepEqual(a.seen, [{ status: 'ended', matched: true }]);
    assert.deepEqual(b.seen, [{ status: 'ended', matched: true }]);
    assert.equal(store.waiterCount(), 0);
  });

  test('等待不影响记录本身，也不因等待而阻塞其它写入', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 5000, onWake: c.onWake });
    assert.equal(store.report(rec.playbackId, 'playing'), 'ok', '有人在等不妨碍上报');
    assert.equal(store.count(), 1);
  });
});

describe('playback —— 清理（保留窗口与四条收尾路径）', () => {
  test('终态记录超过保留窗口后被清理；非终态不受影响', () => {
    const store = new PlaybackStore();
    const done = store.create('main', 'A');
    store.report(done.playbackId, 'ended');
    const live = store.create('other', 'B'); // 另一只宠物：不会被顶掉，也不是终态
    assert.equal(store.count(), 2);
    store.sweep(done.updatedAt + PLAYBACK_KEEP_MS - 1);
    assert.equal(store.count(), 2, '未到点：都不清');
    store.sweep(done.updatedAt + PLAYBACK_KEEP_MS);
    assert.equal(store.get(done.playbackId), undefined, '到点：终态记录被清（之后查询回 404）');
    assert.ok(store.get(live.playbackId), '非终态记录永远不因保留窗口被清');
  });

  test('记录在等待期间被清理 → 等待者被唤醒（matched=false），不留悬挂', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    store.report(rec.playbackId, 'ended');
    const c = collector();
    // 故意等一个已经不可能再来的状态，并把超时设得长于保留窗口——
    // 这正是"在保留窗口末尾注册"的形态：只有 sweep 能收尾它。
    const cancel = store.wait({
      playbackId: rec.playbackId,
      wait: ['playing'],
      timeoutMs: PLAYBACK_KEEP_MS * 2,
      onWake: c.onWake,
    });
    assert.ok(cancel);
    assert.equal(store.waiterCount(), 1);
    store.sweep(rec.updatedAt + PLAYBACK_KEEP_MS);
    assert.deepEqual(c.seen, [{ status: 'ended', matched: false }], '清理前必须先叫醒等待者');
    assert.equal(store.waiterCount(), 0, '不能留下永远等不到的悬挂等待者');
    assert.equal(store.count(), 0);
  });

  test('cancelAll（插件卸载路径）→ 全部唤醒并清空', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const a = store.create('main', 'A');
    const b = store.create('other', 'B');
    const ca = collector();
    const cb = collector();
    store.wait({ playbackId: a.playbackId, wait: ['ended'], timeoutMs: 10_000, onWake: ca.onWake });
    store.wait({ playbackId: b.playbackId, wait: ['ended'], timeoutMs: 10_000, onWake: cb.onWake });
    assert.equal(store.waiterCount(), 2);
    store.cancelAll();
    assert.deepEqual(ca.seen, [{ status: 'accepted', matched: false }]);
    assert.deepEqual(cb.seen, [{ status: 'accepted', matched: false }]);
    assert.equal(store.waiterCount(), 0);
    // 卸载后不该再被后续上报唤醒
    store.report(a.playbackId, 'ended');
    assert.deepEqual(ca.seen, [{ status: 'accepted', matched: false }]);
  });

  test('cancelAll 之后定时器不再重复唤醒', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 3000, onWake: c.onWake });
    store.cancelAll();
    t.mock.timers.tick(3000);
    assert.equal(c.seen.length, 1, '超时定时器必须已被清掉，不能再唤醒一次');
  });
});
