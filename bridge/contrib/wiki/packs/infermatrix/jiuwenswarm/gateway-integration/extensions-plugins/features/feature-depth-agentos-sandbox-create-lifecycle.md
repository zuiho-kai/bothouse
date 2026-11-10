---
name: feature-depth-agentos-sandbox-create-lifecycle
description: AgentOS 沙箱创建与幂等对账实现深读：RegistryClient.enabled 与本地回退、cleanup_stale_sandboxes 依赖注入、等待创建的超时与失败异常、清理循环逐条容错、get/删除/列举单测、Router 连接预热、get_agent 的 acquire 语义
metadata:
  scope: 只收 RegistryClient、cleanup_stale_sandboxes、AgentManager 等的实现级证据；功能概览归 feature-agentos-sandbox-create-lifecycle
---
# AgentOS 沙箱创建与幂等对账：实现深读

## 现状

- [[feature-agentos-sandbox-create-lifecycle]]（功能概览） · [[extensions-plugins-overview]]（owner 入口）
- **RegistryClient.enabled 由 _base_url 决定，禁用时 list_instances 回退到本地 _registered_agents** enabled 即 bool(self._base_url)。list_instances 在 not self.enabled 时不发 GET api/instances，而是把 _registered_agents 中的 info 转成 InstanceRecord 并用 _instance_matches 按 node/framework/kind/user/include_unhealthy 过滤后返回。
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/registry_client.py:L338–L339](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/registry_client.py#L338-L339),
  - [jiuwenswarm/extensions/agentos/agentos_router/registry_client.py:L495–L535](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/registry_client.py#L495-L535)
- **cleanup_stale_sandboxes 依赖注入 YuanRong、Registry、AgentManager，registry.enabled 关闭即返回 0** 该函数以关键字参数注入 YuanrongFrontendAgentClient、RegistryClient 与 AgentManager；当 registry.enabled 为假时直接返回 0，不发起 list_instances，实例列举经由 registry.list_instances(include_unhealthy=True)。
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L22–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py#L22-L53)
- **等待创建时按状态抛 AgentCreatingTimeout/AgentDeleted/AgentCreateFailed；_mark_creator_failed 仅作用于仍是 owner 的 runtime** 创建等待路径在超时（含 AGENT_CREATING_TIMEOUT 消息）、runtime.is_deleted()、is_failed() 时分别抛 AgentCreatingTimeout、AgentDeleted、AgentCreateFailed。
  - _mark_creator_failed 在锁内确认 _runtimes.get(key) 仍是 owner_runtime 才 mark_failed；对 asyncio.CancelledError 只记 WARNING 日志并直接 return，不 logger.exception。
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L406–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L406-L412),
  - [jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L507–L534](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L507-L534)
- **清理循环逐条容错：单条失败不中断，但返回值只计尝试数** 设计推断（非作者历史意图）：
- 收益：单条 _cleanup_one 异常仅 logger.exception 后继续处理其余记录，启动期清理不会因一行坏数据而中断；代价（推断）：processed 统计的是尝试条数而非成功销毁数，调用方无法从返回值区分部分失败。is_closed 回调为真时提前 break。
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L61–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py#L61-L78)
- **test_agent_manager_get_delete_and_list 运行时验证 get/删除/列举契约** 该 asyncio 测试先 get_or_create_agent("u1","jiuwenswarm")，断言 get_agent 返回的快照 info 与 created.info 相等且 list_user_agents 含该 agent_id；随后 delete_agent 并断言 get_agent 返回 None、list_user_agents 为空列表。断言覆盖 AgentManager 本身，属 helper 级运行时验证。
- 来源：[tests/unit_tests/extensions/test_agentos_agent_manager.py:L127–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_agentos_agent_manager.py#L127-L141)
- **Router 连接预热：get_or_create_agent(acquire=True) 后建立 WS 客户端** router_client 的连接预热回调先查 self._closed 提前返回，再以 BUILTIN_AGENT_TYPE 调用 _agent_manager.get_or_create_agent(user_id, agent_type, creator=self._create_agent, acquire=True)，拿到 runtime 后继续执行 await self._get_ws_client(runtime)。
  - envelope 路径 _resolve_agent 则从 envelope 取 user_id，并以 key_values/metadata 携带 session_id 委托同一入口，acquire 由调用方传入（默认 False）。
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L878–L896](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L878-L896),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2243–L2258](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2243-L2258)
- **get_agent：加锁查询，acquire=True 仅在 runtime.is_ready() 时递增 task_count** get_agent(user_id, agent_type, *, key_values=None, acquire=False) 在 _runtimes_lock 内查 key，未命中返回 None；仅当 acquire=True 且 runtime.is_ready() 成立才调用 _acquire_locked，随后返回 runtime.snapshot()。
  - 调用方须配对 release(key)：release 对已消失的 runtime 是空操作，否则把 task_count 减一（不低于 0）并 touch 更新 last_active_at。
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L414–L436](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L414-L436),
  - [jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L451–L461](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L451-L461),
  - [jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L98–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L98-L99)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-depth-agentos-sandbox-create-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/registry_client.py:L338-L339
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/registry_client.py:L495-L535；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L22-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L406-L412；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L507-L534
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L61-L78；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_agentos_agent_manager.py:L127-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L878-L896；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2243-L2258
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L414-L436；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L451-L461
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L98-L99
- 源页字段（feature）：agentos-sandbox-create-lifecycle
- 入口（entry_points）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py；jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py；jiuwenswarm/extensions/agentos/agentos_router/config.py；jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py
