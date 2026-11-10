---
name: review-overview
description: vLLM-Omni 代码审查入口：PR title/body 只作初始 census、由 frozen live diff 的 producer→consumer 决定 owner，上游 main @ f663d120 新增 .claude/skills/review-pr 的仓库合同（sandbox、只读、授权）及其自报验证的局限，并分流到四篇审查指南
metadata:
  scope: 只收 review 目录的审查方法总述与指南分流表；owner 路由、模型适配 guardrails、模型验证、strict 检查单正文归 maintainer-pattern-routing、model-adaptation-guardrails-1、model-validation、strict-review-checklist，repository skill 的 contributor 规则归 repository-skills
---
# vLLM-Omni 代码审查

## 现状

- PR title/body 只用于初始 census 和导航；必须由 frozen live diff 的 producer→consumer 与 branch-local routing 决定 component/model owner，changed files 再验证完整范围。本目录只放 vLLM-Omni 特有的审查方法，不再承担 owner 导航。
- 上游 `main @ f663d120` 新增 `.claude/skills/review-pr/`，是 vLLM-Omni 仓库自带的 Claude review skill，不是 InferMatrixCopilot 的 skill/runtime 实现，也不能用其 prompt 副本覆盖本知识树规则。可复用的仓库合同只有：冻结目标后从 live producer→consumer 选一个 primary module，真实跨边界时才加第二 owner，并叠加命中的 feature/evidence checks；
  - branch-local design 页的 draft candidate 只能作问题，除非代码、测试或政策已执行。外部 fork 只有在无 secret、限文件系统/网络/资源的 disposable sandbox 才运行代码，否则限于 SHA-addressed 静态读取与已有 CI。review 默认只读；提交 review event、请求 reviewer 或发 `@mention` 都需要分别明确授权并在写入前复核 head。
- 该 skill 的快照合同还覆盖 tracked/index/untracked/ignored bytes，并在验证组和交付前复核；detached worktree 只冻结身份，不是安全沙箱。使用时仍以目标文件内容和当前仓库政策为准。PR 只报告结构、链接、pre-commit 检查和一次 owner-ranking dry run，没有 behavioral agent eval、runtime test 或独立 review；这些自报结果不能冒充 review skill 的行为正确性证明。

| 具体问题 | 查看哪里 |
|---|---|
| PR 描述如何路由精确 owner/model 代码地图 | [[maintainer-pattern-routing]]（maintainer pattern routing） |
| 模型适配是否漏掉必要链路 | [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails） |
| 模型验证是否证明语义正确 | [[model-validation]]（model validation） |
| Strict 审查的仓库专属检查单（按触发条件执行） | [[strict-review-checklist]]（strict review checklist） |
| 维护或浏览本目录 | [[review-guides-overview]]（guides index） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/review/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, review；created: 2026-07-10；updated: 2026-09-02
- 来源（sources）：PR #5871；.claude/skills/review-pr/SKILL.md；.claude/skills/review-pr/references/process/design-contracts.md；.claude/skills/review-pr/references/process/general-checks.md；.claude/skills/review-pr/references/process/review-execution.md
  - .claude/skills/review-pr/references/process/review-routing.md
