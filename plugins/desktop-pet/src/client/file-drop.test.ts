/**
 * 拖拽认领的单测：谁接这次 drop、拦不拦默认行为、要不要阻断冒泡与替宿主收尾。
 *
 * 为什么值得钉：桌宠与 DSH 在同一棵 DOM 树上都收 drop，少一次阻断就表现为"同一张图进了两个地方"，
 * 而多拦一次会让 DSH 自己的拖拽处理完全失灵——两种错都不会报错。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimFileDragEnter,
  claimFileDragOver,
  claimFileDrop,
  DROP_TARGET_CLASS,
  markDropTarget,
  unmarkDropTarget,
} from './file-drop.ts';
import type { DragLike, DropTargetLike } from './file-drop.ts';

/** 只造判定用到的两个字段：实现不读 File 的其它成员。 */
const file = (type: string, name: string): File => ({ type, name }) as File;

/** 记下事件被拦了几次，用来断言"碰没碰事件"。 */
interface Recorder {
  readonly event: DragLike;
  readonly calls: { prevent: number; stop: number };
}

/** 造一次拖拽：文件列表决定内容，hasFiles 决定它算不算文件拖拽。 */
function dragOf(files: readonly File[], hasFiles = true): Recorder {
  const calls = { prevent: 0, stop: 0 };
  return {
    event: {
      dataTransfer: { files, types: hasFiles ? ['Files'] : ['text/plain'] } as unknown as DataTransfer,
      preventDefault: () => {
        calls.prevent += 1;
      },
      stopPropagation: () => {
        calls.stop += 1;
      },
    },
    calls,
  };
}

/** 造一个只用于收尾事件的假 window，跑完就拆掉，免得影响其它用例。 */
function withFakeWindow(run: (events: string[]) => void): void {
  const events: string[] = [];
  const globals = globalThis as { window?: unknown };
  globals.window = {
    dispatchEvent: (event: Event): boolean => {
      events.push(event.type);
      return true;
    },
  };
  try {
    run(events);
  } finally {
    delete globals.window;
  }
}

describe('claimFileDragEnter', () => {
  test('带文件进入落点：阻断冒泡并收起宿主遮罩', () => {
    withFakeWindow((events) => {
      const { event, calls } = dragOf([file('image/png', 'a.png')]);
      assert.equal(claimFileDragEnter(event), true, '带文件应该认领');
      assert.deepEqual(calls, { prevent: 0, stop: 1 }, '只断冒泡，默认行为留给 dragover 处理');
      assert.deepEqual(events, ['dragend'], '应该替宿主收起整页遮罩');
    });
  });

  test('纯文本拖拽进入落点：不认领，不动事件也不动遮罩', () => {
    withFakeWindow((events) => {
      const { event, calls } = dragOf([], false);
      assert.equal(claimFileDragEnter(event), false, '不是文件拖拽不该认领');
      assert.deepEqual(calls, { prevent: 0, stop: 0 }, '不认领就不能动事件');
      assert.deepEqual(events, [], '不认领就不该碰宿主的遮罩');
    });
  });
});

describe('claimFileDragOver', () => {
  test('带文件的拖拽经过：认领并同时拦默认行为与冒泡', () => {
    const { event, calls } = dragOf([file('image/png', 'a.png')]);
    assert.equal(claimFileDragOver(event), true, '带文件应该认领');
    assert.deepEqual(calls, { prevent: 1, stop: 1 }, '认领时必须两种都拦');
  });

  test('纯文本拖拽经过：不认领，也不碰事件', () => {
    const { event, calls } = dragOf([], false);
    assert.equal(claimFileDragOver(event), false, '不是文件拖拽不该认领');
    assert.deepEqual(calls, { prevent: 0, stop: 0 }, '不认领就不能动事件');
  });
});

describe('claimFileDrop', () => {
  test('落在界面上的图片：返回该图并截断事件', () => {
    const image = file('image/png', 'a.png');
    const { event, calls } = dragOf([image]);
    assert.equal(claimFileDrop(event), image, '应该交回拖进来的那张图');
    assert.deepEqual(calls, { prevent: 1, stop: 1 }, '认领时必须两种都拦');
  });

  test('多个文件：跳过非图片，取第一张图', () => {
    const image = file('image/webp', 'b.webp');
    const { event } = dragOf([file('text/plain', 'a.txt'), image]);
    assert.equal(claimFileDrop(event), image, '应该跳过前面的文本文件');
  });

  test('只有非图片文件：吞下事件但不当成图', () => {
    const { event, calls } = dragOf([file('application/pdf', 'a.pdf')]);
    assert.equal(claimFileDrop(event), undefined, '认不出图片应当返回 undefined');
    assert.deepEqual(calls, { prevent: 1, stop: 1 }, '仍是文件拖放，必须拦住，别让页面被替换');
  });

  test('没有文件拖拽：不碰事件', () => {
    const { event, calls } = dragOf([], false);
    assert.equal(claimFileDrop(event), undefined);
    assert.deepEqual(calls, { prevent: 0, stop: 0 }, '不属于自己的拖放要原样放行');
  });

  test('认领后替宿主补一次 dragend：遮罩才不会一直挂着', () => {
    withFakeWindow((events) => {
      const { event } = dragOf([file('image/png', 'a.png')]);
      claimFileDrop(event);
      assert.deepEqual(events, ['dragend'], '应该向 window 派发且只派发一次 dragend');
    });
  });

  test('不是文件拖放：不碰宿主的遮罩状态', () => {
    withFakeWindow((events) => {
      const { event } = dragOf([], false);
      claimFileDrop(event);
      assert.deepEqual(events, [], '不属于自己的拖放不该派发 dragend');
    });
  });
});

/** 最小 DOM 替身：只实现高亮用到的 classList 与 contains。 */
class FakeElement {
  readonly classes = new Set<string>();
  readonly children: FakeElement[] = [];
  readonly classList = {
    add: (one: string): void => {
      this.classes.add(one);
    },
    remove: (one: string): void => {
      this.classes.delete(one);
    },
    contains: (one: string): boolean => this.classes.has(one),
  };

  contains(node: unknown): boolean {
    return node === this || this.children.includes(node as FakeElement);
  }
}

/** 临时把 HTMLElement / Node 换成替身，跑完还原，免得影响其它用例。 */
function withFakeDom(run: () => void): void {
  const globals = globalThis as { HTMLElement?: unknown; Node?: unknown };
  const savedElement = globals.HTMLElement;
  const savedNode = globals.Node;
  globals.HTMLElement = FakeElement;
  globals.Node = FakeElement;
  try {
    run();
  } finally {
    globals.HTMLElement = savedElement;
    globals.Node = savedNode;
  }
}

/** 造一个落点事件：currentTarget 是落点，relatedTarget 是离开时要去的地方。 */
function dropTargetOf(el: FakeElement, related: unknown, hasFiles = true): DropTargetLike {
  const seed = hasFiles ? [file('image/png', 'a.png')] : [];
  const { event } = dragOf(seed, hasFiles);
  return {
    ...event,
    currentTarget: el as unknown as EventTarget,
    relatedTarget: related as EventTarget | null,
  };
}

describe('markDropTarget', () => {
  test('带文件进入落点：加上高亮类并收起宿主遮罩', () => {
    withFakeDom(() => {
      withFakeWindow((events) => {
        const el = new FakeElement();
        markDropTarget(dropTargetOf(el, null));
        assert.equal(el.classes.has(DROP_TARGET_CLASS), true, '进入落点应该加高亮类');
        assert.deepEqual(events, ['dragend'], '应该同时收起宿主的整页遮罩');
      });
    });
  });

  test('纯文本拖拽进入落点：不加高亮类', () => {
    withFakeDom(() => {
      withFakeWindow((events) => {
        const el = new FakeElement();
        markDropTarget(dropTargetOf(el, null, false));
        assert.equal(el.classes.has(DROP_TARGET_CLASS), false, '不是文件拖拽不该高亮');
        assert.deepEqual(events, [], '也不该碰宿主的遮罩');
      });
    });
  });
});

describe('unmarkDropTarget', () => {
  test('指针移到落点的子元素上：高亮保留', () => {
    withFakeDom(() => {
      const el = new FakeElement();
      const child = new FakeElement();
      el.children.push(child);
      el.classes.add(DROP_TARGET_CLASS);
      unmarkDropTarget(dropTargetOf(el, child));
      assert.equal(el.classes.has(DROP_TARGET_CLASS), true, '在子元素之间移动不算离开，不能闪');
    });
  });

  test('真的离开或放下：高亮撤掉', () => {
    withFakeDom(() => {
      const el = new FakeElement();
      el.classes.add(DROP_TARGET_CLASS);
      unmarkDropTarget(dropTargetOf(el, null));
      assert.equal(el.classes.has(DROP_TARGET_CLASS), false, '离开落点必须撤高亮');
    });
  });
});
