---
name: features-code-mode-contracts-01
description: features-code-mode 源码接口 01：src/features/code-mode 下 CodeBranchSelector、CodeChangesCard、CodeCommitPushControl、CodeEnvironmentPanel、CodeReviewPanel、codeTurnChangeEvents、codeTurnDiffBinding、gitClient、gitPublishState、gitWatchClient、turnChangeState、types、useCodeGitDiffWatch 共十三个文件的声明与导入依赖
metadata:
  scope: 只收字母序 CodeBranchSelector 至 useCodeGitDiffWatch 十三个文件的静态声明记录，不证明运行行为；useCodeTurnDiffHistory 归 features-code-mode-contracts-02，入口说明归 features-code-mode-overview
---
# features-code-mode 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx`**
- 源码声明的类型、组件或调用边界：`CodeBranchSelectorProps`, `getErrorMessage`, `webError`, `CodeBranchSelector`, `rootRef`, `unbornHintId`, `loadProjects`, `closeMenu`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';`；`import { AlertCircle, Check, LoaderCircle, Plus, Search, X } from 'lucide-react';`；`import CodehubBranchIcon from '../../assets/code-mode/codehub-branch.svg?react';`；
  - `import type { ProjectInfo, WebError } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L1-L338)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeChangesCard.tsx`**
- 源码声明的类型、组件或调用边界：`CodeChangesCardProps`, `CodeChangesCard`, `files`, `visibleFiles`, `reviewTarget`, `discarded`, `canChangeTurn`, `actionLabel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { ChevronDown, ChevronUp, LoaderCircle, RefreshCw } from 'lucide-react';`；`import { resolveFileIconType } from '../../components/FileIcon';`；`import folderIcon from '../../assets/file-icons/folder.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeChangesCard.tsx#L1-L106)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx`**
- 源码声明的类型、组件或调用边界：`GitPublishOperation`, `CodeCommitPushControlProps`, `operationIncludesCommit`, `operationIncludesPush`, `CodeCommitPushControl`, `timer`, `disposed`, `currentBranch`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { CheckCircle2, LoaderCircle, Plus, Upload, X } from 'lucide-react';`；`import type { ProjectInfo } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L1-L429)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx`**
- 源码声明的类型、组件或调用边界：`CodeEnvironmentPanelProps`, `CodeEnvironmentPanel`, `stats`, `loading`, `currentUnavailable`, `unavailable`, `repoIsParentOfProject`, `repoRoot`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { FileDiff } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import type { ProjectInfo } from '../../types';`；`import { CodeBranchSelector } from './CodeBranchSelector';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx#L1-L63)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeReviewPanel.tsx`**
- 源码声明的类型、组件或调用边界：`DiffViewMode`, `DiffLineKind`, `RenderedDiffLine`, `FileTreeFile`, `FileTreeDirectory`, `FileTreeNode`, `MutableFileTreeDirectory`, `fileTreeCollator`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { Check, ChevronDown, ChevronRight, ChevronUp, FileCode2, Folder, LoaderCircle, Search } from`；`import CollapseAllIcon from '../../assets/collapse-all.svg?react';`；
  - `import ExpandAllIcon from '../../assets/expand-all.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeReviewPanel.tsx#L1-L807)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/codeTurnChangeEvents.ts`**
- 源码声明的类型、组件或调用边界：`CodeTurnChangeEvent`, `CodeTurnChangeListener`, `listeners`, `emitCodeTurnChange`, `subscribeCodeTurnChange`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/codeTurnChangeEvents.ts#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/codeTurnDiffBinding.ts`**
- 源码声明的类型、组件或调用边界：`isUserFacingTeamEvent`, `jsonStr`, `payload`, `event`, `type`, `fromMember`, `toMember`, `isP2PToUser`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Message } from '../../types';`；`import type { GitTurnDiff } from './types';`；`import { latestModifiedTurn } from './turnChangeState.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/codeTurnDiffBinding.ts#L1-L159)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/gitClient.ts`**
- 源码声明的类型、组件或调用边界：`gitClient`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../../services/webClient';`；`import type { GitCommitResult, GitPushResult, GitRepoStatus, GitTurnDiff, GitTurnDiffList, ProjectGi`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/gitClient.ts#L1-L103)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts`**
- 源码声明的类型、组件或调用边界：`GitPublishOperation`, `defaultCommitMessage`, `remoteNames`, `names`, `ERROR_MESSAGES`, `gitPublishErrorMessage`, `webError`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WebError } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts#L1-L34)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/gitWatchClient.ts`**
- 源码声明的类型、组件或调用边界：`EventHandler`, `StateHandler`, `PendingRequest`, `DEFAULT_TIMEOUT_MS`, `MAX_RECONNECT_DELAY_MS`, `buildGitWsUrl`, `configuredBase`, `protocol`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WebConnectionState, WebError, WsEvent, WsResponse } from '../../types';`；`import { getWsBase } from '../../utils/env';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/gitWatchClient.ts#L1-L219)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/turnChangeState.ts`**
- 源码声明的类型、组件或调用边界：`TurnChangeResultIdentity`, `turnDiffKey`, `hasFileChanges`, `latestModifiedTurn`, `latest`, `turn`, `updateTurnChangeStatus`, `matches`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WebError } from '../../types';`；`import type { GitTurnChangeAction, GitTurnDiff } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/turnChangeState.ts#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/types.ts`**
- 源码声明的类型、组件或调用边界：`GitRepoStatus`, `GitDiffHunk`, `GitDiffFile`, `GitDiffSummary`, `GitDiffStats`, `GitTurnDiff`, `GitTurnDiffList`, `GitTurnChangeAction`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/types.ts#L1-L202)。
- **`jiuwenswarm/channels/web/frontend/src/features/code-mode/useCodeGitDiffWatch.ts`**
- 源码声明的类型、组件或调用边界：`UseCodeGitDiffWatchOptions`, `CodeGitDiffWatchController`, `errorMessage`, `eventPayload`, `revisionTimestamp`, `timestamp`, `acceptRevision`, `previous`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import type { WebConnectionState, WebError, WsEvent } from '../../types';`；`import { gitClient } from './gitClient';`；`import { gitWatchClient } from './gitWatchClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/useCodeGitDiffWatch.ts#L1-L399)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-code-mode/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
