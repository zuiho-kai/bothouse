---
name: feature-cross-channel-history-search-skill-1
description: search_history.py 功能概览第 1 部分：standalone CLI 契约（--sessions-root/--channel/--session-id/--query/--keyword/--start/--end/--at/--window-minutes/--timezone/--limit/--max-sessions/--auto-expand，输出为 stderr 上的固定标记 HISTORY_SEARCH_SUMMARY/HISTORY_CONTEXT_BLOCK）、window-minutes=120/timezone=Asia/Shanghai/limit=20/max-sessions=200/auto-expand=true 等默认值与 --start/--end 优先于 --at 的时间窗优先级、sessions-root 四级回退顺序、只读扫描每会话 history.json 的流程与 channel 前缀/精确匹配规则
metadata:
  scope: 只收 CLI 契约、默认值与优先级、只读扫描流程三个侧面；容量与自动重试行为归 feature-cross-channel-history-search-skill-2；实现深读归 feature-depth-cross-channel-history-search-skill
---
# Cross-Channel Session History Search Skill (search_history.py)（1/2）

## 现状

- 拆分说明：本页是源页 `feature-cross-channel-history-search-skill.md` 的第 1/2 部分；第 2 部分 [[feature-cross-channel-history-search-skill-2]]
- **CLI Entry Point and Invocation Contract**
- The skill is a standalone Python CLI (`main()`, exit code 0) run via `python search_history.py`.
  - Public inputs are argparse flags: `--sessions-root`, `--channel`, `--session-id`, `--query` (space-separated keywords, all must match), repeatable `--keyword`, `--start`/`--end`/`--at` time expressions, `--window-minutes`, `--timezone`, `--limit`, `--max-sessions`,
  - and `--auto-expand`/`--no-auto-expand`. Output is not structured data but a fixed-marker plain-text report on stderr (SKILL id line, `HISTORY_SEARCH_SUMMARY_BEGIN/END` block, then `HISTORY_CONTEXT_BLOCK_BEGIN/END` with numbered hits), designed to be greppable in `mcp_exec_command` echo/logs.
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L301–L329
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L301-L329`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L258–L298
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L258-L298`）
- **Flags, Defaults and Precedence**
- Documented defaults: `--window-minutes` 120, `--timezone` Asia/Shanghai, `--limit` 20, `--max-sessions` 200, `--auto-expand` true (disable with `--no-auto-expand`).
  - Time window precedence: explicit `--start`/`--end` (a missing side defaults to now-24h / now) wins over `--at` (center ± window/2); with none, the last 24 hours is used.
  - Sessions-root precedence: CLI flag, then `get_agent_sessions_dir()` from jiuwenswarm, then `JIUWENSWARM_DATA_DIR/agent/sessions`, then `~/.jiuwenswarm/agent/sessions`. Without `zoneinfo`, timezone falls back to a fixed UTC+8.
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L318–L334
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L318-L334`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L341–L362
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L341-L362`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L82–L89
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L82-L89`）
- **Read-only CLI scan over per-session history.json files**
- The skill is a standalone Python CLI whose single flow is: argparse parsing → timezone/time-window resolution → enumerate session directories → read each directory's history.json → filter records by time,
  - non-empty content and keywords → sort by timestamp descending → emit a fixed-marker plain-text report on stderr. Channel filtering matches either a session-id prefix `{channel}_` or an exact equality with the channel; an explicit `--session-id` takes precedence over the channel filter.
  - Malformed files are skipped, but a history.json that is a JSON list containing dicts keeps its dict items even when some entries are non-dicts.
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L195–L200
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L195-L200`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L219–L251
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L219-L251`）,
  - jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L142–L157
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py#L142-L157`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-cross-channel-history-search-skill.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L301-L329
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L258-L298
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L318-L334
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L341-L362
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L82-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L195-L200
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L219-L251
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L142-L157
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L187-L192
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L326-L326
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L381-L397
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L272-L298
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L329-L343
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L219-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py:L229-L251
- 源页字段（feature）：cross-channel-history-search-skill
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/cross-channel-history-retrieval/scripts/search_history.py
