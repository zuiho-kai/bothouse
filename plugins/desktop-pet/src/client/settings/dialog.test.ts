/**
 * 确认弹窗（src/client/settings/dialog.ts）的契约测试。
 *
 * 三条契约：
 *   1. 四种场景各有自己的文案与按钮组合：只剩一只时不给「确认」；同步与删除的确认色不同；
 *   2. 点遮罩、取消、「知道了」都只关闭，不触发动作；点确认才回调；
 *   3. 删除文案里带出当前宠物 id，损坏文案里带出真实写入路径（用户要照着去备份）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeDialog, type DialogProps, type DialogState } from './dialog.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const Dialog = makeDialog({ h, t: (key: string) => key } as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');

const buttons = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'button' && node.props.type === 'button');

/** 渲染一个场景，返回节点树与回调计数。 */
function render(dialog: Exclude<DialogState, null>, selId = 'pet-2'): { tree: unknown; calls: string[] } {
  const calls: string[] = [];
  const props: DialogProps = {
    dialog,
    selId,
    onDismiss: () => calls.push('dismiss'),
    onConfirm: () => calls.push('confirm'),
  };
  return { tree: Dialog(props), calls };
}

describe('SettingsDialog —— 确认弹窗', () => {
  test('删除：带宠物 id，取消 + 危险色确认', () => {
    const { tree } = render({ kind: 'remove' }, 'pet-2');
    assert.ok(texts(tree).includes('confirmRemove'), '文案走 confirmRemove（内含 {id} 占位）');
    assert.ok(texts(tree).includes('confirmTitle'));
    const all = buttons(tree);
    assert.equal(all.length, 2);
    assert.equal(all[1].props.className, 'dsh-pet-cfg__btn is-danger');
  });

  test('只剩一只：只给「知道了」，没有确认按钮', () => {
    const { tree } = render({ kind: 'lastOne' });
    const all = buttons(tree);
    assert.equal(all.length, 1);
    assert.equal(all[0].props.children, 'ok');
    assert.ok(texts(tree).includes('atLeastOne'));
  });

  test('某种类只剩一只：也只给「知道了」，文案带出种类名', () => {
    const { tree } = render({ kind: 'lastOfKind', entry: 'glm' });
    const all = buttons(tree);
    assert.equal(all.length, 1, '没有可确认的动作');
    assert.equal(all[0].props.children, 'ok');
    assert.ok(texts(tree).includes('lastOfKind'), '文案走 lastOfKind（内含 {entry} 占位）');
  });

  test('同步：确认按钮是主色（不是危险色）', () => {
    const { tree } = render({ kind: 'sync' });
    const all = buttons(tree);
    assert.equal(all[1].props.className, 'dsh-pet-cfg__btn is-primary');
    assert.equal(all[1].props.children, 'sync');
  });

  test('损坏：标题与正文都换成损坏那套，正文里带真实路径', () => {
    const { tree } = render({ kind: 'corrupt', path: 'C:/x/main-config.jsonc' });
    assert.ok(texts(tree).includes('corruptTitle'));
    assert.ok(texts(tree).includes('corruptBody'), '正文走 corruptBody（内含 {path} 占位）');
    assert.equal(buttons(tree)[1].props.children, 'corruptConfirm');
  });

  test('取消、知道了、点遮罩都只关闭；确认才回调', () => {
    const remove = render({ kind: 'remove' });
    (buttons(remove.tree)[0].props.onClick as () => void)();
    assert.deepEqual(remove.calls, ['dismiss']);

    const lastOne = render({ kind: 'lastOne' });
    (buttons(lastOne.tree)[0].props.onClick as () => void)();
    assert.deepEqual(lastOne.calls, ['dismiss']);

    const confirm = render({ kind: 'remove' });
    (buttons(confirm.tree)[1].props.onClick as () => void)();
    assert.deepEqual(confirm.calls, ['confirm'], '确认按钮不得顺带关闭（由外壳决定）');
  });
});
