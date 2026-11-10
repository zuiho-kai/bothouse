---
name: feature-depth-locale-conf-rpc
description: 界面语言配置 RPC 实现深读：set_conf 本地写回分支与异常响应、非 dict params 的 BAD_REQUEST、本地分支默认 zh、对 e2a_proxy 的耦合、get_conf 双路径取舍的推断（中英文混排）
metadata:
  scope: 只收 locale.get_conf / locale.set_conf 的逐分支实现细节；功能行为边界与单测覆盖观察归 feature-locale-conf-rpc
---
# 界面语言配置 RPC（preferred_language）：实现深读

## 现状

- [[feature-locale-conf-rpc]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **locale.set_conf 在无 agent 客户端或旧版共享目录客户端时的本地写回分支** 在 locale.set_conf 处理回调内，若 _resolve(agent_client) 返回 None 或是旧版共享目录客户端，则调用 update_preferred_language_in_config(lang) 写回配置，成功时以 ok=True、payload={"preferred_language": lang} 响应；若写回抛异常，记录 warning 并以 ok=False、error=str(e)、code="INTERNAL_ERROR" 响应。
  - 两条路径均随后 return，不进入代理分支；仅在非本地分支才以 params={"preferred_language": lang}、req_method=ReqMethod.LOCALE_SET_CONF 调用 proxy_unary_request 转发。
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3851–L3865](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3851-L3865)
- **locale.set_conf requires a dict params object with a string preferred_language; non-dict gets BAD_REQUEST** _locale_set_conf rejects params that are not a dict with channel.send_response(ok=False, error="params must be object", code="BAD_REQUEST") and returns;
  - it then reads params.get("preferred_language") and guards that it is a str. _locale_get_conf/set_conf share the web-handler callback signature (ws, req_id, params, session_id, user_id=None).
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3824–L3836](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3824-L3836)
- **Local-branch language default is "zh" via cfg.get("preferred_language") or "zh", lowercased and stripped** In the local/legacy branch of _locale_get_conf, a missing or falsy preferred_language in get_config() yields "zh" after strip().lower() normalization;
  - this default applies only to that branch, not the proxied AgentServer path.
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3803–L3807](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3803-L3807)
- **Handlers couple to e2a_proxy (proxy_unary_request, is_legacy_shared_directory_client) and ReqMethod.LOCALE_GET_CONF** Both locale handlers import proxy_unary_request from jiuwenswarm.gateway.routing.e2a_proxy inside the callback;
  - get_conf also imports is_legacy_shared_directory_client to route legacy shared-directory clients to the local config read instead of the AgentServer proxy.
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3795–L3807](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3795-L3807),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3824–L3836](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3824-L3836)
- **Non-dict params to locale.set_conf return ok=False with error "params must be object" and code BAD_REQUEST** The guard `if not isinstance(params, dict)` sends the error response and returns from the handler; no downstream proxy call or config write occurs on that branch.
  - The shown lines do not cover the non-string preferred_language branch's response.
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3832–L3836](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3832-L3836)
- **get_conf dual paths: local fallback defaults to "zh", proxy path forwards to AgentServer (inferred pros and cons)** 设计推断（非作者历史意图）：
- When resolved_client is None or a legacy client, _locale_get_conf reads preferred_language from local get_config() and normalizes it with `or "zh"` then strip().lower() as a fallback; on the non-local path, it is forwarded as an empty params via ReqMethod.LOCALE_GET_CONF.
  - Inferred benefit: legacy/single-machine deployments can still obtain a language configuration with a default value; cost: the same RPC has two language value sources (local config.yaml vs AgentServer), and maintenance needs to be synchronized.
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3795–L3807](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3795-L3807),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3818–L3822](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3818-L3822)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-locale-conf-rpc.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3824-L3836；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3803-L3807
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3795-L3807；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3832-L3836
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3818-L3822；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3851-L3865
- 源页字段（feature）：locale-conf-rpc
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
