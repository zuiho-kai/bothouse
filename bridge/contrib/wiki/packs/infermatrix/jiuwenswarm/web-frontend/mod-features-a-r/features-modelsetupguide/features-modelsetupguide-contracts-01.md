---
name: features-modelsetupguide-contracts-01
description: features-modelsetupguide 源码接口 01：src/features/modelSetupGuide 下 ModelSetupGuide.tsx（引导步骤、聚光框矩形与目标选择器）与 modelSetupGuideState.ts（isSetupGuideEnabled 及启停取值集合）两个文件的声明与导入依赖
metadata:
  scope: 只收这两个文件的静态声明记录，不证明运行行为；目录入口归 features-modelsetupguide-overview
---
# features-modelsetupguide 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/ModelSetupGuide.tsx`**
- 源码声明的类型、组件或调用边界：`ModelSetupGuideStep`, `ModelSetupGuideProps`, `SpotlightRect`, `TARGET_SELECTORS`, `toSpotlightRect`, `rect`, `padding`, `left`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { TeamMemberAvatar } from '../../components/TeamMemberAvatar';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/ModelSetupGuide.tsx#L1-L279)。
- **`jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/modelSetupGuideState.ts`**
- 源码声明的类型、组件或调用边界：`ENABLED_VALUES`, `DISABLED_VALUES`, `isSetupGuideEnabled`, `normalized`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/modelSetupGuide/modelSetupGuideState.ts#L1-L17)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-modelsetupguide/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
