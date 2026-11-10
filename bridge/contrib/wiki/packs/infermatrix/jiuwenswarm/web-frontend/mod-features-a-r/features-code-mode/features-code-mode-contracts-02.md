---
name: features-code-mode-contracts-02
description: features-code-mode 源码接口 02：src/features/code-mode/useCodeTurnDiffHistory.ts 一个文件的声明（UseCodeTurnDiffHistoryOptions、useCodeTurnDiffHistory 及其内部序号与加载变量）与导入依赖
metadata:
  scope: 只收 useCodeTurnDiffHistory.ts 一个文件的静态声明记录，不证明运行行为；其余 code-mode 文件归 features-code-mode-contracts-01，入口说明归 features-code-mode-overview
---
# features-code-mode 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/useCodeTurnDiffHistory.ts`**
- 源码声明的类型、组件或调用边界：`UseCodeTurnDiffHistoryOptions`, `useCodeTurnDiffHistory`, `requestSequenceRef`, `operationSequenceRef`, `previousProcessingRef`, `projectId`, `loadHistory`, `requestSequence`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import type { Message, ProjectInfo } from '../../types';`；`import { gitClient } from './gitClient';`；`import { gitWatchClient } from './gitWatchClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/useCodeTurnDiffHistory.ts#L1-L155)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-code-mode/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
