/**
 * 表单校验的契约测试。
 *
 * 三条契约：
 *   1. 规则与宿主一一对应：宠物宽高、物理区间、模型成对、对话额度非负、字体白名单——宿主会 400 的组合这里先拦；
 *   2. 顺序即提示优先级：一次只报第一条，不把整张表单的问题堆给用户；
 *   3. 合法输入必须放行（尤其是 0 这类「看起来像空值」的合法边界）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validateForm, type FormValues } from './validate-form.ts';
import { DEFAULT_FONT, FONT_SIZE_MAX } from '../../../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../../../shared/physics.ts';
import type { Pet } from '../../../shared/types.ts';

const pet = (extra: Record<string, unknown> = {}): Pet =>
  ({
    id: 'pet-1',
    name: 'pet-1',
    size: 200,
    position: { corner: 'bottom-right', marginX: 10, marginY: 20 },
    ...extra,
  }) as unknown as Pet;

/** 一份处处合法的表单；用例只改自己关心的那一项。 */
const valid = (overrides: Partial<FormValues> = {}): FormValues => ({
  pets: [pet()],
  physics: { ...DEFAULT_PHYSICS },
  whisperModel: { provider: '', model: '' },
  chatModel: { provider: '', model: '' },
  chatMemory: 5,
  chatImageLimit: 10,
  font: { ...DEFAULT_FONT },
  ...overrides,
});

describe('validateForm —— 保存前校验', () => {
  test('全合法：返回 null', () => {
    assert.equal(validateForm(valid()), null);
  });

  test('宠物：宽度必须为正数、偏移必须是有限数', () => {
    assert.equal(validateForm(valid({ pets: [pet({ size: 0 })] })), 'invalid');
    assert.equal(validateForm(valid({ pets: [pet({ size: Number.NaN })] })), 'invalid');
    assert.equal(
      validateForm(valid({ pets: [pet({ position: { corner: 'top-left', marginX: Number.NaN, marginY: 0 } })] })),
      'invalid',
    );
  });

  test('宠物：百分比缺省或是不小于 1 的数字才合法（不设上限）', () => {
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 0 })] })), 'invalid');
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 1 })] })), null);
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 100 })] })), null);
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 150 })] })), null, '超过 100 合法');
    assert.equal(validateForm(valid({ pets: [pet()] })), null, '缺省 = 只用 px，合法');
  });

  test('物理参数：区间与正负都按宿主规则卡住', () => {
    assert.equal(validateForm(valid({ physics: { ...DEFAULT_PHYSICS, gravity: -1 } })), 'invalidPhysics');
    assert.equal(validateForm(valid({ physics: { ...DEFAULT_PHYSICS, restitution: 1.5 } })), 'invalidPhysics');
    assert.equal(validateForm(valid({ physics: { ...DEFAULT_PHYSICS, throwPower: 0 } })), 'invalidPhysics');
    assert.equal(
      validateForm(valid({ physics: { ...DEFAULT_PHYSICS, gravity: 0, restitution: 0, throwPower: 0.01 } })),
      null,
      '0 是合法边界（重力为零、完全弹性都没有下限限制误伤）',
    );
  });

  test('模型：只写一半非法，两边都空（跟随当前对话）合法', () => {
    assert.equal(validateForm(valid({ whisperModel: { provider: 'openai', model: '' } })), 'invalidModel');
    assert.equal(validateForm(valid({ chatModel: { provider: '', model: 'gpt-4o' } })), 'invalidModel');
    assert.equal(validateForm(valid({ whisperModel: { provider: 'openai', model: 'gpt-4o' } })), null);
  });

  test('对话额度：负数非法，0 合法（0 = 不限制）', () => {
    assert.equal(validateForm(valid({ chatMemory: -1 })), 'invalidChatMemory');
    assert.equal(validateForm(valid({ chatImageLimit: -1 })), 'invalidChatImageLimit');
    assert.equal(validateForm(valid({ chatMemory: 0, chatImageLimit: 0 })), null);
  });

  test('字体：种类必须在白名单里，字号在闭区间内', () => {
    assert.equal(validateForm(valid({ font: { ...DEFAULT_FONT, size: FONT_SIZE_MAX + 1 } })), 'invalidFont');
    assert.equal(validateForm(valid({ font: { ...DEFAULT_FONT, family: 'not-a-font' as never } })), 'invalidFont');
  });

  test('顺序即优先级：宠物不合格时不再报后面的物理参数', () => {
    const values = valid({ pets: [pet({ size: 0 })], physics: { ...DEFAULT_PHYSICS, gravity: -1 } });
    assert.equal(validateForm(values), 'invalid');
  });
});
