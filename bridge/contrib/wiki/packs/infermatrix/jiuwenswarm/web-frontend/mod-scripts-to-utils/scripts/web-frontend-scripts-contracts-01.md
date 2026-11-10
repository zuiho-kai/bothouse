---
name: web-frontend-scripts-contracts-01
description: web-frontend scripts 源码接口与集成边界 01：前端 scripts 下 lint-changed.mjs 与七个 test-*.mjs 测试脚本（a2ui-action-defaults、a2ui-interaction-guards、input-area-permission-merge、permission-answer-transport、project-create-error-localization、skill-package-prompt、team-a2ui-render-path），以及 jiuwenswarm/scripts 的 generate-agent-folders.js、watch-folders.js 共十个脚本的静态声明与导入
metadata:
  scope: 只收这十个脚本文件的静态声明索引与导入，不证明运行行为；入口说明归 web-frontend-scripts-overview
---
# scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs`**
- 源码声明的类型、组件或调用边界：`cwd`, `git`, `args`, `base`, `repoRoot`, `prefix`, `changed`, `eslint`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { execFileSync } from 'node:child_process';`；`import { readFile } from 'node:fs/promises';`；`import path from 'node:path';`；`import { fileURLToPath } from 'node:url';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L1-L81)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-a2ui-action-defaults.mjs`**
- 源码声明的类型、组件或调用边界：`root`, `sourceUrl`, `helperUrl`, `tempDir`, `transpileTsModule`, `source`, `transpiled`, `outputPath`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import assert from 'node:assert/strict';`；`import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';`；`import { tmpdir } from 'node:os';`；`import { join } from 'node:path';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-a2ui-action-defaults.mjs#L1-L541)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-a2ui-interaction-guards.mjs`**
- 源码声明的类型、组件或调用边界：`root`, `tempDir`, `moduleMap`, `rewriteLocalImports`, `transpileTsModule`, `sourceUrl`, `source`, `transpiled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import assert from 'node:assert/strict';`；`import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';`；`import { tmpdir } from 'node:os';`；`import { join } from 'node:path';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-a2ui-interaction-guards.mjs#L1-L150)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-input-area-permission-merge.mjs`**
- 源码声明的类型、组件或调用边界：`root`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { build } from 'esbuild';`；`import { spawnSync } from 'node:child_process';`；`import { fileURLToPath } from 'node:url';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-input-area-permission-merge.mjs#L1-L57)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-permission-answer-transport.mjs`**
- 源码声明的类型、组件或调用边界：`root`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { build } from 'esbuild';`；`import { spawnSync } from 'node:child_process';`；`import { fileURLToPath } from 'node:url';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-permission-answer-transport.mjs#L1-L35)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-project-create-error-localization.mjs`**
- 源码声明的类型、组件或调用边界：`sourcePath`, `source`, `compiled`, `moduleUrl`, `zh`, `en`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import assert from 'node:assert/strict';`；`import { readFile } from 'node:fs/promises';`；`import { transform } from 'esbuild';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-project-create-error-localization.mjs#L1-L32)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-skill-package-prompt.mjs`**
- 源码声明的类型、组件或调用边界：`root`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { build } from 'esbuild';`；`import { spawnSync } from 'node:child_process';`；`import { fileURLToPath } from 'node:url';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-skill-package-prompt.mjs#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/scripts/test-team-a2ui-render-path.mjs`**
- 源码声明的类型、组件或调用边界：`root`, `sourceUrl`, `source`, `between`, `start`, `end`, `teamLeaderRenderer`, `teamEventBranch`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import assert from 'node:assert/strict';`；`import { readFile } from 'node:fs/promises';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/test-team-a2ui-render-path.mjs#L1-L65)。
- **`jiuwenswarm/scripts/generate-agent-folders.js`**
- 源码声明的类型、组件或调用边界：`fs`, `path`, `scriptDir`, `envRoot`, `agentFromEnv`, `packageAgentFromResources`, `agentRoot`, `outputPath`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require('fs');`；`const path = require('path');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/scripts/generate-agent-folders.js#L1-L112)。
- **`jiuwenswarm/scripts/watch-folders.js`**
- 源码声明的类型、组件或调用边界：`path`, `generate`, `child`, `chokidar`, `envWorkspace`, `homeDir`, `userAgentDir`, `fallbackRepoAgentDir`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const { spawn } = require('child_process');`；`const path = require('path');`；`const chokidar = require('chokidar');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/scripts/watch-folders.js#L1-L48)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-06
