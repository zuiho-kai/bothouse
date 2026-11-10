---
name: 2026-05-19-remote-validation-006
description: 2026-05-19 错题：CI ruff F841 未使用变量的小 lint 修复，本地 ruff 与 py_compile 已通过仍 SSH 到 wt-hunyuan-it2i-ar-stream 远端复验，远端 venv 缺 ruff 引入环境噪音
metadata:
  scope: 只收 2026-05-19 小 lint 修复不该默认上远端复验这一起事故及验证匹配风险来源的解法；远端验证前读本机远端配置归 2026-05-19-remote-validation-010
---
# 2026-05-19 — 小 lint 修复不该默认上远端复验

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-19-remote-validation-006.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-remote-validation-006`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：小 lint 修复不该默认上远端复验
- 影响范围：repos/vllm-omni/remote
- **症状**：CI 报 `ruff check` 的 F841 未使用变量，本地删除变量后已经跑过覆盖改动文件的 `ruff check` 和 `py_compile`，但我又默认 SSH 到 `<REMOTE_WORK_ROOT>/wt-hunyuan-it2i-ar-stream` 远端复验，结果远端 venv 缺 ruff binary，白白引入环境噪音。
- **根因**：把“远端验证流程要规范”（A12）误用成“任何修复都必须远端验证”。这次问题是纯静态 lint，小范围一行删除，本地 ruff 已经命中同一个检查；远端不提供额外信号，反而增加 venv/tooling 变量。
- **解法**：小范围 lint/static 修复：本地跑对应 hook/ruff + 必要语法检查即可；只有本地缺依赖、GPU/e2e、远端环境相关、或用户明确要求时才上远端。
- **对未来的提醒**：验证要匹配风险来源。代码行为/GPU/环境问题用远端；格式、未使用变量、PR 文档、纯文本规则更新优先本地闭环。不要用“多跑远端”伪装严谨。
