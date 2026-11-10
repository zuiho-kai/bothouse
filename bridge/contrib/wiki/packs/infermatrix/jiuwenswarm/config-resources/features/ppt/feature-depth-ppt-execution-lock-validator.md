---
name: feature-depth-ppt-execution-lock-validator
description: validate-execution-lock.js 实现深读：--phase 路径与逐资产检查、退出码 2/1/0 契约、非 design 阶段拒绝未就绪必需资产、version 2 复用 validateEvidencePlan、十二个品牌常量硬编码取舍、SKILL.md 设计阶段校验流程（未执行）
metadata:
  scope: 收 validate-execution-lock.js 的流程、API、配置、依赖、失败模式、取舍与手工验收的实现深读，来源另含 SKILL.md、validate-evidence-plan.js；功能概览归 feature-ppt-execution-lock-validator
---
# PPT 执行锁（execution-lock.json）语义校验器：实现深读

## 现状

- [[feature-ppt-execution-lock-validator]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **以 --phase design|generate|deliver 运行时的校验路径：逐资产检查后汇总并按错误数退出** argv 解析出 phase（默认 design）与 lock 路径后，脚本遍历 lock.assets 检查 id/kind/status/path 等，再校验每页 evidence_visual 引用，最后打印 [WARN]/[ERROR] 与统计行，并 process.exit(errors.length ? 1 : 0)。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L201–L232
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L201-L232`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L234–L247
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L234-L247`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249–L252
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L249-L252`）
- **CLI 契约：形如 --phase 显式跟随值的调用；缺参或非法 phase 退出码 2，有错误退出码 1、否则 0** 调用方须传 lock 路径且 phase 属于 design|generate|deliver，否则输出 Usage 并 process.exit(2)。注意 lockArg 的查找会排除 --phase 本身及其后一个参数，因此实际调用应让路径不在这些位置。汇总后按 errors 数量退出 1 或 0。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L11-L19),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249–L252
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L249-L252`）
- **phase 默认 design；非 design 拒绝未就绪的必需资产，deliver 进一步要求 used** --phase 缺省时 phase 为 "design"。phase !== "design" 且 asset.required 时，status 为 planned/acquiring/needs-manual 之一即报错；phase === "deliver" 时必需资产 status 非 used 报错。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11–L14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L11-L14),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L226–L231
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L226-L231`）
- **version 2 锁通过 require 的 validateEvidencePlan 复用 evidence-plan 校验** 脚本第 9 行 require ./validate-evidence-plan.js；
  - 当 lock.version === 2 且 evidence_plan 非空、文件存在时（L183–L190），调用 validateEvidencePlan(evidencePath, { phase, pageIds })（L191），将其 errors/warnings 并入自身输出（L193–L194），并用返回的 itemsById 检查每页 evidence_visual.asset_ids 是否已知且属于该页（L237–L240）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L8–L9](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L8-L9),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L183–L195
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L183-L195`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L234–L241
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L234-L241`）
- **缺参/非法 phase 走 Usage 分支退出 2；任意校验错误累积为 [ERROR] 并以退出码 1 传播** lockArg 为空或 phase 不在 design|generate|deliver 时立即 console.error(Usage) 并 process.exit(2)；否则各检查通过 error() 记入 errors，结尾逐条打印并以 errors.length ? 1 : 0 退出，warning 仅打印不影响退出码。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L16–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L16-L19),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249–L252
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L249-L252`）
- **十二个品牌常量硬编码为字面量，且注释声明需与另外两处文件保持同步** 设计推断（非作者历史意图）：
- validate-execution-lock.js 在 L76–L89 将 brand.colors/typography/footer/summary_banner 共十二个键钉死为字面量并逐一 expect()（L90）；收益是锁内品牌块被精确校验，代价是 L74–L75 注释所述：换主题需同步修改本文件、base/execution-lock-reference.json 和 scripts/components.js 的 THEME 三处（此同步义务为注释声明，属事实引用；将其判定为设计取舍是本人的推断）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L74–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L74-L90)
- **SKILL.md 记录的设计阶段双脚本校验流程与失败即禁止生成页面的规则（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档操作（NOT EXECUTED，仅记录于 SKILL.md L145–L149）：运行 `node scripts/validate-evidence-plan.js <project>/evidence-plan.json --phase design` 与 `node scripts/validate-execution-lock.js <project>/execution-lock.json --phase design`；文档预期为校验未通过时不得开始页面生成。
  - 脚本侧行为（未运行）：evidence-plan 校验在参数缺失或 phase 不合法时 exit 2，plan 路径位于 skill 目录内时 exit 1，有错误时 exit 1 否则 exit 0（L106–L133）；execution-lock 校验打印汇总行后按 errors 数量 exit 1/0（L249–L252）。所示片段不含针对两校验器的自动化测试。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ppt-creation/SKILL.md:L145–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/SKILL.md#L145-L151),
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L106–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js#L106-L133`）,
  - jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249–L252
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js#L249-L252`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ppt-execution-lock-validator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L201-L232
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L234-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L249-L252
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L11-L14
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L226-L231
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L16-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L8-L9
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L183-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L234-L241
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js:L74-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/SKILL.md:L145-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js:L106-L133
- 源页字段（feature）：ppt-execution-lock-validator
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-execution-lock.js；jiuwenswarm/resources/agent/workspace/skills/ppt-creation/scripts/validate-evidence-plan.js
