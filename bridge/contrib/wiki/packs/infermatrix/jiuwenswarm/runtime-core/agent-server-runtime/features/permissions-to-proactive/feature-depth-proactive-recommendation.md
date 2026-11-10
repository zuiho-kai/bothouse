---
name: feature-depth-proactive-recommendation
description: 主动推荐、频率限制与主 Agent 交付实现深读：init_proactive_engine 到 build_proactive_agent 的启动装配链、enabled/max_recommend_per_day/max_rounds_per_tick 默认值与 1-50 区间、tick_now 契约、ImportError 降级为 None、初始化异常不重抛、改走 agent 框架 invoke 的取舍、_analyze_and_decide 单测
metadata:
  scope: 收 proactive_engine.py 与 proactive_adapter.py 的实现级证据，来源另含 proactive_actions.py、test_proactive_adapter_runtime_boundary.py、test_proactive_recommendation_flow.py；功能概览、设置字段名与验证步骤归 feature-proactive-recommendation
---
# 主动推荐、频率限制与主 Agent 交付：实现深读

## 现状

- [[feature-proactive-recommendation]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **启动装配链：init_proactive_engine → build_proactive_agent → _get_model** AgentServer 启动时 init_proactive_engine(server, config) 构造 ProactiveEngine，随后直接调用 build_proactive_agent()；
  - 后者再调用 proactive_actions._get_model(temperature=0.0) 取默认模型并禁用 thinking，最后用该模型 create_deep_agent 生成无工具、单轮的决策专用 agent，经 set_proactive_agent 注入引擎并挂到 server 上。
- 调用路径：`jiuwenswarm/server/runtime/proactive_adapter.py`（`init_proactive_engine`） → `jiuwenswarm/server/runtime/proactive_adapter.py`（`build_proactive_agent`） → `jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py`（`_get_model`）
- 来源：[jiuwenswarm/server/runtime/proactive_adapter.py:L393–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L393-L451),
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L85–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L85-L117),
  - [jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py:L235–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py#L235-L269)
- **proactive 数值与开关的默认值及合法区间** ProactiveEngine.__init__ 读取 enabled（默认 False，防御性默认=关闭，配置段缺失时不会误启用）、max_recommend_per_day（默认 5）、max_rounds_per_tick（默认 20），数值经 _safe_proactive_int 校验，合法区间为 1–50（_PROACTIVE_INT_LO/_PROACTIVE_INT_HI）；前端这两个数值位于"推荐频率限制"弹窗，同样限 1–50 整数。
  - reload_config 热更新时当日计数 _daily_counts 不重置，以保持上限语义。
- 来源：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L34–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L34-L36),
  - [jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L78–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L78-L161),
  - [docs/zh/设置与频道升级迁移指南.md:L183–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L183-L188)
- **tick_now 契约：enabled 为假即 False；异常转 False；_tick 触发成功立即返回 True** 对外入口 `tick_now(target_channel=None) -> bool`（docstring 称供 CronScheduler/手动触发）：`enabled` 为假→debug 日志+return False；否则 `bool(await self._tick(...))`，任何 Exception→warning+False。`_tick` 尾部：`triggered` 为假→info 日志、更新 `_last_tick_at`、False；
  - 为真→立即 return True（注释称 fire-and-forget，计数由 `_on_delivered` 回调完成）。
- 来源：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L163–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L163-L188),
  - [jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L423–L434](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L423-L434)
- **依赖 proactive_actions._get_model 与 openjiuwen 工厂；ImportError 降级为 None，且测试禁止耦合 agent_ws_server** 决策 agent 复用 proactive_actions._get_model，经 openjiuwen 的 create_deep_agent/AgentCard 构建；ImportError 时记 warning 返回 None，tick 因无 agent 直接返回 False。
  - 另有测试断言本模块源码文本不含 jiuwenswarm.server.agent_ws_server 与 WebSocketGatewayPushTransport。
- 来源：[jiuwenswarm/server/runtime/proactive_adapter.py:L92–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L92-L103),
  - [jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L301–L304](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L301-L304),
  - [tests/unit_tests/agentserver/test_proactive_adapter_runtime_boundary.py:L36–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_proactive_adapter_runtime_boundary.py#L36-L39)
- **init_proactive_engine 捕获初始化异常不重抛；agent 构建失败降级为 None 且仍传入引擎** `init_proactive_engine` 的 try（引擎构建至 449 `server.set_proactive_engine`）内任何 Exception 在 450-451 被捕获：记 warning、不再抛出；若发生在 449 之前，引擎不会被挂到 server。
  - agent 构建侧已示分支在 import 失败、`_get_model` 返回 None（无模型）或 `create_deep_agent` 异常时记 warning 并 return None，而 406-407 仍把该结果传给 `set_proactive_agent`。
- 来源：[jiuwenswarm/server/runtime/proactive_adapter.py:L393–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L393-L451),
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L97–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L97-L117)
- **决策改走 agent 框架 invoke 链路换取 rails/模型选择/观测（docstring 自述），推断代价为 openjiuwen 导入失败即停摆** 设计推断（非作者历史意图）：
- 收益（docstring 自述）：替代裸 model.invoke，走 agent 框架 invoke 链路获得 rails/模型选择/观测；推断代价：新增 openjiuwen 导入链，ImportError 时决策 agent 为 None、tick 直接跳过。
- 来源：[jiuwenswarm/server/runtime/proactive_adapter.py:L86–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L86-L98),
  - [jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L301–L304](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L301-L304)
- **决策解析 helper 的直调异步测试断言（仅覆盖 _analyze_and_decide，非引擎全链路）** 两个 `@pytest.mark.asyncio` 测试直接 await 真实 `_analyze_and_decide`：mock 专用 agent 返回 JSON 时断言 `result.decision.type == "skill_recommend"`、target 与 urgency 0.7（415-420）；agent 返回非 JSON（"这不是JSON"）时断言 `result.decision is None`（434-435）。
  - 断言只覆盖该决策解析 helper；所示行未断言引擎 tick/主 Agent 交付链路。未执行，仅引用既有测试行。
- 来源：[tests/symphony/test_proactive_recommendation_flow.py:L401–L420](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/symphony/test_proactive_recommendation_flow.py#L401-L420),
  - [tests/symphony/test_proactive_recommendation_flow.py:L423–L435](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/symphony/test_proactive_recommendation_flow.py#L423-L435)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-proactive-recommendation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/proactive_adapter.py:L393-L451；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/proactive_adapter.py:L85-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py:L235-L269
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L34-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L78-L161；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/设置与频道升级迁移指南.md:L183-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/proactive_adapter.py:L92-L103；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L301-L304
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_proactive_adapter_runtime_boundary.py:L36-L39；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/proactive_adapter.py:L86-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L163-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L423-L434；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/proactive_adapter.py:L97-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/symphony/test_proactive_recommendation_flow.py:L401-L420；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/symphony/test_proactive_recommendation_flow.py:L423-L435
- 源页字段（feature）：proactive-recommendation
- 入口（entry_points）：jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py；jiuwenswarm/server/runtime/proactive_adapter.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py；jiuwenswarm/server/runtime/proactive_adapter.py
