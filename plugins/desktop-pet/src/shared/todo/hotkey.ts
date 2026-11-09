/**
 * 待办面板的悬停快捷键：鼠标停在宠物上时按 `D` 开关面板。
 * 按键规则归 shared/hotkey，本模块只绑定「哪个键 + 菜单文案」。
 * @module dsh-pet/src/shared/todo/hotkey
 */
import { isBareKey } from '../hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/** 快捷键的显示文案（菜单项右侧灰字）。与 {@link isTodoHotkey} 的按键保持同一份事实。 */
export const TODO_HOTKEY_HINT = 'D 键';

/**
 * 这次按键该不该开关待办面板。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `D`（含大写）时为 true，输入框里打字则为 false。
 */
export function isTodoHotkey(e: HotkeyEvent): boolean {
  return isBareKey(e, 'd');
}
