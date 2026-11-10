---
name: feature-agentos-sandbox-create-lifecycle
description: AgentOS 沙箱创建与幂等对账（agentos_router）：get_or_create_agent 创建与删除入口、RouterConfig 配置项与环境变量覆盖、防双创建优先于自动重试、单飞创建与启动期对账、空闲回收与创建超时幂等对账
metadata:
  scope: 只收 agentos_router 沙箱创建与对账的功能概览五条要点；逐函数的实现证据与单测断言归 feature-depth-agentos-sandbox-create-lifecycle
---
# AgentOS 沙箱创建与幂等对账（jiuwenswarm agentos_router）

## 现状

- **创建与删除入口**
- 核心入口是 AgentManager.get_or_create_agent(user_id, agent_type, key_values, creator, metadata, acquire)：返回 READY 的 AgentRuntime 快照，或由首个到达者（owner）执行 creator 创建，其余并发请求通过 creating_event 等待；acquire=True 时在锁内递增 task_count 并要求调用方配对 release，保证空闲回收不会在解析与使用之间夺走沙箱。
  - Router 层的 delete_agent(user_id, agent_type, key_values, idle_timeout_seconds) 返回是否删除；带 idle_timeout_seconds 时仅删除 READY 且 task_count==0 且空闲超时的 agent。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L314–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L314-L331),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2480–L2493](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2480-L2493)
- **配置项与环境变量覆盖**
- RouterConfig 从 gateway.agentos 段读取：sandbox_idle_timeout_seconds 默认 600（<=0 关闭空闲回收），disconnect_cleanup_timeout_seconds 默认 60，agent_key_fields 默认 (user_id, agent_type)、可选加入 session_id 且前两者必须存在。这两个超时支持环境变量 SANDBOX_IDLE_TIMEOUT_SECONDS / DISCONNECT_CLEANUP_TIMEOUT_SECONDS 覆盖 yaml（显式 0 也生效）；
  - 启用 agentos_router 模式还需必填 gateway.agent_client.frontend_endpoint 与 function_version_urn，否则 load_router_config 抛 ValueError。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/config.py:L60–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/config.py#L60-L73),
  - [jiuwenswarm/extensions/agentos/agentos_router/config.py:L344–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/config.py#L344-L357),
  - [jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L31–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L31-L66)
- **防双创建优先于自动重试**
- 创建失败后 runtime 被钉为 FAILED，后续请求抛 AgentCreateFailed 而不自动重试——注释明示取舍：已取消/失败的 create 可能已 provision 了 YuanRong 沙箱，重试会造出第二个；只有 AgentPreCreateError（workspace 校验等发生在 YuanRong create 之前的失败）才丢弃 runtime 让下次请求重试，避免瞬时错误被永久缓存。删除路径同样取舍：YuanRong delete_sandbox 失败不阻断内存/注册中心清理，孤儿沙箱按 best-effort 留给手工或后续对账兜底。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L365–L373](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L365-L373),
  - [jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L592–L598](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L592-L598),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2517–L2523](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2517-L2523)
- **单飞创建与启动期对账**
- AgentManager.get_or_create_agent 用一把 _runtimes_lock 实现 single-flight：首个到达者成为 owner 执行 creator，后续请求在同一 runtime 的 creating_event 上等待，超时抛 AgentCreatingTimeout、失败抛 AgentCreateFailed。
  - owner 失败默认 mark_failed 钉死 FAILED，但 AgentPreCreateError（发生在 YuanRong create 之前）走 _discard_precreate_failure：移除 runtime 并唤醒等待者重新参与创建，而非缓存失败。启动期 cleanup_stale_sandboxes 列出注册中心全部实例，删除本进程无活跃 runtime 的 YuanRong 沙箱后，以 expected_instance_id 的 CAS 方式注销注册行，避免覆盖并发 upsert 的新实例。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L343–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L343-L412),
  - [jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L536–L553](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py#L536-L553),
  - [jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L42–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py#L42-L78),
  - [jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L172–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py#L172-L178)
- **空闲回收与创建超时幂等对账**
- 空闲回收由后台循环 _idle_reaper_loop 驱动：按 sandbox_idle_check_interval_seconds（默认 30s）周期性执行 _reap_idle_once，后者把 sandbox_idle_timeout_seconds 作为空闲删除阈值传给 delete_agent，因此前者只是检查周期、后者才是回收门槛，二者不可混淆。
  - 创建侧的幂等对账：YuanRong create 抛 YuanrongAgentTimeoutError（可能半成功）时，以完全相同的参数重试一次 _create_sandbox_once——沙箱 name 由 user_id+agent_type 确定性派生，首次请求未达则正常新建、已创建则同名幂等复用，不会产生第二个实例；二次仍失败则按原语义上抛（runtime 标 FAILED，防双创建）。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2319–L2335](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2319-L2335),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2345–L2350](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2345-L2350),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2418–L2444](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2418-L2444)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-agentos-sandbox-create-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L314-L331；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2480-L2493
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/config.py:L60-L73；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/config.py:L344-L357
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L31-L66；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L365-L373
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L592-L598；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2517-L2523
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L343-L412；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py:L536-L553
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L42-L78；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py:L172-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2319-L2335
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2345-L2350
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2418-L2444
- 源页字段（feature）：agentos-sandbox-create-lifecycle
- 入口（entry_points）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py；jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py；jiuwenswarm/extensions/agentos/agentos_router/config.py；jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py
