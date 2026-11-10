---
name: baoyu-image-gen-scripts-contracts-01
description: baoyu-image-gen-scripts 源码接口记录 01（baoyu-image-gen-scripts 脚本共两页之一）：覆盖 build-batch.ts、cache.ts、logger.ts、main.ts、parser.ts、spawn.ts、types.ts、validator.ts 等共 13 个文件
metadata:
  scope: 只收 baoyu-image-gen-scripts 下这 13 个源文件的逐文件接口记录；本目录入口归 baoyu-image-gen-scripts-overview，其余文件的接口记录归 baoyu-image-gen-scripts-contracts-02
---
# baoyu-image-gen-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/build-batch.ts`**
- 源码声明的类型、组件或调用边界：`CliArgs`, `OutlineEntry`, `PromptReference`, `printUsage`, `parseArgs`, `args`, `i`, `current`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import process from "node:process";`；`import { readdir, readFile, writeFile } from "node:fs/promises";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/build-batch.ts#L1-L239)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/cache.ts`**
- 源码声明的类型、组件或调用边界：`cacheKey`, `h`, `r`, `lookupCache`, `entry`, `s`, `storeCache`, `entry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createHash } from "node:crypto";`；`import { mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";`；`import { existsSync, openSync, closeSync } from "node:fs";`；`import path from "node:path";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/cache.ts#L1-L80)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/logger.ts`**
- 源码声明的类型、组件或调用边界：`LogEntry`, `JsonLogger`, `entry`, `line`, `jsonExtras`, `entries`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { appendFile, mkdir } from "node:fs/promises";`；`import path from "node:path";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/logger.ts#L1-L39)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/main.ts`**
- 源码声明的类型、组件或调用边界：`CliOptions`, `HELP`, `SHELL_METACHAR`, `log`, `result`, `err`, `out`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readFile, mkdir, copyFile, stat } from "node:fs/promises";`；`import { homedir } from "node:os";`；`import path from "node:path";`；`import process from "node:process";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/main.ts#L1-L332)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/parser.ts`**
- 源码声明的类型、组件或调用边界：`parseEventStream`, `lines`, `threadId`, `agentMessage`, `usage`, `toolCallsById`, `line`, `event`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CodexRunResult, ToolCall, TokenUsage } from "./types.ts";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/parser.ts#L1-L64)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/spawn.ts`**
- 源码声明的类型、组件或调用边界：`CodexRunResult`, `SpawnInput`, `runCodexExec`, `start`, `logDir`, `rawLogPath`, `args`, `img`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { spawn } from "node:child_process";`；`import { writeFile, mkdtemp } from "node:fs/promises";`；`import { tmpdir } from "node:os";`；`import path from "node:path";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/spawn.ts#L1-L81)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/types.ts`**
- 源码声明的类型、组件或调用边界：`CliOptions`, `ToolCall`, `TokenUsage`, `CodexRunResult`, `GenerateResult`, `ErrorKind`, `RETRYABLE`, `GenError`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/types.ts#L1-L79)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/validator.ts`**
- 源码声明的类型、组件或调用边界：`PNG_MAGIC`, `codexHome`, `verifyImageGenWasInvoked`, `dir`, `entries`, `pngs`, `hasImageGenEvidence`, `verifyOutput`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { stat, readdir } from "node:fs/promises";`；`import { homedir } from "node:os";`；`import path from "node:path";`；`import { GenError } from "./types.ts";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/codex-imagegen/validator.ts#L1-L56)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/main.ts`**
- 源码声明的类型、组件或调用边界：`ProviderModule`, `PreparedTask`, `TaskResult`, `ProviderRateLimit`, `LoadedBatchTasks`, `MAX_ATTEMPTS`, `DEFAULT_MAX_WORKERS`, `POLL_WAIT_MS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import process from "node:process";`；`import { homedir } from "node:os";`；`import { fileURLToPath } from "node:url";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/main.ts#L1-L1293)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/agnes.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_MODEL`, `DEFAULT_BASE_URL`, `DEFAULT_SIZE`, `AgnesResponse`, `getDefaultModel`, `getApiKey`, `key`, `getBaseUrl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { readFile } from "node:fs/promises";`；`import path from "node:path";`；`import type { CliArgs } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/agnes.ts#L1-L175)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/azure.ts`**
- 源码声明的类型、组件或调用边界：`OpenAIImageResponse`, `AzureEndpoint`, `DEFAULT_AZURE_API_VERSION`, `AZURE_EDIT_IMAGE_EXTENSIONS`, `parseAzureBaseURL`, `parsed`, `trimmedPath`, `deploymentMatch`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs } from "../types";`；`import { getOpenAISize, extractImageFromResponse } from "./openai.ts";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/azure.ts#L1-L192)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/codex-cli.ts`**
- 源码声明的类型、组件或调用边界：`PROVIDER_FILE`, `SCRIPTS_DIR`, `BUNDLED_WRAPPER`, `WrapperOkResult`, `WrapperErrorResult`, `WrapperResult`, `getDefaultModel`, `getDefaultOutputExtension`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { spawn } from "node:child_process";`；`import { fileURLToPath } from "node:url";`；`import { tmpdir } from "node:os";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/codex-cli.ts#L1-L197)。
- **`jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/dashscope.ts`**
- 源码声明的类型、组件或调用边界：`DashScopeModelFamily`, `DashScopeModelSpec`, `DEFAULT_MODEL`, `MIN_QWEN_2_TOTAL_PIXELS`, `MAX_QWEN_2_TOTAL_PIXELS`, `SIZE_STEP`, `QWEN_NEGATIVE_PROMPT`, `QWEN_2_TARGET_PIXELS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import path from "node:path";`；`import { readFile } from "node:fs/promises";`；`import type { CliArgs, Quality } from "../types";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/dashscope.ts#L1-L625)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/baoyu-image-gen-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
