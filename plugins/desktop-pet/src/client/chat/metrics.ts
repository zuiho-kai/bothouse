/**
 * 面板的尺寸常量：CSS 与 JS 共用的唯一来源。
 *
 * 尺寸不写字面量（规范要求走共享常量）；输入框的最大高度还要被自动长高的脚本读到，
 * 所以放在这里而不是 CSS 字符串里各写一份。
 * @module dsh-pet/src/client/chat/metrics
 */

/** 面板尺寸与间距（px）。 */
export const SIZE = {
  pad: 12,
  padBottom: 10,
  gap: 8,
  gapTight: 6,
  gapWide: 10,
  listGap: 20,
  avatar: 28,
  imgMaxW: 220,
  imgMaxH: 180,
  preview: 48,
  hairline: 2,
  /** 播报按钮生成中的转圈直径；与 11px 的时间文字同高，不压过文字。 */
  spinner: 12,
  tabPadY: 3,
  tabPadX: 12,
  toolPadY: 2,
  toolPadX: 10,
  bubblePadY: 8,
  bubblePadX: 12,
  composerPad: 10,
  composerPadBottom: 6,
  inputMinH: 44,
  inputMaxH: 140,
  send: 34,
  pillPadY: 4,
  pill: 999,
  /** 悬浮提示气泡的内边距（纵、横）；与设置页的 data-tip 气泡一致。 */
  tipPadY: 6,
  tipPadX: 10,
  /** 悬浮提示气泡的最大宽度：一行放不下就省略，不做换行（换行会让宽度随位置跳变）。 */
  tipMaxW: 260,
  /** 人设卷帘里正文的最大高度：人设没有长度上限，超过就在这块内部滚动。 */
  personaMaxH: 200,
} as const;

/** 输入框自动长高的上限（px）；超过就内部滚动。 */
export const INPUT_MAX_HEIGHT = SIZE.inputMaxH;

/** 数值 → px 字符串。 */
export const px = (value: number): string => value + 'px';
