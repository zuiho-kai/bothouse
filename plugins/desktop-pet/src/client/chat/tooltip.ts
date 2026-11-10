/**
 * 面板里的悬浮提示：替代原生 title（延迟、字体与样式都由浏览器决定，改不动）。
 *
 * 气泡挂在 body 上、position:fixed 按光标摆位：消息列表是 overflow:auto 的滚动容器，
 * 挂在列表里的伪元素气泡会被裁掉（贴顶/贴底的消息看不到提示），所以不走设置页那套 data-tip::after。
 * 摆位复用 shared/tooltip 的 tooltipPlacement，外观在 ./panel-css 的 .pet-chat-tip。
 * @module dsh-pet/src/client/chat/tooltip
 */
import { tooltipPlacement } from '../../shared/tooltip.ts';
import { px } from './metrics.ts';

/** 气泡 class（外观见 ./panel-css）。 */
export const TIP_CLASS = 'pet-chat-tip';

/** 光标与气泡的间隙（px）：与设置页的 data-tip 气泡一致，视觉上不贴手。 */
const TIP_GAP_PX = 10;

/** 唯一的那个气泡；面板里悬停很频繁，反复建删会让气泡闪，所以复用。 */
let tipEl: HTMLDivElement | undefined;

/** 全局监听的解除函数；与气泡一起登记、一起回收。 */
let unwatch: (() => void) | undefined;

/** 收起气泡：元素留着复用，只摘 `is-on`。 */
function hideTip(): void {
  tipEl?.classList.remove('is-on');
}

/** 取气泡元素，没有就建一个并挂到 body（挂 body 才不会被子孙的 overflow 裁掉）。 */
function ensureTip(): HTMLDivElement {
  if (tipEl !== undefined && tipEl.parentNode === document.body) return tipEl;
  const el = document.createElement('div');
  el.setAttribute('class', TIP_CLASS);
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  tipEl = el;
  // 监听目标当场捕获：回收时全局可能已经不在（宿主换页、测试拆环境），不能回头再读 window
  const win = window;
  const root = document;
  // 滚动或按下别处时气泡会僵在原地，立刻收掉；capture 才能收听到消息列表自身的滚动
  const close = (): void => hideTip();
  win.addEventListener('scroll', close, true);
  root.addEventListener('pointerdown', close, true);
  unwatch = () => {
    win.removeEventListener('scroll', close, true);
    root.removeEventListener('pointerdown', close, true);
    unwatch = undefined;
  };
  return el;
}

/**
 * 在光标处显示气泡。
 *
 * @param text - 气泡正文；每次重设，同一个气泡服务所有触发元素。
 * @param cursor - 光标位置（视口坐标）。
 */
function showTip(text: string, cursor: { x: number; y: number }): void {
  const el = ensureTip();
  el.textContent = text;
  // 先归零再量：opacity:0 的元素已经能量到真实宽高，但位置不定，不归零会按上一处的坐标判断翻边
  el.style.left = px(0);
  el.style.top = px(0);
  const placed = tooltipPlacement(
    cursor,
    { w: el.offsetWidth, h: el.offsetHeight },
    { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    TIP_GAP_PX,
  );
  el.style.left = px(placed.x);
  el.style.top = px(placed.y);
  el.classList.add('is-on');
}

/**
 * 触发元素的悬停属性：光标进入时在光标处出气泡，离开即收起。
 *
 * 不接 focus：点击按钮也会让它获得焦点，于是点图/点播放之后气泡会一直挂在屏幕上，
 * 键盘用户的可读名靠元素上的 `aria-label`。
 *
 * @param text - 气泡正文（已翻译）。
 */
export function tipAttrs(text: string): {
  onMouseEnter: (event: { clientX: number; clientY: number }) => void;
  onMouseLeave: () => void;
} {
  return {
    onMouseEnter: (event) => showTip(text, { x: event.clientX, y: event.clientY }),
    onMouseLeave: () => hideTip(),
  };
}

/** 卸载面板时回收气泡与全局监听；样式标签由 ./styles 释放。 */
export function disposeTip(): void {
  unwatch?.();
  tipEl?.remove();
  tipEl = undefined;
}
