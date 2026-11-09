/**
 * 右侧栏「桌宠对话」标签页的组件入口。
 *
 * 只是把状态 hook 与渲染树接起来：状态在 ./state、树在 ./view、样式在 ./panel-css。
 * react 能力由宿主注入（见 ./runtime）。
 * @module dsh-pet/src/client/chat/panel
 */
import { createPetChatState } from './state.ts';
import { buildPanel } from './view.ts';
import type { ChatPanelRuntime } from './runtime.ts';

export type { ChatPanelRuntime } from './runtime.ts';

/**
 * 造面板组件。
 *
 * @param rt - 注入的 react 能力。
 * @returns 无参组件：状态与动作都从 ./state 取，本身不持逻辑。
 */
export function makePetChatPanel(rt: ChatPanelRuntime): () => unknown {
  const useChatState = createPetChatState(rt);
  return function PetChatPanel(): unknown {
    return buildPanel(rt, useChatState());
  };
}
