/**
 * 外观与字体卡（全局默认）：字体种类、字号、是否跟随宠物说话。
 * 字体种类作用于现在用软糖体的全部文字；字号只作用于气泡与悬浮提示，对话窗与得分弹窗不变。
 * 与其余全局默认同语义：只改本地状态，随「保存」整包写入。
 * @module dsh-pet/src/client/settings/font-card
 */
import type { FunctionComponent } from 'react';
import type { FontConfig, FontFamilyId } from '../../shared/types.ts';
import { FONT_PRESETS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../shared/fonts.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';
import { makeSelect } from './panel/select.ts';

/** 字体卡的输入。 */
export interface FontCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  busy: boolean;
  /** 当前字体配置。 */
  font: FontConfig;
  /** 改字体配置的若干字段。 */
  onChange: (patch: Partial<FontConfig>) => void;
}

/**
 * 造外观与字体卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeFontCard(rt: SettingsRuntime): FunctionComponent<FontCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });
  const Select = makeSelect(rt);

  return function FontCard(props: FontCardProps) {
    const { busy, font } = props;
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('fontTitle'), t('fontHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            field(
              t('fontFamilyLabel'),
              h(Select, {
                label: t('fontFamilyLabel'),
                value: font.family,
                options: FONT_PRESETS.map((preset) => ({ id: preset.id, label: t('font.' + preset.id) })),
                disabled: busy,
                onChange: (id: string) => props.onChange({ family: id as FontFamilyId }),
              }),
              t('fontFamilyHint'),
            ),
            field(
              t('fontSizeLabel'),
              h(
                'input',
                numberInputProps(font.size, (v) => props.onChange({ size: v }), {
                  step: '1',
                  min: String(FONT_SIZE_MIN),
                  max: String(FONT_SIZE_MAX),
                  disabled: busy,
                }),
              ),
              t('fontSizeHint'),
            ),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [toggleCell('fontFollowToggle', font.followPet, busy, (v) => props.onChange({ followPet: v }))],
        }),
      ],
    });
  };
}
