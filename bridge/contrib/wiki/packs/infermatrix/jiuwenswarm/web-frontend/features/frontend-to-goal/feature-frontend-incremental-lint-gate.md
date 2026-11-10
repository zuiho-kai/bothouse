---
name: feature-frontend-incremental-lint-gate
description: 前端增量 ESLint 门禁 lint-changed.mjs：以 git diff 加未跟踪文件为变更集、基线与当前 lintText 按 ruleId+severity+message 多重集相减的控制流，--base 参数与退出契约，reportUnusedDisableDirectives 等固定行为，验证入口与取舍推断（新增 warning 也失败、Git 错误文案匹配）
metadata:
  scope: 只收 lint-changed.mjs 的现状说明与设计推断（控制流、验证入口、支持的行为、取舍、可配置项、调用与退出契约）；git show 容错、抵消键与 cwd 的逐点实现证据归 feature-depth-frontend-incremental-lint-gate
---
# 前端增量 ESLint 门禁（lint-changed.mjs）

## 现状

- **数据与控制流**
- 脚本固定以前端目录为 cwd（脚本父目录，第 9 行），先取仓库根并计算前端相对前缀。变更集合 = `git diff --name-only --diff-filter=ACMR <base>` 加上 `git ls-files --others --exclude-standard`（未跟踪新文件）；由于两种 Git 命令路径基准不同，统一剥离前缀转为前端相对路径（第 29-30 行注释说明）。过滤条件：仅 `.ts/.tsx`、绝对路径仍落在 cwd 内、且不被 ESLint ignore。
  - 对每个文件读取当前内容，用 `git show base:<path>` 取基线版本，分别 `lintText` 后按诊断键（ruleId+severity+message 的 JSON 元组）做多重集相减：基线中每出现一次即抵消一条当前同类诊断，剩余的视为新增。非预期 Git 错误（非"基线中不存在该路径"）直接抛出，避免削弱检查。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L16–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L16-L21),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L28–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L28-L48),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L49–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L49-L61)
- **验证入口**
- 所提供的证据范围内没有该脚本的测试或 CI 调用；脚本自身带有运行时防御可作为部分行为验证点：参数校验抛 Usage 错误（第 12-14 行）、`git show` 失败时按 stderr 文案区分"基线无此文件"与真实 Git 错误（第 39-45 行）。摘要行输出了 checked/introduced/existing 计数，便于人工核对一次运行的行为。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L11–L14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L11-L14),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L36–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L36-L45)
- **支持的行为**
- 变更文件集合来自 `git diff --name-only --diff-filter=ACMR <base>` 加上 `git ls-files --others --exclude-standard`（未跟踪文件），因此新文件也纳入检查；仅处理 `.ts/.tsx`、路径仍落在前端目录内且未被 ESLint ignore 的文件。对每个文件分别 lint 基线内容（`git show base:<path>`）与当前内容，按诊断键做多重集相减，只保留新增诊断；基线中不存在该文件时 previous 为空字符串，随后仍执行同样的 lint 与抵消流程。
  - 任何新增 error 或 warning 都导致失败，既有诊断只计数不阻断。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L18–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L18-L21),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L34–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L34-L61),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L7–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L7-L8)
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 可见的取舍：以 ruleId+severity+message 为抵消键、不比较位置，使诊断在文件内移动仍可被基线抵消，但同一文件中同文案诊断数量增加时只能按条数抵消；同时该门禁对新增 warning 也失败（注释明确说明既有诊断仍可通过 `npm run lint` 查看），比仅拦 error 的做法更严格。基线获取失败时按 stderr 文案区分"基线无此文件"与其它 Git 错误，后者直接抛出而非削弱检查——这是保守处理，但依赖 Git 错误文案的字符串匹配。上述意图性判断（如与常见门禁的比较）为推断，未见于文档。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L26–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L26-L26),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L36–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L36-L45),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L7–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L7-L8)
- **可配置项与固定行为设置**
- 唯一可配置项是 CLI 参数 `--base <commit>`（缺省 `HEAD`），决定与哪个基线版本比较。其余设置为脚本内固定值：`ESLint` 实例以前端目录（脚本父目录）为 `cwd`，并开启 `reportUnusedDisableDirectives: 'error'`，即未生效的禁用注释按 error 报告；具体 lint 规则集由该实例解析，本次证据未展示配置文件本身。诊断抵消键固定为 `[ruleId, severity, message]` 的 JSON 元组（第 26 行），既非可配置项，也不含位置信息。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L9–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L9-L15),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L22–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L22-L26)
- **调用契约与退出行为**
- 入口为 Node 脚本，通过 `npm run lint:changed -- [--base <commit>]` 调用。唯一参数是 `--base <commit>`（缺省 `HEAD`），参数形式不符时抛出 Usage 错误并终止（第 12-14 行）；基线 commit 由 `git rev-parse --verify` 解析，无效引用会使 Git 命令抛错。
  - 脚本复用 ESLint Node API（`new ESLint(...)`、`lintText`、`isPathIgnored`、`loadFormatter('stylish')`）对基线与当前内容分别执行 lint，只保留新增诊断。退出契约：存在新增 error 或 warning 时打印 stylish 格式结果并将 `process.exitCode` 置 1（第 75-78 行）；
  - 随后输出 checked/新增/既有计数的摘要行（第 79-81 行），该摘要仅在脚本运行到循环之后（包括诊断失败时）打印——参数错误（第 12-13 行）或被重新抛出的 Git 失败（第 39-44 行）会在此之前终止执行，不会输出摘要。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L11–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L11-L15),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L22–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L22-L22),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L36–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L36-L45),
  - [jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L75–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs#L75-L81)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-frontend-incremental-lint-gate.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L16-L21；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L28-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L49-L61；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L11-L14
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L36-L45；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L18-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L34-L61；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L7-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L26-L26；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L9-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L22-L26；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L11-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L22-L22；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs:L75-L81
- 源页字段（feature）：frontend-incremental-lint-gate
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/scripts/lint-changed.mjs
