---
name: feature-depth-a2x-registry-client-sdk
description: A2X Registry Client SDK 实现深读：restore_to_blank、release_my_lease、create_dataset 默认值、replace_agent_card 遇 NotFoundError 的清理、_blank_endpoints 无锁缓存与单测断言
metadata:
  scope: 只收A2X Registry Client SDK 的逐函数实现细节与行为断言；功能概览归 feature-a2x-registry-client-sdk
---
# A2X Registry Client SDK — mirrored sync/async service registry client：实现深读

## 现状

- [[feature-a2x-registry-client-sdk]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **Sync restore_to_blank for an owned agent: resolve endpoint, build blank card, replace card** After the _assert_owned guard passes, _resolve_endpoint supplies the endpoint, build_blank_agent_card builds the card, and replace_agent_card overwrites the service;
  - the docstring notes L3 raises ValueError when neither the L1 cache nor the current card yields an endpoint.
- 来源：[jiuwenswarm/agents/harness/team/a2x/client/client.py:L365–L388](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L365-L388)
- **release_my_lease：本地 _assert_owned 授权后 DELETE 租约路径，幂等返回 bool** 同步 A2XRegistryClient.release_my_lease(dataset, service_id) 先 _assert_owned（只能释放自己注册的 sid），随后 DELETE _i.service_lease_path(dataset, service_id)，按响应 JSON 的 "released" 返回 bool；无租约时返回 False 而不报错。
- 来源：[jiuwenswarm/agents/harness/team/a2x/client/client.py:L515–L530](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L515-L530)
- **create_dataset 的 embedding_model 默认取 _i.DEFAULT_EMBEDDING_MODEL** A2XRegistryClient.create_dataset 的 embedding_model 参数默认值为 _internal.DEFAULT_EMBEDDING_MODEL，formats 默认 _i.UNSET；调用方未传时 body 由 _i.build_create_dataset_body 用这些默认值构造，POST 到 _i.DATASETS_ROOT。
- 来源：[jiuwenswarm/agents/harness/team/a2x/client/client.py:L99–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L99-L107)
- **replace_agent_card 遇 NotFoundError：清本地 owned/blank_endpoints 后原样上抛** 异步 replace_agent_card 在 POST a2a_register_path 抛 NotFoundError 时，await to_thread 移除 owned 条目并 pop _blank_endpoints 缓存，然后 re-raise；
  - 而 release_lease=True 时 release_my_lease 抛 A2XConnectionError/ServerError/NotFoundError 只 warnings.warn（租约靠 TTL 过期），注册结果仍正常返回。
- 来源：[jiuwenswarm/agents/harness/team/a2x/client/async_client.py:L256–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/async_client.py#L256-L281)
- **Async client keeps _blank_endpoints cache lock-free, relying on event-loop serialization** 设计推断（非作者历史意图）：
- Benefit (inference): the pure in-memory dict avoids per-access locking overhead. Cost: correctness depends on the event loop serializing access, per the code comment — the stated rationale is local to this implementation.
- 来源：[jiuwenswarm/agents/harness/team/a2x/client/async_client.py:L58–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/async_client.py#L58-L60)
- **Runtime helper test asserts blank-card replacement via a faked SDK client, not the real client** test_teammate_destroy_restore_replaces_agent_card monkeypatches sys.modules so AsyncA2XRegistryClient is _FakeAsyncA2XRegistryClient,
  - then asserts restore_teammate_blank_agent_on_destroy returns True, one client instance exists, closed is True, and card_replacements records dataset "team_pool", service_id "blank-service-id", a blank card with description "__BLANK__" and release_lease True.
  - This validates the runtime helper against a mock; the real SDK's replace path is not exercised. NOT EXECUTED here.
- 来源：[tests/unit_tests/agentserver/test_a2x_client_init.py:L272–L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_a2x_client_init.py#L272-L308)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-a2x-registry-client-sdk.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L515-L530；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L99-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/async_client.py:L256-L281；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/async_client.py:L58-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L365-L388；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_a2x_client_init.py:L272-L308
- 源页字段（feature）：a2x-registry-client-sdk
- 入口（entry_points）：jiuwenswarm/agents/harness/team/a2x/client/__init__.py；jiuwenswarm/agents/harness/team/a2x/client/async_client.py；jiuwenswarm/agents/harness/team/a2x/client/client.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/a2x/client/__init__.py；jiuwenswarm/agents/harness/team/a2x/client/async_client.py；jiuwenswarm/agents/harness/team/a2x/client/client.py；jiuwenswarm/agents/harness/team/a2x/client/_internal.py；jiuwenswarm/agents/harness/team/a2x/client/errors.py
  - jiuwenswarm/agents/harness/team/a2x/client/models.py；jiuwenswarm/agents/harness/team/a2x/client/transport.py；jiuwenswarm/agents/harness/team/a2x/client/ownership.py
