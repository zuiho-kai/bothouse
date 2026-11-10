---
name: 2026-05-19-ci-and-testing-08
description: 2026-05-19 CI 错题 inc-2026-05-19-ci-and-testing-08，HunyuanImage3 IT2I AR streaming PR 交付复盘：远端验证没按 local/remote.md 约定、PR 描述套通用模板、漏跑 ruff check、lint 小修后又过度上远端复验
metadata:
  scope: 只收 2026-05-19 HunyuanImage3 IT2I AR streaming PR 交付过程的四个非功能问题和四条流程约束；F841 单项错题归 2026-05-19-ci-and-testing-07，协议坏路径漏审归 2026-05-19-ci-and-testing-06
---
# 2026-05-19 — HunyuanImage3 IT2I AR streaming PR 交付复盘

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-19-ci-and-testing-08.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-ci-and-testing-08`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：HunyuanImage3 IT2I AR streaming PR 交付复盘
- 影响范围：repos/vllm-omni/ci
- **症状**：功能实现本身完成并通过 focused tests，但交付过程连续暴露几个非功能问题：(1) 远端验证一开始没按 `local/remote.md` 和 `<REMOTE_WORK_ROOT>` 工作区约定走；(2) PR 描述第一次按通用模板写，既不像 vLLM-Omni 真实 PR，也不好复制；(3) 提交前漏跑 `ruff check`，CI 被 F841 打回；(4) 一行 lint 修复后又默认上远端复验，撞到远端 venv 没 ruff，制造无关噪音。
- **根因**：把“代码实现完成”误当成“PR 交付完成”，没有把仓库习惯、CI hook、本地/远端验证边界当成交付的一部分。远端规则和 PR 格式规则虽然后来补了，但应该在动作前先查；验证也没有按风险来源选择，出现了先不足、后过度的摆动。
- **解法**：补齐并落盘四条流程约束：远端验证前读 `local/remote.md`，并为本次任务建立独立 worktree 和 `.venv`；写 PR 描述前读 `.github/PULL_REQUEST_TEMPLATE.md`，必要时查线上同仓 PR；提交/推 PR 前跑覆盖改动文件的 `ruff check`；纯 lint/static 小修本地闭环，不默认上远端。
- **对未来的提醒**：PR 交付 checklist 必须同时覆盖四件事：代码行为、CI 静态检查、项目真实 PR 表达习惯、验证环境选择。功能不难时更容易在这些边缘纪律上翻车；不要用“多跑远端”掩盖本地漏跑 hook，也不要用“模板三段”替代真实仓库风格。
