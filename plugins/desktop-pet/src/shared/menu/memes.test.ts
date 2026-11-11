/**
 * 配图菜单分支（src/shared/menu/memes.ts）的契约测试。
 *
 * 三条契约：分组只按配置算（顺序 = 书写顺序，开关关着没有对话组，上限 0 = 不限制）；
 * 描述为空的图不算可用（与宿主池判定同口径）；没有可用图时整项不出现。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMemeBranch, groupMemes, memeThumbUrl } from './memes.ts';
import type { MenuBranch, MenuLeaf } from './types.ts';

/** 三张可用图（顺序即书写顺序）。 */
const THREE = { 甲: '第一张', 乙: '第二张', 丙: '第三张' };

describe('groupMemes —— 对话组怎么切', () => {
  test('开关关闭：对话组为空，全部落到其他', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: false, chatImageLimit: 2 });
    assert.deepEqual(groups.chat, [], '开关关着就一张都不进对话');
    assert.deepEqual(groups.other, ['甲', '乙', '丙']);
  });

  test('开关缺省：按关闭处理', () => {
    assert.deepEqual(groupMemes({ memes: THREE }).chat, []);
  });

  test('开关开启 + 上限 2：只取配置里写在前面的两张', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: true, chatImageLimit: 2 });
    assert.deepEqual(groups.chat, ['甲', '乙'], '顺序必须跟配置书写顺序一致');
    assert.deepEqual(groups.other, ['丙']);
  });

  test('开关开启 + 上限 0：不限制，全部进对话组', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: true, chatImageLimit: 0 });
    assert.deepEqual(groups.chat, ['甲', '乙', '丙']);
    assert.deepEqual(groups.other, []);
  });

  test('开关开启 + 上限缺失：不限制，全部进对话组', () => {
    assert.deepEqual(groupMemes({ memes: THREE, chatImageEnabled: true }).chat, ['甲', '乙', '丙']);
  });

  test('开关开启 + 上限超过总数：取全量，不报错', () => {
    const groups = groupMemes({ memes: THREE, chatImageEnabled: true, chatImageLimit: 99 });
    assert.deepEqual(groups.chat, ['甲', '乙', '丙']);
    assert.deepEqual(groups.other, []);
  });

  test('描述为空或纯空白的图不算可用（宿主池同样剔除）', () => {
    const groups = groupMemes({
      memes: { 甲: '有描述', 乙: '', 丙: '   ', 丁: '有描述' },
      chatImageEnabled: true,
      chatImageLimit: 10,
    });
    assert.deepEqual(groups.chat, ['甲', '丁'], '没有描述的图模型认不出，不该出现在菜单里');
  });

  test('清单缺失或形状不对：两组都为空', () => {
    assert.deepEqual(groupMemes({ memes: undefined }), { chat: [], other: [] });
    assert.deepEqual(groupMemes({ memes: [] as unknown as Record<string, string> }), { chat: [], other: [] });
  });
});

/** 把一个分支里所有叶子按「组名 → 叶子」摊平，便于断言。 */
function leavesOf(branch: MenuBranch): { group: string; leaf: MenuLeaf }[] {
  const out: { group: string; leaf: MenuLeaf }[] = [];
  for (const group of branch.children) {
    if (!('children' in group)) continue;
    for (const child of group.children) {
      if ('children' in child) continue;
      out.push({ group: group.label, leaf: child });
    }
  }
  return out;
}

describe('buildMemeBranch —— 菜单形状', () => {
  test('开关开启 + 分界：两级结构，组内每项都带图名与 whisper 动作', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true, chatImageLimit: 2 });
    assert.ok(branch, '有可用图时必须给出分支');
    assert.equal(branch.label, '配图');
    assert.deepEqual(
      branch.children.map((group) => group.label),
      ['纳入对话的配图', '其他'],
    );
    const leaves = leavesOf(branch);
    assert.deepEqual(
      leaves.map((entry) => entry.leaf.label),
      ['甲', '乙', '丙'],
    );
    for (const { leaf } of leaves) {
      assert.equal(leaf.action, 'whisper', '点图 = 用这张图说一句');
      assert.equal(leaf.image, leaf.label, '图名既是显示名也是传给宿主的名称');
    }
  });

  test('开关关闭：只剩「其他」一组，不出现空的对话组', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: false });
    assert.ok(branch);
    assert.deepEqual(
      branch.children.map((group) => group.label),
      ['其他'],
    );
    assert.equal(leavesOf(branch).length, 3);
  });

  test('全部进对话组：只剩「纳入对话的配图」一组', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true, chatImageLimit: 0 });
    assert.ok(branch);
    assert.deepEqual(
      branch.children.map((group) => group.label),
      ['纳入对话的配图'],
    );
  });

  test('没有可用图：返回 null，调用方据此不插入这一项', () => {
    assert.equal(buildMemeBranch({}), null);
    assert.equal(buildMemeBranch({ memes: { 甲: '' } }), null);
  });
});

describe('memeThumbUrl —— 缩略图地址', () => {
  test('素材根与名称各占一段：中文与空格都必须编码', () => {
    assert.equal(
      memeThumbUrl('/dsh-pet-7340', 'my pack', '大的 要来啦'),
      '/dsh-pet-7340/pic/memes/my%20pack/%E5%A4%A7%E7%9A%84%20%E8%A6%81%E6%9D%A5%E5%95%A6.png',
    );
  });

  test('素材根缺省或纯空白：按 main（与宿主 /pic 的归属语义一致）', () => {
    assert.equal(memeThumbUrl('/x', undefined, 'a'), '/x/pic/memes/main/a.png');
    assert.equal(memeThumbUrl('/x', '   ', 'a'), '/x/pic/memes/main/a.png');
  });
});

describe('buildMemeBranch —— 缩略图', () => {
  test('给了地址生成器：每片叶子都带 thumb，且与 image 同名', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true, chatImageLimit: 1 }, (name) => 'u:' + name);
    assert.ok(branch);
    for (const { leaf } of leavesOf(branch)) {
      assert.equal(leaf.thumb, 'u:' + leaf.label, 'thumb 必须由名称生成，不能错位');
      assert.equal(leaf.image, leaf.label);
    }
  });

  test('没给生成器：叶子不带 thumb 字段（菜单只有文字）', () => {
    const branch = buildMemeBranch({ memes: THREE, chatImageEnabled: true });
    assert.ok(branch);
    for (const { leaf } of leavesOf(branch)) {
      assert.equal('thumb' in leaf, false, '缺省不该占位，否则行高与对齐都会变');
    }
  });
});
