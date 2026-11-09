/**
 * 睡觉状态机（src/client/pet/card/sleep-machine.ts）的契约测试。
 *
 * 四条契约：进入先 start（once）再 loop（无限播）；循环段被外来动画顶掉后必须重新点名 loop；
 * 醒来播 end 再交回随机链一次；入睡过渡里被叫醒不播 end。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createSleepMachine } from './sleep-machine.ts';
import type { CardHub } from './hub.ts';
import type { SleepState } from '../../../shared/state.ts';

/** 睡着时的叶子：三段名由宿主挑定，状态机只负责按顺序播。 */
const ASLEEP: SleepState = { sleeping: true, start: '睡觉-开始', loop: '睡觉-循环', end: '睡觉-起来' };
/** 醒来的叶子：只有 sleeping 一个字段。 */
const AWAKE: SleepState = { sleeping: false };

/** 造一套只记录换源调用的运行时；本模块用不到的卡片成员按类型断言补空。 */
function harness() {
  const calls: string[] = [];
  let anim = '待机呼吸休闲';
  let once = true;
  const hub = {
    cfg: () => ({ id: 'pet-1' }),
    card: {
      actions: {
        setAnim: (next: string) => {
          anim = next;
          calls.push('anim:' + next);
        },
        setOnce: (next: boolean) => {
          once = next;
          calls.push('once:' + next);
        },
        bumpSeq: () => calls.push('seq'),
      },
    },
    stopMotion: () => calls.push('stopMotion'),
    bubbles: { hideWork: () => calls.push('hideWork') },
  } as unknown as CardHub;
  return { hub, calls, anim: () => anim, once: () => once };
}

/** 造状态机；handedBack 记录交回随机链的次数。 */
function setup(hub: CardHub) {
  let handedBack = 0;
  const sleep = createSleepMachine(
    hub,
    () => {
      handedBack += 1;
    },
    () => {},
  );
  return { sleep, handedBack: () => handedBack };
}

describe('sleep-machine —— 进入与循环', () => {
  test('进入睡觉：停走位后先播 start（只播一次），播完切 loop（循环）', () => {
    const { hub, calls, anim, once } = harness();
    const { sleep } = setup(hub);

    sleep.apply(ASLEEP);

    assert.deepEqual(calls, ['stopMotion', 'hideWork', 'once:true', 'anim:睡觉-开始', 'seq']);
    assert.equal(sleep.sleeping(), true);
    assert.equal(sleep.phase(), 'start');

    assert.equal(sleep.consumeEnded(), true, 'start 播完归状态机处理，不回随机链');
    assert.equal(anim(), '睡觉-循环');
    assert.equal(once(), false, '循环段必须无限播，否则 ended 会落回状态机');
    assert.equal(sleep.phase(), 'loop');
  });

  test('循环段被余额动画顶掉：ended 后重新点名 loop，而不是把余额动画续成死循环', () => {
    const { hub, calls, anim, once } = harness();
    const { sleep } = setup(hub);
    sleep.apply(ASLEEP);
    sleep.consumeEnded();
    // 顶替现场：余额事件直接换源（once=true），睡姿循环被顶掉，那段播完就会 ended。
    hub.card.actions.setAnim('余额-钱袋如常');
    hub.card.actions.setOnce(true);
    calls.length = 0;

    assert.equal(sleep.consumeEnded(), true, 'ended 归状态机处理，不回随机链');

    assert.equal(anim(), '睡觉-循环', '应该重新点名循环段，而不是重播当前前台');
    assert.equal(once(), false, '拉回循环段后要恢复无限播');
  });
});

describe('sleep-machine —— 醒来', () => {
  test('醒来：播 end，播完交回随机链一次并回到醒着', () => {
    const { hub, anim, once } = harness();
    const { sleep, handedBack } = setup(hub);
    sleep.apply(ASLEEP);
    sleep.consumeEnded();

    sleep.apply(AWAKE);

    assert.equal(anim(), '睡觉-起来');
    assert.equal(once(), true, '醒来过渡只播一次');
    assert.equal(sleep.phase(), 'end');

    assert.equal(sleep.consumeEnded(), true);
    assert.equal(handedBack(), 1, 'end 播完应该恰回随机链一次');
    assert.equal(sleep.sleeping(), false);
  });

  test('入睡过渡里被叫醒：不播 end，直接作废这次入睡', () => {
    const { hub, anim } = harness();
    const { sleep, handedBack } = setup(hub);
    sleep.apply(ASLEEP);

    sleep.apply(AWAKE);

    assert.equal(anim(), '睡觉-开始', '没真的睡着过就不该播起来');
    assert.equal(sleep.sleeping(), false);
    assert.equal(sleep.consumeEnded(), false, '不在睡时 ended 交回调用方按常规处理');
    assert.equal(handedBack(), 0);
  });

  test('重复写同一份睡着叶子：不从头再播', () => {
    const { hub, calls } = harness();
    const { sleep } = setup(hub);
    sleep.apply(ASLEEP);
    calls.length = 0;

    sleep.apply(ASLEEP);

    assert.deepEqual(calls, [], '叶子重写一次不该重置播放进度');
  });
});
