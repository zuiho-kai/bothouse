---
name: feature-depth-web-search-tools-1
description: MCP 搜索工具实现深读（上）：mcp_free_search 的 query 清理、参数夹取、线程执行与先提交 URL 后渲染的流程，返回字符串与错误契约，付费 provider 由 {PROVIDER}_API_KEY 决定的可用性与回退顺序
metadata:
  scope: 收 trusted_search_tool_adapter.py 与 search_tools.py 的免费搜索流程、免费搜索入口契约和付费 provider 配置，来源另含 test_trusted_search_tool_adapter.py；付费搜索守卫、先提交 URL 的取舍、单测与导入依赖归 feature-depth-web-search-tools-2；功能概览归 feature-web-search-tools
---
# MCP Free/Paid Search Tools with Trusted-Search Provenance Lease：实现深读（1/2）

## 现状

- 拆分说明：本页是源页 `feature-depth-web-search-tools.md` 的第 1/2 部分；第 2 部分 [[feature-depth-web-search-tools-2]]
- [[feature-web-search-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **mcp_free_search: strip query, clamp params, run provider in a thread, commit URLs, then render** On invoke, the query is stripped (empty → "[ERROR]: query cannot be empty."), max_results is normalized and timeout clamped to [5,60]; run_free_search_structured runs via asyncio.to_thread,
  - and on non-empty rows complete_trusted_search_producer(success=True, urls=...) commits row URLs before render_free_search_result returns the rendered string; a finally clause calls complete_trusted_search_producer(success=False).
- 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L36-L71)
- **mcp_free_search: string-returning tool with empty-query and provider-failure error strings (only the structured-search call is caught)** mcp_free_search(query, max_results=8, timeout_seconds=20) strips the query and returns "[ERROR]: query cannot be empty." when blank;
  - only exceptions from the asyncio.to_thread(run_free_search_structured) call are caught and returned as "[ERROR]: free search failed: {exc}".
  - Empty result rows return "No search results for: {query}"; on success it calls complete_trusted_search_producer(success=True, urls=...) before render_free_search_result, and a finally block always calls complete_trusted_search_producer(success=False).
- 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L36-L71),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L31–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L31-L33)
- **Paid-provider availability from {PROVIDER}_API_KEY env vars in fixed fallback order** configured_paid_search_providers() returns providers ("bocha", "perplexity", "serper", "jina") whose {PROVIDER}_API_KEY env var, uppercased and stripped, is nonblank.
  - run_paid_search_structured defaults to provider="auto", max_results=DEFAULT_SEARCH_MAX_RESULTS (8) and timeout_seconds=45; mcp_free_search clamps max_results via normalize_search_max_results to [MIN_SEARCH_MAX_RESULTS=1, MAX_SEARCH_MAX_RESULTS=20] and timeout_seconds to [5, 60].
- 来源：[jiuwenswarm/agents/harness/common/tools/search_tools.py:L534–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L534-L548),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L31–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L31-L39),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L36-L48)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-web-search-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L57-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L178-L186
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L135-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L190-L216
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L219-L240
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L31-L33；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L534-L548
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L31-L39；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L82-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L110-L114；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L565-L583
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L18-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L100-L109；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L565-L585
- 源页字段（feature）：web-search-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/definition.ts
  - jiuwenswarm/agents/harness/common/tools/search_tools.py
