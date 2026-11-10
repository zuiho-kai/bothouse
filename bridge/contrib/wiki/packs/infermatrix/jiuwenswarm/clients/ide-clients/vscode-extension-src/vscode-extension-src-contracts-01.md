---
name: vscode-extension-src-contracts-01
description: VS Code 扩展 src 源码接口与集成边界 01：client（SessionManager、WsClient、protocol）、codeActions、context、editor（DiffApplier、DiffViewer）、swarm、terminal、ui（ChatPanel、StatusBar）的声明与导入
metadata:
  scope: 只收 vscode-extension/src 下十三个 TypeScript 文件的静态声明；该目录入口归 vscode-extension-src-overview，构建脚本归 vscode-extension-contracts-01
---
# vscode-extension-src 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/client/SessionManager.ts`**
- 源码声明的类型、组件或调用边界：`PendingRequest`, `REQUEST_TIMEOUT_SEC`, `SessionManager`, `idx`, `payload`, `models`, `activeModel`, `payload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { WsClient } from './WsClient';`；`import { JiuwenMessage, SessionInfo, makeRequest } from './protocol';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/SessionManager.ts#L1-L265)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts`**
- 源码声明的类型、组件或调用边界：`WsStatus`, `WsEventMap`, `BACKOFF_MS`, `DEFAULT_PING_INTERVAL_MS`, `WsClient`, `arr`, `idx`, `arr`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import WebSocket from 'ws';`；`import { JiuwenMessage } from './protocol';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts#L1-L161)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/client/protocol.ts`**
- 源码声明的类型、组件或调用边界：`JiuwenMessage`, `SessionInfo`, `ExtToWebviewMsg`, `SessionMetrics`, `ModelEntry`, `SkillEntry`, `WebviewToExtMsg`, `randomId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/protocol.ts#L1-L122)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/codeActions/FixWithAiCodeActionProvider.ts`**
- 源码声明的类型、组件或调用边界：`FixWithAiCodeActionProvider`, `diagnostics`, `action`, `buildDiagnosticPrefill`, `primary`, `line`, `errorText`, `startLine`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/codeActions/FixWithAiCodeActionProvider.ts#L1-L67)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/context/ContextCollector.ts`**
- 源码声明的类型、组件或调用边界：`ContextMetrics`, `CollectedContext`, `collectContext`, `editor`, `filePath`, `lang`, `selection`, `diagnostics`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`；`import { execSync } from 'child_process';`；`import * as path from 'path';`；`import * as fs from 'fs';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/context/ContextCollector.ts#L1-L329)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts`**
- 源码声明的类型、组件或调用边界：`EDIT_TOOLS`, `FileSnapshot`, `currentTurnSnapshots`, `lastTurnSnapshots`, `clearSnapshots`, `promoteSnapshots`, `getLastTurnSnapshots`, `clearLastTurnSnapshots`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`；`import * as path from 'path';`；`import * as fs from 'fs';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L1-L294)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffViewer.ts`**
- 源码声明的类型、组件或调用边界：`DIFF_SCHEME`, `DiffDocumentProvider`, `uri`, `provider`, `registerDiffProvider`, `showDiffAndPrompt`, `fileName`, `originalUri`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`；`import * as fs from 'fs';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffViewer.ts#L1-L120)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmMapPanel.ts`**
- 源码声明的类型、组件或调用边界：`SwarmMapPanel`, `pendingLines`, `line`, `htmlPath`, `html`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`；`import * as fs from 'fs';`；`import * as path from 'path';`；`import { SwarmSnapshot } from './SwarmState';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmMapPanel.ts#L1-L115)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmState.ts`**
- 源码声明的类型、组件或调用边界：`LaneFeedEntry`, `AgentLane`, `TeamTask`, `TeamMessage`, `SwarmSnapshot`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmState.ts#L1-L47)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmStateManager.ts`**
- 源码声明的类型、组件或调用边界：`SwarmStateManager`, `root`, `event`, `type`, `teamName`, `e`, `lane`, `activity`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as path from 'path';`；`import { AgentLane, TeamTask, TeamMessage, SwarmSnapshot } from './SwarmState';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmStateManager.ts#L1-L448)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts`**
- 源码声明的类型、组件或调用边界：`activeTerminal`, `runCommand`, `disposeTerminal`, `extractCommand`, `args`, `command`, `extractArguments`, `tc`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L1-L65)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts`**
- 源码声明的类型、组件或调用边界：`ChatPanel`, `statusListener`, `msgListener`, `sessionListener`, `type`, `content`, `mode`, `rid`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`；`import * as fs from 'fs';`；`import * as path from 'path';`；`import { execSync } from 'child_process';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L1-L1128)。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/StatusBar.ts`**
- 源码声明的类型、组件或调用边界：`StatusBar`, `tokenLabel`, `contextLabel`, `costLabel`, `metricsTooltip`, `formatTokenCount`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import * as vscode from 'vscode';`；`import { WsClient, WsStatus } from '../client/WsClient';`；`import { SessionMetrics } from '../client/protocol';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/StatusBar.ts#L1-L91)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/vscode-extension-src/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
