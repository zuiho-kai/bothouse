---
name: feature-workspace-git-diff
description: Workspace Git Diff 聚合（get_git_diff）与实时监控：DiffService.get_git_diff 入口与返回契约、服务/状态聚合/GitDiffWatcherRegistry 三层分层、watcher 测试线索、POLL_INTERVAL_SEC 等轮询常量、按文件流式 diff 与 rebase 瞬态检测取舍
metadata:
  scope: 只收 get_git_diff 的功能级描述与监控设计取舍；build_turn_summary_entry、回滚回调与项目目录解析等实现级细节归 feature-depth-workspace-git-diff
---
# Workspace Git Diff 聚合（get_git_diff）与实时监控

## 现状

- **get_git_diff 入口与返回契约**
- `DiffService.get_git_diff(project_dir, *, include_files=True, include_hunks=True, hunk_paths=None)` 返回工作区相对 HEAD 的 diff 聚合：`stats`（filesChanged/linesAdded/linesRemoved，filesChanged 为实际总数）、`files`（绝对路径到条目，含 hunks、isNewFile、isBinary、isLargeFile 等标志）、`files_truncated`/`files_limit` 预览截断提示；
  - 非 git 仓库、无改动或处于瞬态 git 状态时返回 `None`。Web 侧由 `DiffStatusService` 复用该结果并转换为 snake_case 的 `ProjectGitDiffStatus` schema（repo 元信息 + current 工作区摘要 + last_turn 对话轮摘要）。
- Sources / 来源：[jiuwenswarm/server/utils/diff_service.py:L2025–L2060](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L2025-L2060),
  - [jiuwenswarm/server/utils/diff_service.py:L2233–L2242](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L2233-L2242),
  - [jiuwenswarm/server/runtime/session/git_diff_status.py:L1–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_status.py#L1-L8)
- **三层分层：服务计算、状态聚合、按项目聚合的实时推送**
- 底层 `DiffService.get_git_diff` 依次执行：`git rev-parse --show-toplevel` 找仓库根、瞬态状态检测、`git diff HEAD --shortstat` 快速探测规模（超限仅返回统计）、`--numstat`/`--name-status`/`--porcelain=v1` 取逐文件统计与状态、按文件流式 `git diff` 解析 hunks，最后与 `_build_untracked_entries` 生成的 untracked 条目合并。
  - 其上 `DiffStatusService` 聚合 current 与 last_turn 两路来源；`GitDiffWatcherRegistry` 按 `project_id` 聚合 watcher，为每层维护 summary/files/detail 三个 fingerprint（MD5），变化时经 WebChannel 推送事件，`mark_dirty` 唤醒轮询、`cleanup_ws`/`cleanup_project` 释放资源。
- Sources / 来源：[jiuwenswarm/server/utils/diff_service.py:L2061–L2130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L2061-L2130),
  - [jiuwenswarm/server/runtime/session/git_diff_watcher.py:L1–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L1-L10),
  - [jiuwenswarm/server/runtime/session/git_diff_watcher.py:L40–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L40-L50)
- **所示片段中的测试线索**
- Inference / 设计推断（非作者历史意图）：
- 本次所示源码片段未包含测试文件本身，但 watcher 的接口注释提供了验证入口线索：`add_watch` 的 `on_initial=None` 分支注明"保留用于兼容已有测试与外部调用方"，`restore_files_state`/`restore_detail_state` 也注明保留为公开接口以兼容已有调用方与测试、新代码应优先使用带自动回滚的 `update_files_with_restore`/`update_detail_with_restore`。这表明存在针对 watcher 订阅生命周期的既有测试（具体用例文件未在本次输入中展示）。
- Sources / 来源：[jiuwenswarm/server/runtime/session/git_diff_watcher.py:L270–L272](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L270-L272),
  - [jiuwenswarm/server/runtime/session/git_diff_watcher.py:L381–L386](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L381-L386)
- **监控轮询常量与 diff 阈值**
- 实时监控侧的行为由模块级常量控制：`POLL_INTERVAL_SEC = 2.0`（summary 轮询周期）、`DEBOUNCE_SEC = 0.3`（mark_dirty 后合并重算的最小等待）、`ERROR_BACKOFF_SEC = 5.0`（git 命令失败退避）、`MAX_PUSH_FAILURES = 3`（孤儿 watcher 自动回收阈值）；`NOT_GIT_REPOSITORY`/`PROJECT_DIR_MISSING` 被列为不可重试的结构性错误码。
  - diff 计算侧引用 `MAX_DIFF_SIZE_BYTES`、`MAX_FILES`、`MAX_FILES_FOR_DETAILS`、`INTERNAL_UNTRACKED_DIRS` 等模块常量，但其数值未在所示片段中定义。`get_git_diff` 的 `include_hunks=True` 会经 `effective_include_files = include_files or include_hunks` 强制进入文件构造路径，即使 `include_files=False`。
- Sources / 来源：[jiuwenswarm/server/runtime/session/git_diff_watcher.py:L23–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L23-L37),
  - [jiuwenswarm/server/utils/diff_service.py:L2061–L2070](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L2061-L2070),
  - [jiuwenswarm/server/utils/diff_service.py:L1495–L1500](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L1495-L1500)
- **按文件流式获取与瞬态标记的选择**
- hunks 获取放弃一次聚合 `git diff`，改为按文件调用 `_run_git_diff_limited` 流式读取并在超过 `MAX_DIFF_SIZE_BYTES` 后停止累积 stdout（仍持续读空管道避免子进程阻塞）：以每文件一个 git 进程的成本，换取避免聚合 patch 的峰值内存，且前端详情层通常只请求选中路径。瞬态检测刻意使用 `rebase-merge`/`rebase-apply` 目录而非 `REBASE_HEAD`：代码注释说明后者在 rebase 成功收尾后被 Git 遗留，若作为信号会让 diff 永久返回 None（前端恒为 +0 -0）。
- Sources / 来源：[jiuwenswarm/server/utils/diff_service.py:L1495–L1537](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L1495-L1537),
  - [jiuwenswarm/server/utils/diff_service.py:L2157–L2175](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L2157-L2175),
  - [jiuwenswarm/server/utils/diff_service.py:L1569–L1602](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L1569-L1602)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-workspace-git-diff.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L2025-L2060；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L2233-L2242
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_status.py:L1-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L2061-L2130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_watcher.py:L1-L10；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_watcher.py:L40-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_watcher.py:L270-L272；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_watcher.py:L381-L386
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_watcher.py:L23-L37；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L2061-L2070
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L1495-L1500；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L1495-L1537
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L2157-L2175；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L1569-L1602
- 源页字段（feature）：workspace-git-diff
- 入口（entry_points）：jiuwenswarm/server/utils/diff_service.py
- 源页字段（source_globs）：jiuwenswarm/server/utils/diff_service.py；jiuwenswarm/server/runtime/session/git_diff_watcher.py；jiuwenswarm/server/runtime/session/git_diff_status.py
