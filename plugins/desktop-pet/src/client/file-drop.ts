/**
 * 拖拽文件的归属：认领落在我们界面上的 drop，避免同一张图被 DSH 与桌宠各处理一次。
 */
import { dragHasFiles, firstImageFile } from '../shared/chat/image-pick.ts';

/** 落点自己的高亮类名；具体样式由各落点自己写。 */
export const DROP_TARGET_CLASS = 'is-drop-target';

/** 拖拽事件的结构子集：原生 DragEvent 与注入 react 的合成事件都满足。 */
export interface DragLike {
  /** 拖拽携带的数据；非 HTML 拖拽来源可能为空。 */
  readonly dataTransfer: DataTransfer | null;
  /** 拦掉默认行为：否则浏览器会把拖进去的文件当导航打开，页面直接被换掉。 */
  preventDefault: () => void;
  /** 阻断冒泡：DSH 的拖拽监听就在同一棵树的祖先上，不拦会被它再处理一遍。 */
  stopPropagation: () => void;
}

/** 落点事件额外带的信息。 */
export interface DropTargetLike extends DragLike {
  /** 监听器当前绑定的元素；原生事件里可能为空。 */
  readonly currentTarget: EventTarget | null;
  /** 离开时指针进入的目标；用来区分「离开落点」与「在落点子元素之间移动」。 */
  readonly relatedTarget: EventTarget | null;
}

/**
 * 认领「指针刚进入落点」：阻断冒泡，并收起宿主的整页遮罩。
 *
 * 宿主的遮罩由 document 上的 dragenter 驱动，指针进到我们的区域后它不该再压着整个页面；
 * 它的计数早在指针进入我们区域前就加上去了，所以这里要连带替它收一次尾。
 *
 * @param event - 落点收到的 dragenter。
 * @returns 带文件时为 true 且已阻断冒泡；其它拖拽返回 false 且不碰事件与遮罩。
 */
export function claimFileDragEnter(event: DragLike): boolean {
  if (!dragHasFiles(event)) return false;
  event.stopPropagation();
  hideHostDropOverlay();
  return true;
}

/**
 * 认领「有文件经过」的拖拽。
 *
 * @param event - 我们的界面收到的 dragover。
 * @returns 带文件时为 true，且已拦默认行为与冒泡；纯文本等其它拖拽返回 false 且不碰事件。
 */
export function claimFileDragOver(event: DragLike): boolean {
  if (!dragHasFiles(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/**
 * 认领落在我们界面上的文件拖放。
 *
 * @param event - 我们的界面收到的 drop。
 * @returns 第一张可发送的图片；不是文件拖放时一律不碰事件，是文件但认不出图片时吞下并返回 undefined。
 */
export function claimFileDrop(event: DragLike): File | undefined {
  if (!dragHasFiles(event)) return undefined;
  event.preventDefault();
  event.stopPropagation();
  hideHostDropOverlay();
  return firstImageFile(event.dataTransfer);
}

/**
 * 收起宿主（DSH）的整页拖拽遮罩。
 *
 * 它用 document 上的 dragenter/dragleave 计数维护遮罩，只有 drop 与 window 的 dragend 会清零。
 * 我们的 drop 截住冒泡后它收不到收尾信号，遮罩会一直挂着；补这一次不带文件，不会触发上传。
 */
function hideHostDropOverlay(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('dragend'));
}

/**
 * 把落点标记成可放置状态。
 *
 * @param event - 落点上的 dragenter。
 */
export function markDropTarget(event: DropTargetLike): void {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (!claimFileDragEnter(event)) return;
  el.classList.add(DROP_TARGET_CLASS);
}

/**
 * 撤掉落点的高亮。
 *
 * 指针在落点的子元素之间移动也会触发 dragleave，此时 relatedTarget 仍在区域内，不算离开；
 * 不区分的话，高亮会随着指针在输入框、按钮之间移动而闪。
 *
 * @param event - 落点上的 dragleave，或落点上的 drop。
 */
export function unmarkDropTarget(event: DropTargetLike): void {
  const el = event.currentTarget;
  const to = event.relatedTarget;
  if (!(el instanceof HTMLElement)) return;
  if (to instanceof Node && el.contains(to)) return;
  el.classList.remove(DROP_TARGET_CLASS);
}
