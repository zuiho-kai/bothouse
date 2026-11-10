---
name: 2026-05-19-git-and-pr-branch-pollution-05
description: 2026-05-19 错题：HunyuanImage3 IT2I AR streaming 写完测过后未主动开 sub-agent review，用户提醒后抓到 P1/P2（无 final image 仍 [DONE]、单阶段 stream=true 拒绝太晚、non-prefix AR delta 污染）；reviewer-lens 四项审计为硬卡点
metadata:
  scope: 只收 2026-05-19 业务代码写完后漏主动 sub-agent review 这一起事故；新增 public API 缺文档归 2026-05-19-git-and-pr-branch-pollution-06，双 owner review 放到事后归 2026-05-27-git-and-pr-branch-pollution-09
---
# 2026-05-19 — 业务代码写完后漏主动 sub-agent review

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-19-git-and-pr-branch-pollution-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-git-and-pr-branch-pollution-05`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：业务代码写完后漏主动 sub-agent review
- 影响范围：repos/vllm-omni/git
- **症状**：HunyuanImage3 IT2I AR streaming 功能写完、测试过、PR 描述也写好后，用户手动提醒“开个 sub agent 去做 code check”。sub-agent 立刻发现 P1/P2：流式可能没有最终 image 仍 `[DONE]`、单阶段 `stream=true` 拒绝太晚、non-prefix AR delta 会污染 previous 文本。说明我 push 前自审不够，用户不提醒就会把问题带到人工 review。
- **根因**：把 sub-agent review 当成用户可选动作，而不是 PR 交付硬卡点；而且如果 prompt 只是“code check”，容易护不住。正确姿势是按 `reviewer_lens_audit.md` 的四项（duplication / layering / edge cases / surface area）明确要求 findings 或 none found，再结合 `code_taste.md` 看命名、归属、复用、测试位置和 diff 气味。
- **解法**：业务代码/测试代码写完、准备 commit/push/开 PR 前，主动 spawn sub-agent 做 reviewer-lens audit。sub-agent 返回后先处理 P0/P1/P2 或明确记录为什么不处理，再提交/推送。本次处理后补了 final-image error、early single-stage rejection、replacement delta 测试，并抽 `_prepare_diffusion_image_request()` 复用非流式/流式构造逻辑。
- **怎么避免**：
  1. 提交前 checklist 固定顺序：本地 diff 自审 → sub-agent reviewer-lens audit → 修 findings → ruff/pytest/必要远端验证 → commit/push。
  2. sub-agent prompt 禁用“code check 一下 / 看有没有问题”这种开放但无审计框架的说法；必须列四项 audit，并要求每项 findings 或 none found。
  3. 用户说“需求写完”不等于“可以直接 push”；只要涉及业务代码或测试代码，sub-agent review 是硬卡点。
