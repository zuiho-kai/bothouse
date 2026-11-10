---
name: core-keybindings-contracts-01
description: tui-client core-keybindings 源码接口 01：src/core/keybindings 下 actions、defaultBindings、reserved、resolver、store、template、types 共 7 个文件的声明与导入依赖
metadata:
  scope: 只收 src/core/keybindings 下本页所列文件的静态声明；入口说明归 core-keybindings-overview
---
# core-keybindings 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/actions.ts`**
- 源码声明的类型、组件或调用边界：`KEYBINDING_CONTEXTS`, `KeybindingContextName`, `KEYBINDING_CONTEXT_DESCRIPTIONS`, `KEYBINDING_ACTIONS`, `KeybindingAction`, `KEYBINDING_ACTION_DESCRIPTIONS`, `ACTION_SET`, `CONTEXT_SET`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/actions.ts#L1-L165)。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/defaultBindings.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_BINDINGS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { KeybindingBlock } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/defaultBindings.ts#L1-L120)。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/reserved.ts`**
- 源码声明的类型、组件或调用边界：`ReservedShortcut`, `NON_REBINDABLE`, `VALID_MODIFIERS`, `SPECIAL_KEYS`, `SYMBOL_KEYS`, `isKnownBaseKey`, `normalizeKey`, `parts`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/reserved.ts#L1-L82)。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/resolver.ts`**
- 源码声明的类型、组件或调用边界：`KeyId`, `current`, `lastMtimeMs`, `reloadResolver`, `mtimeMs`, `result`, `resolveAction`, `ctxMap`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { type KeyId, matchesKey } from "@mariozechner/pi-tui";`；`import type { KeybindingAction, KeybindingContextName } from "./actions.js";`；`import { getKeybindingsMtimeMs, loadKeybindings, startKeybindingsWatcher } from "./store.js";`；
  - `import type { KeybindingWarning, ResolvedBindings } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/resolver.ts#L1-L55)。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/store.ts`**
- 源码声明的类型、组件或调用边界：`KeybindingAction`, `CONFIG_DIR`, `KEYBINDINGS_FILE`, `getKeybindingsPath`, `keybindingsFileExists`, `getKeybindingsMtimeMs`, `buildResolved`, `resolved`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { existsSync, mkdirSync, readFileSync, statSync, watch } from "node:fs";`；`import { homedir } from "node:os";`；`import { dirname, join } from "node:path";`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/store.ts#L1-L302)。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/template.ts`**
- 源码声明的类型、组件或调用边界：`generateKeybindingsTemplate`, `file`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { DEFAULT_BINDINGS } from "./defaultBindings.js";`；`import type { KeybindingsFile } from "./types.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/template.ts#L1-L17)。
- **`jiuwenswarm/channels/tui/frontend/src/core/keybindings/types.ts`**
- 源码声明的类型、组件或调用边界：`KeybindingBlock`, `KeybindingsFile`, `ResolvedBindings`, `KeybindingWarning`, `LoadResult`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { KeybindingAction, KeybindingContextName } from "./actions.js";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/keybindings/types.ts#L1-L30)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/core-keybindings/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
