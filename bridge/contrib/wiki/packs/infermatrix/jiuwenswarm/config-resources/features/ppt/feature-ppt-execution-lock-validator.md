---
name: feature-ppt-execution-lock-validator
description: validate-execution-lock.js 功能概览：验证入口（无测试）、对 validate-evidence-plan 的委托与路径基准差异、逐页契约与 evidence_visual 校验、--phase 与锁文件受检常量、CLI 用法与退出码
metadata:
  scope: 只收 validate-execution-lock.js 及其对 validate-evidence-plan.js 委托的概览；逐方面的实现深读归 feature-depth-ppt-execution-lock-validator
---
# PPT 执行锁（execution-lock.json）语义校验器

## 现状

- **验证入口**
- 在所提供的源码范围内，两个脚本本身就是验证工具（各自可直接作为 CLI 运行并对非法输入返回非零退出码），但没有看到针对这两个校验器自身的单元测试文件。validate-evidence-plan.js 通过 `require.main === module` 守卫同时支持 CLI 与被 require 两种用法（第 132-133 行），这是使其可被测试复用的结构；但所示证据不含任何测试调用，无法断言测试存在与否。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L106–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js#L106-L133`）,
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L16–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L16-L19)
- **分层校验与委托边界**
- 执行锁校验器是编排层：projectRoot 取 lock 文件所在目录，skillRoot 取脚本上级目录；先做参数/位置检查、解析，再校验 template、brand 常量、deck 级策略、逐页契约，最后校验资产与证据引用。version 2 时把证据校验委托给 validateEvidencePlan（传入 phase 与 pageIds），并把子级 errors/warnings 合并进自身输出；version 1 走 legacy 内联 assets 列表并给出迁移告警。
  - 注意：资产路径解析基准不同——内联 assets 相对 lock 所在目录，而 validateEvidencePlan 内部把 projectRoot 定义为 evidence-plan 文件所在目录（validate-evidence-plan.js L27–L28、L41–L42），不一定是 lock 目录；且 skill 目录禁入检查位于两个脚本的 CLI main 中，被 require 调用 validateEvidencePlan 时不执行。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L21–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L21-L23),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L182–L199
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L182-L199`）,
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L26–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js#L26-L36),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L115–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js#L115-L124`）
- **逐页契约与证据引用校验**
- 每页校验 id 形如 `P\d{2,3}` 且唯一、role/rhythm/component_policy/core_message/composition 合法，visual_strategy 的 primary 与 fallback 均须属于策略集且 fallback 不能是 hybrid；
  - fixed-cover/fixed-closing 页 primary 必须 template，standard-content 页 primary 不能 template、必须有 summary，dense/anchor 节奏的 standard-content 页还须 reference_ids（或 reference_waiver）及非 none 的 evidence_visual.kind。页引用的 evidence asset_id 必须已知；
  - 仅当 version 2 走 evidence-plan 时才进一步校验该项归属本页（L239），legacy 内联资产只检查 id 存在（L237）。version 2 要求非空 evidence_plan 路径并把 phase 与 pageIds 传给 validateEvidencePlan 合并其错误；version 1 走内联 assets 校验并警告迁移。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L129–L179
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L129-L179`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L182–L199
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L182-L199`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L235–L246
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L235-L246`）
- **--phase 校验器选项与锁文件中的受检常量**
- --phase 是校验器 CLI 的进程参数（从 process.argv 读取），不是锁文件字段；合法值仅 design/generate/deliver，缺省为 design，非法值打印 usage 并退出 2。phase 决定资产就绪门槛：design 阶段不检查就绪状态；generate 及之后 required 资产不得处于 planned/acquiring/needs-manual（evidence-plan 侧要求 ready/used）；deliver 阶段 required 资产必须已是 used。锁文件本身的可配置项被严格收窄：version 只允许 1 或 2；
  - template.content_shell 必须为 blank-content；canvas_mode 只允许 template-master 或 10x5.625-compatible，且 template-master 模式下 authoring_canvas/merge_mode/content_layout/footer_mode 均为固定值；
  - brand 颜色、字体、footer/summary_banner 等十二个品牌常量逐一硬编码比对（注释说明需与 base/execution-lock-reference.json 和 components.js 的 THEME 三处同步修改）。typography_policy 设最低字号：title ≥20pt、body ≥9pt、absolute ≥7pt。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L11-L19),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L56–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L56-L76),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L98–L101
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L98-L101`）,
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L96–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js#L96-L101)
- **CLI 入口与退出码契约**
- validate-execution-lock.js 是可直接执行的 Node CLI：用法为 `node validate-execution-lock.js <execution-lock.json> [--phase design|generate|deliver]`，phase 缺省为 design；缺少位置参数或 phase 不在三个合法值内时打印 usage 到 stderr 并以退出码 2 结束。锁文件无法 JSON 解析时打印 [ERROR] 并退出 1。
  - 校验器通过 error()/warn() 帮助函数把消息收集到 errors/warnings 数组，末尾逐条打印 [ERROR]/[WARN] 加一行汇总（如 `execution-lock: N error(s), M warning(s), phase=...`），并按 errors 是否非空决定退出 1 或 0。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L11-L19),
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L48–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L48-L54),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249–L252
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L249-L252`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ppt-execution-lock-validator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L106-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L16-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L21-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L182-L199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L26-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L115-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L129-L179
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L235-L246
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L56-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L98-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L96-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L48-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249-L252
- 源页字段（feature）：ppt-execution-lock-validator
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js
