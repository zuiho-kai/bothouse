/**
 * 悬停快捷键的通用判据：哪一次按键该被宠物截走。
 *
 * 纯函数，两端共用；各功能只声明自己那一个键（见 chat/hotkey 与 todo/hotkey）。
 * 桌面端只在窗口已聚焦时收得到按键——透明穿透窗默认不抢焦点。
 * @module dsh-pet/src/shared/hotkey
 */

/** 判据只读这几个字段，测试可以用普通对象代替 KeyboardEvent。 */
export interface HotkeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
}

/** 这些地方按键属于打字，不能抢：输入框、文本域、下拉、contenteditable。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}

/**
 * 是不是一次「裸按某键」。
 *
 * @param e - 键盘事件（只读 key 与修饰键、target）。
 * @param key - 目标键的小写形式，如 `'t'`。
 * @returns 键名匹配（大小写不敏感）、不带 Ctrl/Meta/Alt，且焦点不在可编辑元素上时为 true。
 */
export function isBareKey(e: HotkeyEvent, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (String(e.key).toLowerCase() !== key) return false;
  return !isTypingTarget(e.target);
}
