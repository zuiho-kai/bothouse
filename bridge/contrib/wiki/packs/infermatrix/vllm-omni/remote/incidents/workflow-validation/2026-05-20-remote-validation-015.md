---
name: 2026-05-20-remote-validation-015
description: 2026-05-20 错题：把 root@<REMOTE_HOST> -p 31140 旧记录的 worktree/venv 路径套给另一台机器，并擅自切到 OTHER_USER_ROOT 建 worktree；硬规则：路径记忆 key 为完整 user@host:port，用户指定根目录是约束
metadata:
  scope: 只收 2026-05-20 不同远端节点不能共享路径记忆这一起事故、已确认的机器专属事实与 5 条硬规则；路径不能猜归 2026-05-19-remote-validation-012，冷启动重复 discover 归 2026-05-19-remote-validation-014
---
# 2026-05-20 — 同一类远端节点不能共享路径记忆

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-20-remote-validation-015.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-20-remote-validation-015`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：同一类远端节点不能共享路径记忆
- 影响范围：repos/vllm-omni/remote
- **症状**：用户让我到 `ssh root@<REMOTE_HOST> -p 31140` 跑验证，我套用了旧记录里 `root@<REMOTE_HOST> -p 31140` 的 `<REMOTE_WORK_ROOT>/wt-*` 路径假设。实测 47.79 这台机器 `<REMOTE_WORK_ROOT>` 存在但没有记录里的 worktree/venv，`<REMOTE_WORK_ROOT>` 不存在；可用种子 repo/venv 主要在 `<OTHER_USER_ROOT>`、`<OTHER_USER_ROOT>`、`<OTHER_USER_ROOT>`。
  - 用户提醒“remote server 不是记录了，在 <REMOTE_WORK_ROOT> 没有就更新一下”，随后又明确“每个机器文件路径都不一样，你分别记录”。我又犯了第二个错误：看到 `<REMOTE_WORK_ROOT>` 没有现成 repo 后，擅自切到 `<OTHER_USER_ROOT>` 建 worktree，而不是遵从用户指定的 `<REMOTE_WORK_ROOT>` 根目录。
- **根因**：
  - 把“端口一样 / hostname 历史看起来一样”误当成同一套目录布局。
  - 远端记录按“节点 B”聚合，没有按 `host:port` 分层；导致旧路径从 B2 泄漏到 B1。
  - 发现 `<REMOTE_WORK_ROOT>` 不成立后，没有第一时间把这个事实写回机器专属记录。
- **已确认的机器专属事实**：
  - `root@<REMOTE_HOST> -p 31140`：`<REMOTE_WORK_ROOT>` 存在；当前已创建 `<REMOTE_WORK_ROOT>/vllm-omni` 和 `<REMOTE_WORK_ROOT>/wt-codex-hunyuanimage3-step-batch`；`<REMOTE_WORK_ROOT>` 不存在；`<OTHER_USER_ROOT>/vllm-omni` 只作为种子 repo/历史可读源；可只读使用 `<OTHER_USER_ROOT>/.venv` 或 `<OTHER_USER_ROOT>/.venv` 做环境验证，但不要改共享依赖。
  - `root@<REMOTE_HOST> -p 31140`：旧记录路径在 `<REMOTE_WORK_ROOT>/...`，未在 2026-05-20 对同一目标复测前，不能套给 47.79。
  - `root@<REMOTE_HOST> -p 31449`：旧记录稳定根在 `<REMOTE_WORK_ROOT>`，不是 `<REMOTE_WORK_ROOT>`。
- **硬规则**：
  1. 远端路径记忆的 key 必须是完整 `user@host:port`，不是“节点名”或“用途名”。
  2. 用户指定根目录时，根目录是约束，不是候选；如果里面没有 repo，就在该根目录创建/更新 repo 或 worktree，不要擅自切到另一个根。
  3. 每次发现路径事实变化，立刻按机器小节写入记录：`hostname`、repo 根、venv、模型缓存、不可用路径。
  4. 旧记录只可作为候选；新机器第一次使用时必须用一个聚合脚本确认 `pwd`/`hostname`/`test -d`/`git remote -v`，然后再跑验证。
  5. 不同机器之间禁止传播 worktree 路径。`<REMOTE_WORK_ROOT>/wt-*`、`<REMOTE_WORK_ROOT>/*`、`/root/*` 都必须标明属于哪台 `host:port`。
