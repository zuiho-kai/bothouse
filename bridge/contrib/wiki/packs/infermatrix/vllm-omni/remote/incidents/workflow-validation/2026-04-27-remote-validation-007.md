---
name: 2026-04-27-remote-validation-007
description: 2026-04-27 错题：启动 vllm-omni server 后用 while curl health; sleep 5 循环盲等 210s 无输出；改后台 nohup 启动、5s 后 tail 日志、60s 周期检查
metadata:
  scope: 只收 2026-04-27 远端命令盲等 210s 不看日志这一起事故及后台启动加 tail 的解法；跨主机同步代码走 git 归 2026-05-18-remote-validation-008，脚本投递三连坑归 2026-05-19-remote-validation-011
---
# 2026-04-27 — 远端命令盲等 210s 不看日志

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-04-27-remote-validation-007.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-27-remote-validation-007`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：远端命令盲等 210s 不看日志
- 影响范围：repos/vllm-omni/remote
- **症状**：启动 vllm-omni server 后用 `while ! curl health; sleep 5; done` 循环等待，210s 内没有任何输出给用户
- **根因**：违反硬规则 #1——远端发命令后必须先短 sleep（≤5s）+ capture 确认启动了
- **解法**：后台启动（`nohup ... &`），5s 后 `tail -20` 日志确认无错，再 60s 周期检查
- **对未来的提醒**：禁止紧密 poll 循环阻塞 SSH 隐藏输出；每次检查必须打印日志片段
