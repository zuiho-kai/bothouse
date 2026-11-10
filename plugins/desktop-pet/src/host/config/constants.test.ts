/**
 * 标识符规则的单元测试：宠物 id、表情包素材根、thumb 的 petId 共用一条 isValidPetId。
 *
 * 钉住的不变式：
 *   - 三个入口都当路径片段用，长度与禁用字符必须同一套（分开写就会出现一处拦、另一处放行）；
 *   - '.' 与 '..' 没有禁用字符，但会把素材根顶到上一层，必须单独拦掉；
 *   - 合法名含中文照常：用非法字符类而不是 ASCII 白名单。
 *
 * 跑法：node --experimental-strip-types --test src/host/config/constants.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isValidPetId, MAX_PET_ID_LENGTH } from './constants.ts';

describe('isValidPetId —— 标识符能否当路径片段', () => {
  test('常规 id 合法：ASCII、下划线、连字符与中文都放行', () => {
    for (const id of ['main', 'a_b-c', 'pet-7', '蓝鱼', 'deepseek-宠物']) {
      assert.equal(isValidPetId(id), true, `「${id}」应合法`);
    }
  });

  test('中间的点号合法（宠物 id 允许含点号，/state 路径按最后一个点切叶子名）', () => {
    assert.equal(isValidPetId('a.b'), true);
  });

  test('空串与超长非法：上限是 MAX_PET_ID_LENGTH，恰好等于上限仍合法', () => {
    assert.equal(isValidPetId(''), false);
    assert.equal(isValidPetId('x'.repeat(MAX_PET_ID_LENGTH)), true);
    assert.equal(isValidPetId('x'.repeat(MAX_PET_ID_LENGTH + 1)), false);
  });

  test('含路径分隔符或驱动器保留符非法', () => {
    for (const id of ['a/b', 'a\\b', 'C:', 'a:b']) {
      assert.equal(isValidPetId(id), false, `「${id}」应非法`);
    }
  });

  test('控制字符非法（防止配置值逃逸路径）', () => {
    assert.equal(isValidPetId('a\u0000b'), false);
    assert.equal(isValidPetId('a\nb'), false);
  });

  test('“.” 与 “..” 非法：它们没有禁用字符，但会把素材根顶到上一层', () => {
    assert.equal(isValidPetId('.'), false);
    assert.equal(isValidPetId('..'), false);
  });
});
