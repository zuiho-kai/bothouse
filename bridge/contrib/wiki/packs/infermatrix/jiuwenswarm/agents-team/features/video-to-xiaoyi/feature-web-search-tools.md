---
name: feature-web-search-tools
description: MCP 免费与付费搜索工具概览：mcp_free_search / mcp_paid_search、duckduckgo / bing 引擎与付费 provider 回退、max_results 与 timeout 夹取、可信搜索溯源租约、职责分层
metadata:
  scope: 只收搜索工具的功能概览（验证入口、行为、取舍、入口契约、职责分层）；free/paid 搜索流程、错误字符串、provider 配置、单测与依赖的实现级细节归 feature-depth-web-search-tools-1、feature-depth-web-search-tools-2
---
# MCP Free/Paid Search Tools with Trusted-Search Provenance Lease

## 现状

- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 本次展示的输入中未包含测试文件，无法从证据中指出该功能的测试入口；未出现在部分输入中不证明测试不存在。可观察的运行时校验行为包括：`normalize_search_max_results` 与 timeout 夹取、前端表单必填校验（blur 触发的非空 validator）及保存失败错误展示。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/search_tools.py:L36–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L36-L39),
  - [jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx:L96–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx#L96-L110)
- **已实现行为**
- 免费搜索支持 duckduckgo、duckduckgo-jina（经 r.jina.ai）与 bing 三种引擎，但只有被环境变量启用的引擎才会尝试，按顺序取第一个返回非空结果的引擎。付费搜索在 `provider="auto"` 时按配置了密钥的 provider 顺序依次尝试，首个成功的 runner 结果即返回（并非遍历全部）；指定 provider 若未配置密钥则回退到已配置列表。provenance 集成在适配器文档串中明确为可选（optional one-shot lease）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/search_tools.py:L302–L328](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L302-L328),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L570–L594](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L570-L594),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L3–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L3-L8)
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 免费引擎用正则解析 HTML/Markdown（result__a、b_algo 块、r.jina.ai 的 markdown 链接），并对 DDG 反爬页（202/418/429/503 或 anomaly.js 标记）显式报错后回退到下一引擎——无需官方 API，但依赖页面结构，易随布局变化失效。付费搜索提供多 provider 回退与密钥缺失时跳过 runner 的保护（注释说明队列中的调用可能超出 provider 配置存活期），但没有任何已配置密钥时仍会直接失败，并非可用性保证；
  - provenance lease 的一次性关闭语义依赖未展示的 `complete_trusted_search_producer` 实现，此处只能确认 `finally` 中无条件调用 `success=False`。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/search_tools.py:L184–L215](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L184-L215),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L567–L594](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L567-L594),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L67–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L67-L71)
- **公开工具入口与调用契约**
- 适配器导出两个 MCP 工具对象：`mcp_free_search`（query、max_results=8、timeout_seconds=20）与 `mcp_paid_search`（额外 provider="auto"，timeout 默认 45）。两者都会对入参做夹取：max_results 经 `normalize_search_max_results` 夹到 1–20，timeout 分别夹到 5–60 与 10–120；
  - 空 query 或 free/paid 搜索失败时返回 `[ERROR]: ...` 字符串而不是抛异常（`_run_paid_search` 还会在内部把 provider 规范化并校验为 auto/bocha/jina/serper/perplexity，`_ConfiguredPaidSearchTool.invoke` 会把未配置密钥的 provider 重写为 auto 后再交给 LocalFunction 校验）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L36-L55),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L84–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L84-L99),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L120–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L120-L135),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L36–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L36-L39)
- **职责分层与执行/溯源数据流**
- `search_tools.py` 是中立的搜索实现（不注册工具、不依赖权限设施），`trusted_search_tool_adapter.py` 是唯一的 MCP Tool 对象 owner 并桥接溯源租约。执行路径不对称：free 适配器自己用 `asyncio.to_thread(run_free_search_structured, ...)` 包装同步实现；paid 适配器直接 `await run_paid_search_structured(...)`，由该 async 函数内部对每个同步 runner 再 `asyncio.to_thread`。
  - 两个工具成功时都在渲染结果之前调用 `complete_trusted_search_producer(success=True, urls=...)` 提交结构化 URL，`finally` 中再以 `success=False` 无条件收尾（一次性租约语义，成功提交在前即已生效）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L3–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L3-L8),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L50–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L50-L71),
  - [jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L92–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L92-L114),
  - [jiuwenswarm/agents/harness/common/tools/search_tools.py:L584–L594](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/search_tools.py#L584-L594)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-web-search-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L36-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx:L96-L110
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L302-L328；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L570-L594
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L3-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L184-L215
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L567-L594；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L67-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L36-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L84-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L120-L135
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L50-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py:L92-L114；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/search_tools.py:L584-L594
- 源页字段（feature）：web-search-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/definition.ts
  - jiuwenswarm/agents/harness/common/tools/search_tools.py
