---
name: feature-depth-web-search-tools-2
description: MCP 搜索工具实现深读（下）：付费搜索的空 query、非法 provider 与 provider 异常 [ERROR] 返回，先提交 URL 再渲染的取舍，两个适配器 invoke 的单测与租约断言，适配器的导入依赖
metadata:
  scope: 只收付费搜索错误守卫、取舍、测试与依赖的实现级事实；免费搜索流程与入口契约、付费 provider 配置归 feature-depth-web-search-tools-1；功能概览归 feature-web-search-tools
---
# MCP Free/Paid Search Tools with Trusted-Search Provenance Lease：实现深读（2/2）

## 现状

- 拆分说明：本页是源页 `feature-depth-web-search-tools.md` 的第 2/2 部分；第 1 部分 [[feature-depth-web-search-tools-1]]
- **Paid search guards: blank query, invalid provider, and provider exceptions return [ERROR] strings** In _run_paid_search, a query that strips to empty returns "[ERROR]: query cannot be empty.";
  - a provider outside {auto,bocha,jina,serper,perplexity} returns "[ERROR]: provider must be auto or a configured search provider."; any exception from run_paid_search_structured is returned as f"[ERROR]: {exc}".
  - In every case the finally block still calls complete_trusted_search_producer(success=False).
  - run_paid_search_structured raises RuntimeError("no paid search API keys configured.") when no provider key is nonblank, ValueError for an unknown provider, and collects "provider runner unavailable" errors per skipped runner.
- 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L82–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L82-L99),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L110–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L110-L114),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L565–L583](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L565-L583)
- **Committing URLs before render survives render failure, at the cost of trusting URLs even if rendering then fails** 设计推断（非作者历史意图）：
- Inference from the shown branch: success URLs are committed before render_free_search_result runs, so a render-time RuntimeError still leaves the URLs in the ledger (test raises "render failed" and then asserts ledger.contains(url)) — robust provenance,
  - but committed URLs exist for output the caller never saw.
- 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L57–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L57-L66),
  - [tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L178–L186](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py#L178-L186)
- **Automated runtime tests exercise both adapters' invoke with monkeypatched providers and assert lease/output state** test_free_adapter_runs_normally_without_provenance_lease (lines 135-151) monkeypatches run_free_search_structured, awaits mcp_free_search.invoke({"query": "news"}),
  - and asserts the URL appears in the result; test_provider_failure_consumes_lease_without_provenance (lines 219-240) asserts the "[ERROR]: free search failed: provider failed" string and len(ledger) == 0;
  - test_paid_adapter_commits_only_structured_provider_urls (lines 190-216) asserts the exact rendered string and ledger.contains for both URLs.
- 来源：[tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L135–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py#L135-L151),
  - [tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L190–L216](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py#L190-L216),
  - [tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py:L219–L240](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_trusted_search_tool_adapter.py#L219-L240)
- **Adapter imports search helpers and trusted-search producer;
  - paid-search ordering rechecks configured providers** trusted_search_tool_adapter.py imports complete_trusted_search_producer from the trusted_search_urls permissions module and seven names (including the constant DEFAULT_SEARCH_MAX_RESULTS and the run/render helpers) from search_tools;
  - on paid-search success it calls complete_trusted_search_producer(tool_name="mcp_paid_search", success=True, urls=urls) before returning render_paid_search_result.
  - In search_tools, run order prefers the requested provider only if it is in configured_paid_search_providers(), otherwise falls back to that configured list, and each loop iteration re-checks configured_paid_search_providers() so queued calls skip providers whose keys were removed.
  - Consequence: the adapter delegates execution/rendering and lease completion to these imports rather than reimplementing them.
- 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L18–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L18-L29),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L100–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L100-L109),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L565–L585](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L565-L585)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-web-search-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
