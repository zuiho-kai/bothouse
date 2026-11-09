/**
 * 动画素材的容器格式探测：决定这次会话用 `.mov`（HEVC-alpha）还是 `.webm`（VP9-alpha）。
 * 只有 macOS 与 iOS 的 WebKit（Safari / WKWebView）需要 mov——`canPlayType` 判不出来：Safari 能解码 VP9 webm
 * 却会丢弃 alpha，表现成黑底；「能解码」与「透明还在」是两件事，后者没有 Web API 可查询。
 * 判断结果按会话缓存一次，扩展名不会在运行中来回变。
 * @module dsh-pet/src/client/pet/animation/media
 */
import { ANIMATION_EXT } from '../../../shared/constants.ts';

/** 本次会话已定论的扩展名，`null` = 尚未判断。 */
let resolvedExt: string | null = null;

/**
 * 是否优先要 mov：macOS 与 iOS 的 WebKit 才要；其余按 Chromium/Firefox 处理。
 *
 * @returns 需要 HEVC-alpha 时返回 true。
 */
export function prefersMov(): boolean {
  const ua = navigator.userAgent;
  // iOS 上所有浏览器（含 CriOS / FxiOS / EdgiOS）都是 WebKit，同样丢弃 alpha；
  // 必须排在下面的排除之前，否则 FxiOS 会被误判成原生支持。
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // Chromium 系（含 Electron 桌面端）与 Firefox 原生支持 VP9-alpha，不需要 mov。
  if (/Chrome|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua)) return false;
  return /Mac/i.test(navigator.platform || ua); // 余下按 WebKit 处理，且限定 macOS。
}

/**
 * 取本次会话使用的动画扩展名（含点）。显式常量优先，否则按渲染端判断。
 * 宿主对缺失的 `.mov` 会退回同名 `.webm`，所以这里只管「要哪一种」。
 *
 * @returns `.mov` 或 `.webm`。
 */
export function thumbExt(): string {
  if (resolvedExt === null) {
    // ANIMATION_EXT 的静态类型被窄化为 '.webm'，但用户会把它改成 .mov；
    // 按 string 读才能表达这条显式意图，否则 TS 判为恒不相等。
    const explicit: string = ANIMATION_EXT;
    resolvedExt = explicit === '.mov' || prefersMov() ? '.mov' : '.webm';
  }
  return resolvedExt;
}
