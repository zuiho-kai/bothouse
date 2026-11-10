---
name: components-interactionslot-contracts-01
description: components-interactionslot 源码接口与集成边界 01：web/frontend/src/components/InteractionSlot 下 AuthorizationPrompt.tsx、InteractionPrompt.tsx、QaSummaryCard.tsx、index.tsx、permissionTextI18n.ts、promptRouting.ts、qaSummary.ts 共 7 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 7 个前端文件的静态声明，不证明运行行为；入口说明归 components-interactionslot-overview
---
# components-interactionslot 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/AuthorizationPrompt.tsx`**
- 源码声明的类型、组件或调用边界：`AuthSemantic`, `AuthorizationPromptProps`, `ACTION_ORDER`, `PROSE_CLS`, `ResolvedAction`, `optionSemantic`, `resolveAuthorizationActions`, `primary`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import ReactMarkdown from 'react-markdown';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/AuthorizationPrompt.tsx#L1-L327)。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/InteractionPrompt.tsx`**
- 源码声明的类型、组件或调用边界：`QaSummaryData`, `CUSTOM_OPTION_LABEL`, `MAX_PAGES`, `SKIPPED_ANSWER_TEXT`, `CANCELLED_ANSWER_TEXT`, `InteractionPromptProps`, `PageState`, `emptyPage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import ReactMarkdown from 'react-markdown';`；`import remarkGfm from 'remark-gfm';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/InteractionPrompt.tsx#L1-L445)。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/QaSummaryCard.tsx`**
- 源码声明的类型、组件或调用边界：`QaSummaryCardProps`, `QaSummaryCard`, `data`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { FileText } from 'lucide-react';`；`import { parseQaSummaryContent } from './qaSummary';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/QaSummaryCard.tsx#L1-L52)。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/index.tsx`**
- 源码声明的类型、组件或调用边界：`InteractionSlotProps`, `InteractionSlot`, `activeSessionId`, `pending`, `kind`, `isAuth`, `variant`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useChatStore } from '../../stores';`；`import type { UserAnswer } from '../../types';`；`import { AuthorizationPrompt } from './AuthorizationPrompt';`；`import { InteractionPrompt } from './InteractionPrompt';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/index.tsx#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/permissionTextI18n.ts`**
- 源码声明的类型、组件或调用边界：`EXACT_MAP`, `RISK_LABEL_MAP`, `RISK_TITLE_RE`, `HEADER_PREFIX_RE`, `TOOL_AUTH_FALLBACK_RE`, `modeSuffixMatch`, `prefixMatch`, `label`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/permissionTextI18n.ts#L1-L132)。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/promptRouting.ts`**
- 源码声明的类型、组件或调用边界：`PromptKind`, `AUTHORIZATION_SOURCES`, `isEvolutionPrompt`, `rid`, `isPlanApprovalPrompt`, `isSkillPackagePrompt`, `classifyPrompt`, `firstOptions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AskUserQuestionPayload } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/promptRouting.ts#L1-L94)。
- **`jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/qaSummary.ts`**
- 源码声明的类型、组件或调用边界：`QA_SUMMARY_PREFIX`, `QaSummaryItem`, `QaSummaryData`, `MASKED_ANSWER`, `SENSITIVE_QUESTION_MARKERS`, `maskSensitiveSummary`, `buildQaSummaryContent`, `isQaSummaryContent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/qaSummary.ts#L1-L68)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-interactionslot/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
