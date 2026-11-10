---
name: feature-depth-thirdagent-list-switch
description: 3rdagent.list / 3rdagent.switch 实现深读：registry agent 创建一个 sandbox 而 builtin 不创建、ThirdAgent 抽象签名与 normalize_agent_type、不经 E2A send_request、UnsupportedThirdAgent 返回 UNSUPPORTED、模块级单例取舍、对应单测（中英文混排）
metadata:
  scope: 只收第三方智能体切换的逐分支实现细节与单测断言；设计取舍、前提配置与数据流归 feature-thirdagent-list-switch
---
# 3rdagent.list / 3rdagent.switch 第三方智能体切换：实现深读

## 现状

- [[feature-thirdagent-list-switch]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **thirdagent_switch on a registry agent creates one sandbox; on builtin jiuwenswarm it creates none** In the router-client test path,
  - thirdagent_switch(user_id="u1", agent_type="opencode", session_id="sess-1") returns ok with payload.agent_type="opencode" and payload.sandbox_id="sbx-1" after exactly one yuanrong.create; switching to agent_type="jiuwenswarm" returns ok with sandbox_id="" and zero creates.
- 来源：[tests/unit_tests/extensions/test_agentos_router.py:L839–L857](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_agentos_router.py#L839-L857),
  - [tests/unit_tests/extensions/test_agentos_router.py:L1065–L1083](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_agentos_router.py#L1065-L1083)
- **ThirdAgent abstract contract: thirdagent_list and thirdagent_switch keyword-only methods returning dicts** ThirdAgent (ABC) declares abstract async thirdagent_list(*, user_id, current_agent_type="", access_mode="") and thirdagent_switch(*, user_id, agent_type, session_id="", params=None),
  - both returning dict[str, Any]; access_mode selects which registry access_mode[].cmd is returned. normalize_agent_type maps empty or case-insensitive "jiuwenswarm" to "jiuwenswarm", otherwise preserves the raw string's case.
- 来源：[jiuwenswarm/common/client/third_agent.py:L14–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L14-L49)
- **normalize_agent_type default: empty or falsey input becomes "jiuwenswarm"; other stripped names keep case** In ThirdAgent.normalize_agent_type, agent_type = str(raw or "").strip(), so raw that is None, empty,
  - or any falsey value (e.g. 0, False, "") substitutes "" and yields builtin "jiuwenswarm"; only inputs whose str().strip().lower() equals "jiuwenswarm" are lowercased to the builtin, all other stripped names are returned with original case.
  - The abstract thirdagent_list/thirdagent_switch declare keyword-only defaults current_agent_type="", access_mode="" and session_id="", params=None; access_mode selects which registry access_mode[].cmd is returned (TUI passes "tui").
- 来源：[jiuwenswarm/common/client/third_agent.py:L17–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L17-L22),
  - [jiuwenswarm/common/client/third_agent.py:L24–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L24-L37),
  - [jiuwenswarm/common/client/third_agent.py:L39–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L39-L49)
- **3rdagent calls bypass E2A send_request; contract lives in common.client.third_agent re-exported by gateway** AgentOSRouterClient.send_request states 3rdagent.list/switch are handled by the Gateway ThirdAgent (TUI local_handler), not via E2A send_request;
  - the jiuwenswarm.gateway.routing.third_agent module only re-exports ThirdAgent, UnsupportedThirdAgent and get_unsupported_third_agent from jiuwenswarm.common.client.third_agent to keep the old import path working.
- 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1572–L1582](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1572-L1582),
  - [jiuwenswarm/gateway/routing/third_agent.py:L1–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/routing/third_agent.py#L1-L17)
- **未注册扩展时 UnsupportedThirdAgent 各自返回 ok=False、code="UNSUPPORTED"，不抛异常** thirdagent_list 丢弃 user_id/current_agent_type/access_mode，返回 {"ok": False, "error": "3rdagent.list requires an AgentOS Router extension", "code": "UNSUPPORTED"}；
  - thirdagent_switch 丢弃 user_id/agent_type/session_id/params，返回 error 为 "3rdagent.switch requires an AgentOS Router extension"、同样的 code。两个分支在本地返回，不 raise。
- 来源：[jiuwenswarm/common/client/third_agent.py:L55–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L55-L82)
- **模块级单例默认实现换来确定性的 UNSUPPORTED 拒绝，代价是空输入下不提供任何降级列表** 设计推断（非作者历史意图）：
- get_unsupported_third_agent 返回模块级 _UNSUPPORTED_THIRD_AGENT 单例；对本仓内通过 jiuwenswarm.gateway.routing.third_agent re-export 导入的调用方，无扩展时可得到确定性的 ok=False 响应（推断为收益）；代价是即使 list 请求也一律失败、不返回部分目录（推断）。仅限所示实现，不跨仓保证。
- 来源：[jiuwenswarm/common/client/third_agent.py:L52–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L52-L89),
  - [jiuwenswarm/gateway/routing/third_agent.py:L11–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/routing/third_agent.py#L11-L17)
- **test_unsupported_third_agent_returns_unsupported awaits both stub methods and asserts the UNSUPPORTED dicts** The pytest asyncio test imports get_unsupported_third_agent via jiuwenswarm.gateway.routing.third_agent,
  - calls thirdagent_list(user_id="u1", current_agent_type="jiuwenswarm") and thirdagent_switch(user_id="u1", agent_type="opencode", session_id="s1"), asserting listed["ok"] is False, code "UNSUPPORTED", and the same for switched. Evidence of assertions in the test source; not executed here.
- 来源：[tests/unit_tests/extensions/test_agentos_router.py:L1407–L1420](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_agentos_router.py#L1407-L1420)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-thirdagent-list-switch.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_agentos_router.py:L839-L857；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_agentos_router.py:L1065-L1083
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L14-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1572-L1582
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/routing/third_agent.py:L1-L17；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_agentos_router.py:L1407-L1420
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L55-L82；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L52-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/routing/third_agent.py:L11-L17；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L17-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L24-L37；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L39-L49
- 源页字段（feature）：thirdagent-list-switch
- 入口（entry_points）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py；jiuwenswarm/common/client/third_agent.py；jiuwenswarm/gateway/routing/third_agent.py
