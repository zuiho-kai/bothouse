/**
 * 待办面板的尺寸预算（src/shared/todo/styles.ts）：面板随字号缩放，窗口上边距装得下整块面板。
 *
 * 只覆盖纯计算与常量部分；CSS 的实际观感由手动验收。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { BUBBLE_OVERLAP_RATIO, DEFAULT_FONT, bubbleTopMarginPx, resolveFontPx } from '../fonts.ts';
import { TODO_CSS, TODO_FONT_SCALE, TODO_PANEL_METRICS, todoPanelTopMarginPx } from './styles.ts';
import type { FontConfig } from '../types.ts';

/** 面板自身高度（px）：取清单态与日历态的较高者，与 todoPanelTopMarginPx 同一份预算。 */
function panelHeightPx(font: FontConfig | undefined, size: number): number {
  const m = TODO_PANEL_METRICS;
  const lower = Math.max(m.list + m.hint, m.calendar);
  return (m.head + m.form + lower) * resolveFontPx(font, size).bubble * TODO_FONT_SCALE;
}

describe('todoPanelTopMarginPx —— 桌面窗口上边距', () => {
  test('默认配置：面板比纯气泡预算高，窗口要按面板加高', () => {
    const px = todoPanelTopMarginPx(DEFAULT_FONT, 462);
    assert.ok(px > bubbleTopMarginPx(DEFAULT_FONT, 462), '面板比气泡高，窗口要按面板加高');
    assert.ok(px < 400, `不该离谱，实得 ${px}px`);
  });

  test('字号调大：上边距跟着面板等比变大', () => {
    const base = todoPanelTopMarginPx(DEFAULT_FONT, 462);
    const big = todoPanelTopMarginPx({ ...DEFAULT_FONT, size: 42 }, 462);
    assert.ok(big > base * 1.5, `字号翻倍后上边距应显著变大，实得 ${big}px`);
  });

  test('宠物调小且字号不跟随：面板预算超过气泡预算，窗口必须按面板加高', () => {
    const font = { ...DEFAULT_FONT, followPet: false };
    const panel = todoPanelTopMarginPx(font, 200);
    assert.ok(panel > bubbleTopMarginPx(font, 200), `面板更高，实得 ${panel}px`);
    assert.ok(panel >= panelHeightPx(font, 200) - 200 * BUBBLE_OVERLAP_RATIO, '上边距应覆盖面板减去底边探出的部分');
  });

  test('font 缺失：按默认口径换算，不产出 NaN 或负数', () => {
    const px = todoPanelTopMarginPx(undefined, 462);
    assert.ok(Number.isFinite(px) && px > 0, `实得 ${px}`);
  });
});

describe('TODO_CSS —— 尺寸锚字号', () => {
  test('字号与宽度都从 --f 派生，不再写死像素', () => {
    assert.ok(TODO_CSS.includes('var(--f)'), '面板尺寸应锚 --f');
    assert.ok(!TODO_CSS.includes('font-size:13px'), '不应再写死 13px 字号');
    assert.ok(!TODO_CSS.includes('width:308px'), '不应再写死 308px 宽度');
  });
});
