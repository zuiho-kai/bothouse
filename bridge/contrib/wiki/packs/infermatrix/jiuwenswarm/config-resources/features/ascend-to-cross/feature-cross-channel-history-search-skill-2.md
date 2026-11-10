---
name: feature-cross-channel-history-search-skill-2
description: search_history.py 功能概览第 2 部分：只扫描最近 --max-sessions（默认 200）个会话目录、无命中且满足条件时按 72 小时自动重试（替换而非扩大 --at 窗口）、命中记录携带 session_id/role/channel_id/timestamp/request_id、stderr 报告标记作为唯一内建验证面且 scanned_sessions 计数先于 history.json 存在性检查、索引无关的有界扫描取舍（recall 代价与错误静默跳过）
metadata:
  scope: 只收容量上限、自动重试、命中字段、验证面与取舍四个侧面；CLI 契约与只读扫描流程归 feature-cross-channel-history-search-skill-1；实现深读归 feature-depth-cross-channel-history-search-skill
---
# Cross-Channel Session History Search Skill (search_history.py)（2/2）

## 现状

- 拆分说明：本页是源页 `feature-cross-channel-history-search-skill.md` 的第 2/2 部分；第 1 部分 [[feature-cross-channel-history-search-skill-1]]
- **Cross-channel keyword/time search with capped scan and 72h auto-retry**
- The script searches session folders under the resolved sessions root, but only the most recently modified `--max-sessions` directories (default 200) are scanned; older sessions are silently out of scope.
  - When the initial search yields no hits and auto-expand is enabled (default) and neither `--start` nor `--end` was given, the window is replaced with the 72 hours ending at now and the search reruns — note this replaces rather than widens an `--at`-centered window.
  - Hits carry session_id, role, channel_id, timestamp and request_id.
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L187–L192
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L187-L192`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L326–L326
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L326-L326`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L381–L397
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L381-L397`）
- **Self-describing stderr report; no tests shown**
- The script's only built-in verification surface is its report: when it reaches emission it prints the `SKILL=cross-channel-history-retrieval` marker plus a `HISTORY_SEARCH_SUMMARY_BEGIN/END` block with timezone, window, filters, scanned_sessions, scanned_records, hit_count and auto_expanded,
  - followed by a numbered hits block.
  - However, reaching the report is not guaranteed — argument parsing, ZoneInfo lookup and time parsing run before it and can fail — and scanned_sessions is incremented before checking for history.json, so the counters alone do not prove session data was actually read.
  - No test entry points for this skill appear in the shown inputs.
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L272–L298
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L272-L298`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L329–L343
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L329-L343`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L219–L230
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L219-L230`）
- **Bounded substring scan with capped output, at the cost of recall and silence on errors**
- Inference / 设计推断（非作者历史意图）：
- The skill trades index-free simplicity for bounded work: session directories are sorted by mtime and only the newest `--max-sessions` (default 200) are scanned, records are filtered by case-insensitive all-keyword substring match on `content`,
  - hits are sorted by timestamp descending and truncated to `--limit`, and unreadable or non-JSON history.json files are silently skipped rather than reported.
  - The cost is recall: older sessions fall out of scope, records without a parseable timestamp or with blank content are skipped before keyword matching, and no error surfaces for corrupt files.
  - A default 72-hour auto-expand retry (only when no `--start`/`--end` was given and the first pass found nothing) trades a second full scan for better recall on empty results.
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L187–L192
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L187-L192`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L142–L157
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L142-L157`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L229–L251
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L229-L251`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L381–L397
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L381-L397`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-cross-channel-history-search-skill.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
