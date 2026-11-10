---
name: feature-depth-workspace-git-diff
description: Workspace Git Diff 聚合实现深读：build_turn_summary_entry 对空 last_turn 返回 None、update_files_with_restore 回调失败回滚、项目目录三级解析顺序、git_diff_status 对 diff_service 的导入耦合、repo_is_dirty 兜底的取舍推断
metadata:
  scope: 收 get_git_diff 相关 git_diff_status.py、git_diff_watcher.py、diff_service.py 的实现级证据，来源另含 test_diff_service.py；入口契约、三层分层与监控常量归 feature-workspace-git-diff
---
# Workspace Git Diff Aggregation (get_git_diff)：实现深读

## 现状

- [[feature-workspace-git-diff]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **build_turn_summary_entry returns None for falsy last_turn, else a dict with files fixed to {}** Given a falsy last_turn the function returns None locally;
  - otherwise it builds a dict copying kind/change_set_id/turn_index/status/stats with defaults (kind "conversation_turn", status "completed", empty ids) and "files" always {}.
- 来源：[jiuwenswarm/server/runtime/session/git_diff_status.py:L1047–L1064](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_status.py#L1047-L1064)
- **update_files_with_restore：快照-更新-on_snapshot 回调，回调抛错自动回滚并重抛** 调用方传入 async on_snapshot(watch) 计算首次快照并下发响应；回调抛出任何 Exception 且 previous_state 非空时执行 restore_files_state 后重新 raise。update_files 返回 None 或未传回调时直接返回。
- 来源：[jiuwenswarm/server/runtime/session/git_diff_watcher.py:L405–L444](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_watcher.py#L405-L444)
- **项目目录解析顺序：channel_metadata.cwd → delivery_context.route_metadata.cwd → 顶层 project_dir** _get_project_dir_from_metadata 按 docstring 声明的三步顺序任一命中即返回；测试证实仅顶层 project_dir 存在时返回该值，全部缺失时返回 None 而非抛错。
- 来源：[jiuwenswarm/server/utils/diff_service.py:L768–L777](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/diff_service.py#L768-L777),
  - [tests/unit_tests/server/test_diff_service.py:L570–L579](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/server/test_diff_service.py#L570-L579)
- **git_diff_status imports get_diff_service from server.utils.diff_service** git_diff_status.py imports GitError/GitOperationError from project_git and get_diff_service from diff_service at module top; the shown span establishes only this import coupling, not call behavior.
- 来源：[jiuwenswarm/server/runtime/session/git_diff_status.py:L19–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_status.py#L19-L20)
- **repo_is_dirty 兜底：以 git status 口径覆盖 diff 服务缺漏，代价是丢失 stats 明细** 设计推断（非作者历史意图）：
- raw_diff 为空或非 dict 时返回 DiffSummary(is_dirty=repo_is_dirty, stats=DiffStats(), files={})：dirty 判定更权威（含 untracked），但该分支下统计与文件列表恒为空。（推断）
- 来源：[jiuwenswarm/server/runtime/session/git_diff_status.py:L529–L544](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/git_diff_status.py#L529-L544)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-workspace-git-diff.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_watcher.py:L405-L444；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/diff_service.py:L768-L777
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/server/test_diff_service.py:L570-L579；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_status.py:L529-L544
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_status.py:L1047-L1064；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/session/git_diff_status.py:L19-L20
- 源页字段（feature）：workspace-git-diff
- 入口（entry_points）：jiuwenswarm/server/utils/diff_service.py
- 源页字段（source_globs）：jiuwenswarm/server/utils/diff_service.py；jiuwenswarm/server/runtime/session/git_diff_watcher.py；jiuwenswarm/server/runtime/session/git_diff_status.py
