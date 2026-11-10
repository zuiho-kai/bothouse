---
name: features-onlineskillsearchpanel-contracts-01
description: features-onlineskillsearchpanel 源码接口 01：src/features/OnlineSkillSearchPanel/index.tsx 一个文件的声明（OnlineSource、LoadState、OnlineSearchItem、OnlineSearchResponse、InstallResponse 等）与导入依赖
metadata:
  scope: 只收 index.tsx 一个文件的静态声明记录，不证明运行行为；目录入口归 features-onlineskillsearchpanel-overview
---
# features-onlineskillsearchpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/OnlineSkillSearchPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`OnlineSource`, `LoadState`, `OnlineSearchItem`, `onlineItemKey`, `onlineSourceLabel`, `OnlineSourceStatus`, `OnlineSearchResponse`, `InstallResponse`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { webRequest } from '../../services/webClient';`；`import { getSkillAvatar } from '../../utils/skillAvatar';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/OnlineSkillSearchPanel/index.tsx#L1-L570)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-onlineskillsearchpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
