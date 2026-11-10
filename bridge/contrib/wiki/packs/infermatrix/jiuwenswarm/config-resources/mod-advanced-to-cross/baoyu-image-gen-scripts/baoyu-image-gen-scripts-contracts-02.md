---
name: baoyu-image-gen-scripts-contracts-02
description: baoyu-image-gen-scripts 源码接口记录 02（baoyu-image-gen-scripts 脚本共两页之一）：覆盖 google.ts、jimeng.ts、minimax.ts、openai.ts、openrouter.ts、replicate.ts、seedream.ts、zai.ts 等共 9 个文件
metadata:
  scope: 只收 baoyu-image-gen-scripts 下这 9 个源文件的逐文件接口记录；本目录入口归 baoyu-image-gen-scripts-overview，其余文件的接口记录归 baoyu-image-gen-scripts-contracts-01
---
# baoyu-image-gen-scripts 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/google.ts`**
- 源码声明的类型、组件或调用边界：`GOOGLE_MULTIMODAL_MODELS`, `GOOGLE_IMAGEN_MODELS`, `getDefaultModel`, `normalizeGoogleModelId`, `isGoogleMultimodal`, `normalized`, `isGoogleImagen`, `normalized`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import { execFileSync } from "node:child_process";`；`import type { CliArgs } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/google.ts#L1-L351)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/jimeng.ts`**
- 源码声明的类型、组件或调用边界：`JimengSizePreset`, `getDefaultModel`, `getAccessKey`, `getSecretKey`, `getRegion`, `getBaseUrl`, `resolveEndpoint`, `baseUrl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CliArgs } from "../types";`；`import * as crypto from "node:crypto";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/jimeng.ts#L1-L467)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/minimax.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_MODEL`, `MAX_REFERENCE_IMAGE_BYTES`, `SUPPORTED_ASPECT_RATIOS`, `MinimaxSubjectReference`, `MinimaxRequestBody`, `MinimaxResponse`, `getDefaultModel`, `getApiKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/minimax.ts#L1-L220)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/openai.ts`**
- 源码声明的类型、组件或调用边界：`getDefaultModel`, `OpenAIImageResponse`, `parseAspectRatio`, `match`, `w`, `h`, `SizeMapping`, `OpenAIGenerationsBody`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs, OpenAIImageApiDialect } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/openai.ts#L1-L444)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/openrouter.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_MODEL`, `COMMON_ASPECT_RATIOS`, `GEMINI_EXTENDED_ASPECT_RATIOS`, `OpenRouterImageEntry`, `OpenRouterMessagePart`, `OpenRouterResponse`, `getDefaultModel`, `normalizeModelId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/openrouter.ts#L1-L372)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/replicate.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_MODEL`, `SYNC_WAIT_SECONDS`, `POLL_INTERVAL_MS`, `MAX_POLL_MS`, `DOCUMENTED_REPLICATE_ASPECT_RATIOS`, `ReplicateModelFamily`, `PixelSize`, `Seedream45Size`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/replicate.ts#L1-L616)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/seedream.ts`**
- 源码声明的类型、组件或调用边界：`SeedreamModelFamily`, `SeedreamRequestImage`, `SeedreamRequestBody`, `SeedreamImageResponse`, `getDefaultModel`, `getApiKey`, `getBaseUrl`, `parsePixelSize`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/seedream.ts#L1-L341)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/zai.ts`**
- 源码声明的类型、组件或调用边界：`ZaiModelFamily`, `ZaiRequestBody`, `ZaiResponse`, `DEFAULT_MODEL`, `GLM_MAX_PIXELS`, `LEGACY_MAX_PIXELS`, `GLM_SIZE_STEP`, `LEGACY_SIZE_STEP`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CliArgs, Quality } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/zai.ts#L1-L306)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/types.ts`**
- 源码声明的类型、组件或调用边界：`Provider`, `Quality`, `OpenAIImageApiDialect`, `ResponseFormat`, `CliArgs`, `BatchTaskInput`, `BatchFile`, `ExtendConfig`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/types.ts#L1-L97)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/baoyu-image-gen-scripts/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
