---
name: feature-depth-frontend-incremental-lint-gate
description: 增量 ESLint 门禁实现深读：变更 TS/TSX 逐个基线/当前 lintText 与 multiset 抵扣、ESLint cwd 与 reportUnusedDisableDirectives、git 子进程与路径前缀换算、git show 仅对基线缺失容错、放行存量诊断但错误与警告一律拦截的取舍、--base 参数与非零退出
metadata:
  scope: 只收 lint-changed.mjs 的实现级证据与设计推断；脚本整体职责、调用方式与验证入口归 feature-frontend-incremental-lint-gate
---
# 增量 ESLint 门禁（相对基线只报新增诊断）：实现深读

## 现状

- [[feature-frontend-incremental-lint-gate]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **变更 TS/TSX 文件逐个做基线/当前 lintText 对比，按 multiset 扣除既有诊断** 对每个变更的 .ts/.tsx 文件（须位于 cwd 下且未被 ESLint ignore），用 git show 取基线内容，分别 lintText 基线与当前文本；当前诊断按 [ruleId, severity, message] 键与基线计数逐条抵扣，剩余的新诊断重算 error/warning 计数后收集到 introduced。
- 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L26–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L26-L26),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L28–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L28-L48),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L49–L72](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L49-L72)
- **ESLint 以 frontend 目录为 cwd 且 reportUnusedDisableDirectives: 'error'；其余规则按该 cwd 下的默认配置解析** cwd 固定为脚本目录的上一级（frontend 根），git 与路径解析均用它；new ESLint({ cwd, reportUnusedDisableDirectives: 'error' }) 显式开启未使用 disable 指令报 error，ESLint 配置文件本身未在脚本中显式指定，由 ESLint 在该 cwd 下的默认解析决定。
- 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L9–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L9-L10),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L22–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L22-L22)
- **依赖 git 子进程与项目内 eslint 包，路径换算受仓库布局约束** 通过 execFileSync 调 git（rev-parse/diff/ls-files/show），ESLint 类直接 import 自 'eslint' 包并以 frontend 为 cwd，因此使用 frontend 自己的 lint 配置；git diff 输出仓库相对路径而 ls-files 输出 cwd 相对路径，脚本用 prefix 剥离来统一两者。
- 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L1–L5](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L1-L5),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L16–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L16-L22),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L28–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L28-L31)
- **git show 仅对'基线中不存在该路径'容错，其余 Git 错误原样抛出** 读取基线内容包在 try/catch 中：stderr 含 'does not exist in' 或 'exists on disk, but not in' 时视为新文件（previous 保持 ''），其他 Git 失败 rethrow 而不弱化检查；非 frontend 内或被 ESLint ignore 的文件直接 continue 跳过。
- 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L33–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L33-L46)
- **增量门禁放行存量诊断，但错误与警告一律拦截** 设计推断（非作者历史意图）：
- 收益：基线已有的诊断不阻塞本次检查（existing 计数仍可见，npm run lint 保留全量视图）；成本：warnings 也会失败，且诊断按 [ruleId, severity, message] 三元组抵消——同一规则同一文案的基线诊断可抵消本次同键新增，位置变化不区分（推断：键中不含行号）。
- 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L7–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L7-L8),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L26–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L26-L26),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L54–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L54-L61)
- **lint-changed 脚本的参数契约与非零退出（有新增诊断时）** 可选参数仅 `--base <commit>`，缺省 `HEAD`，由 `git rev-parse --verify <ref>^{commit}` 解析；参数形式不符时抛出 Usage 错误终止。循环结束后若 introduced 非空，打印 stylish 格式结果并将 `process.exitCode` 置 1（L75-77），随后顺序输出 checked/新增/既有计数摘要（L79-81）；该摘要仅在执行到达此处时打印——参数错误（L13）或被重新抛出的 Git 失败（L44）会提前终止。
- 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L11–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L11-L15),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L75–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L75-L81),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L36–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L36-L45)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-frontend-incremental-lint-gate.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L1-L5；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L16-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L28-L31；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L33-L46
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L7-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L26-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L54-L61；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L9-L10
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L22-L22；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L28-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L49-L72；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L11-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L75-L81；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L36-L45
- 源页字段（feature）：frontend-incremental-lint-gate
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs
