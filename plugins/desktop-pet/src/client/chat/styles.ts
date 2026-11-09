/**
 * 对话面板的样式表与一次性注入。
 *
 * 只放样式与注入入口：颜色、字号、圆角全部取 `--dsw-*` token，不写字面色值——
 * 浅色/深色主题由 DSH 的变量切换，这里不做第二套配色。
 * 内联样式写不出 `:hover` / `:focus`，所以面板统一走这份 CSS。
 * @module dsh-pet/src/client/chat/styles
 */
import { PANEL_CSS } from './panel-css.ts';

/** 样式标签的归属标记；同一 key 只注入一次。 */
const STYLE_KEY = 'dsh-pet-chat-panel';

/** 当前挂载数：多个 pane 可能同时挂载面板，靠引用计数决定何时移除样式标签。 */
let mountedCount = 0;

/** 已注入的 style 元素（第一个挂载时创建）。 */
let styleTag: HTMLStyleElement | undefined;

/**
 * 注入面板样式（幂等，按引用计数释放）。
 *
 * @returns 释放函数：最后一次释放时才移除 style 标签；重复调用安全。
 */
export function injectPanelCss(): () => void {
  if (typeof document === 'undefined') return () => {};
  mountedCount += 1;
  if (styleTag === undefined) {
    const tag = document.createElement('style');
    tag.dataset.dshPetCss = STYLE_KEY;
    tag.textContent = PANEL_CSS;
    document.head.appendChild(tag);
    styleTag = tag;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedCount -= 1;
    if (mountedCount === 0 && styleTag !== undefined) {
      styleTag.remove();
      styleTag = undefined;
    }
  };
}
