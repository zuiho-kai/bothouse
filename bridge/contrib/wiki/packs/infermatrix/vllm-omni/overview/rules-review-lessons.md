---
name: rules-review-lessons
description: vllm-omni review-lessons 规则 VLLM-OMNI-PR8917-LESSONS-RECORD：docs/contributing/ci/lessons.md 保持 200 行以内、每条 L0xx 含 Trigger/Check/Evidence、source-only 声明，及 pr_merge_loop、.nav.yaml、两个 SKILL.md、AGENTS.md、CLAUDE.md、CONTRIBUTING.md 的读取入口
metadata:
  scope: "只收 PR #8917 一条教训记录规则；合并循环指南的门槛语义归 vllm-omni-rules-2 的 PR8897 规则，多动作评审回复清单归 vllm-omni-rules-3 的 PR8910 规则"
---
# vllm-omni review-lessons rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/rules-review-lessons.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-10-19；updated: 2026-10-19
- 来源（sources）：PR #8917
- [VLLM-OMNI-PR8917-LESSONS-RECORD] Review and issue lessons 记录：≤200 行、Trigger/Check/Evidence 三要素与全部读取入口
  - 触发：改动 `docs/contributing/ci/lessons.md`（评审与 issue 教训记录）本身，或其任一入口——`docs/contributing/ci/pr_merge_loop.md` 的 `LESSONS → code regulation + skills` 段、`docs/contributing/ci/.nav.yaml` 的 `lessons.md` 导航项、
    - `.claude/skills/precheck-pr/SKILL.md`（`Contributor intent gate` 节内）与 `.claude/skills/review-pr/SKILL.md`（`Reference guide` 节内）的 lessons 阅读指引、根 `AGENTS.md`、`CLAUDE.md` 的 `@` 导入、`CONTRIBUTING.md` 的指引句；以及新增或修订教训条目（`L0xx`）的变更。
  - 强制：主文件保持在 200 行以内且每条教训简洁；每条 `L0xx` 条目必须具备 Trigger（触发场景）、Check（预防性检查）与 Evidence（公开 issue/PR 链接）三要素；事件细节、复现命令与回归结果留在链接的 issue/PR 中而非主文件；重复模式须合并，过时指引须修订且只保留有用的替代链接；新事件须写明失败原因与验证为何漏掉，未知原因记为 unknown；记录跟踪高风险变更模式而非作者黑名单；文件须声明所有种子均为 source-only（公开代码/报告/已接受指引，非独立复现），且该记录不授予发布、运行 CI、合并或扩大监控的任何新权限。
    - 入口语义：在任何评审、贡献者自检、代码改动或 issue 分诊前读取相关条目并核验其链接证据；其中“历史示例/相似历史报告不构成新缺陷或新成因证据”的明示表述仅出现在两处——`.claude/skills/review-pr/SKILL.md`（要求对照当前 diff 与修订核验，historical examples are not proof of a new defect）与 lessons.md 自身的 source-only 声明（a similar historical report does not prove a new cause）；
    - precheck-pr 的 SKILL.md（要求对照当前变更核验、只应用相关检查）、根 `AGENTS.md` 与 `CONTRIBUTING.md`（两者均要求对照当前修订核验证据）只规定读取与核验，不含该明示表述。`docs/contributing/ci/pr_merge_loop.md` 的 LESSONS 段链接 `./lessons.md`，要求在应用历史教训前核对链接证据与当前代码。
  - 验收：`docs/contributing/ci/lessons.md` 存在且保持在 200 行以内，每个 `L0xx` 条目含 Trigger/Check/Evidence 且 Evidence 为公开链接；`.nav.yaml` 含 `lessons.md` 且 YAML 可解析；`pr_merge_loop.md` 的 LESSONS 段含指向 `./lessons.md` 的相对链接；两个 SKILL.md 各含指向 `../../../docs/contributing/ci/lessons.md` 的相对链接且链接可解析；
    - 根 `AGENTS.md` 指向 `CONTRIBUTING.md`、两个技能与 lessons；`CLAUDE.md` 含 `@AGENTS.md` 与 `@docs/contributing/ci/lessons.md`；`CONTRIBUTING.md` 保留 lessons 指引句。^[PR #8917]

## 决策与踩坑

- [VLLM-OMNI-PR8917-LESSONS-RECORD] 禁止：使主文件超过 200 行，或把事件细节、复现命令、回归结果写进主文件；新增缺少 Trigger/Check/公开证据链接任一项的条目；把 source-only 种子当作独立复现的结论，或凭历史相似报告直接断言新缺陷成因；以作者黑名单代替风险模式跟踪；删除 `Keep this file small` 节、source-only 声明或无新授权声明；
  - 移除 pr_merge_loop.md LESSONS 段链接、`.nav.yaml` 导航项、两个 SKILL.md 的读取指引、根 `AGENTS.md`、`CLAUDE.md` 的 `@AGENTS.md`/`@docs/contributing/ci/lessons.md` 导入或 `CONTRIBUTING.md` 指引句中的任一入口。
