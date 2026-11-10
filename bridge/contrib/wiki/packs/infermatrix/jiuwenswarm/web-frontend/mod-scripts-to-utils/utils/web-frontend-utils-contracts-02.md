---
name: web-frontend-utils-contracts-02
description: web-frontend utils 源码接口与集成边界 02：src/utils 下 skillPackageFile、svgDimensions、swarmflowAdvisory、symphonyCommandDisplay、teamMemberAvatar、textEditCommands、timestamp、tts、userId、uuid、writeClipboard、wsEventDedup 共十二个工具文件的静态声明与导入
metadata:
  scope: 只收字母序后十二个 utils 文件的静态声明索引与导入，不证明运行行为；chatFinalProtocol 至 skillNetUrl 归 web-frontend-utils-contracts-01，入口说明归 web-frontend-utils-overview
---
# utils 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/utils/skillPackageFile.ts`**
- 源码声明的类型、组件或调用边界：`SkillPackageFileLike`, `isSkillPackageFile`, `candidates`, `candidate`, `base`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/skillPackageFile.ts#L1-L23)。
- **`jiuwenswarm/channels/web/frontend/src/utils/svgDimensions.ts`**
- 源码声明的类型、组件或调用边界：`parseSvgViewBox`, `viewBox`, `parts`, `parsePixelAttribute`, `trimmed`, `n`, `getSvgNaturalWidth`, `viewBox`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/svgDimensions.ts#L1-L62)。
- **`jiuwenswarm/channels/web/frontend/src/utils/swarmflowAdvisory.ts`**
- 源码声明的类型、组件或调用边界：`SWARMFLOW_ADVISORY_SPAN`, `stripSwarmflowAdvisory`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/swarmflowAdvisory.ts#L1-L12)。
- **`jiuwenswarm/channels/web/frontend/src/utils/symphonyCommandDisplay.ts`**
- 源码声明的类型、组件或调用边界：`SymphonyCommandAction`, `SymphonyCommandLabel`, `VALUE_OPTIONS`, `SYMPHONY_COMMAND_TOOLS`, `tokenizeShell`, `tokens`, `current`, `quote`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`path: path && path !== '.' && path !== '/' ? shorten(path) : undefined,`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/symphonyCommandDisplay.ts#L1-L474)。
- **`jiuwenswarm/channels/web/frontend/src/utils/teamMemberAvatar.ts`**
- 源码声明的类型、组件或调用边界：`TEAM_MEMBER_AVATARS`, `HUMAN_MEMBER_AVATARS`, `CLI_AGENT_AVATARS`, `CLI_AGENT_AVATAR_BACKGROUND`, `TEAM_MEMBER_BACKGROUND_COLORS`, `FNV_OFFSET_BASIS`, `FNV_PRIME`, `TeamMemberAvatarKind`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import teamLeaderAvatar from '../assets/teamleader.svg';`；`import userInTeamAvatar from '../assets/user-in-team.svg';`；`import teamAvatar2 from '../assets/Team-2.svg';`；`import teamAvatar3 from '../assets/Team-3.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/teamMemberAvatar.ts#L1-L191)。
- **`jiuwenswarm/channels/web/frontend/src/utils/textEditCommands.ts`**
- 源码声明的类型、组件或调用边界：`DesktopLocalFilesEventDetail`, `NON_TEXT_INPUT_TYPES`, `SELECTION_INPUT_TYPES`, `TextEditTarget`, `isTextInputElement`, `type`, `isContentEditableElement`, `value`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/textEditCommands.ts#L1-L373)。
- **`jiuwenswarm/channels/web/frontend/src/utils/timestamp.ts`**
- 源码声明的类型、组件或调用边界：`VALID_YEAR_MIN`, `VALID_YEAR_MAX`, `yearOfEpochMs`, `looksLikePlausibleEpochMs`, `year`, `normalizeNumericEpoch`, `asMillis`, `parseTimestampToMs`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/timestamp.ts#L1-L67)。
- **`jiuwenswarm/channels/web/frontend/src/utils/tts.ts`**
- 源码声明的类型、组件或调用边界：`TtsResponse`, `TTS_STOP_EVENT`, `CODE_BLOCK_RE`, `INLINE_CODE_RE`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../services/webClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/tts.ts#L1-L139)。
- **`jiuwenswarm/channels/web/frontend/src/utils/userId.ts`**
- 源码声明的类型、组件或调用边界：`USER_ID_STORAGE_KEY`, `readFromQuery`, `raw`, `readFromStorage`, `raw`, `writeToStorage`, `resolveUserId`, `fromQuery`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/userId.ts#L1-L66)。
- **`jiuwenswarm/channels/web/frontend/src/utils/uuid.ts`**
- 源码声明的类型、组件或调用边界：`generateUuidV4`, `bytes`, `hex`, `prefixedMessageId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/uuid.ts#L1-L31)。
- **`jiuwenswarm/channels/web/frontend/src/utils/writeClipboard.ts`**
- 源码声明的类型、组件或调用边界：`writeClipboard`, `exec`, `el`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/writeClipboard.ts#L1-L48)。
- **`jiuwenswarm/channels/web/frontend/src/utils/wsEventDedup.ts`**
- 源码声明的类型、组件或调用边界：`stringifyPayloadForDedup`, `serialized`, `makeEventDedupKey`, `payloadSessionId`, `payloadEventType`, `payloadRequestId`, `nestedToolCall`, `toolCallId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/utils/wsEventDedup.ts#L1-L66)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/utils/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
