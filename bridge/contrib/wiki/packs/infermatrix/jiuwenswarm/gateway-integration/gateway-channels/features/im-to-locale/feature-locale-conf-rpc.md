---
name: feature-locale-conf-rpc
description: 界面语言配置 RPC locale.get_conf / locale.set_conf（app_web_handlers.py）：preferred_language 仅 zh/en 与归一化、本地配置与 E2A 代理双路径、本地回落 zh、BAD_REQUEST/INTERNAL_ERROR 错误码、test_app_web_handlers.py 对 locale 无用例的观察
metadata:
  scope: 只收界面语言 RPC 的行为边界、双路径路由、取值规则、入口契约与单测覆盖观察；逐分支实现断言与推断取舍归 feature-depth-locale-conf-rpc
---
# 界面语言配置 RPC（preferred_language）— Gateway Web Handler

## 现状

- **支持的行为与边界**
- 功能是界面语言的读取与更新，语言集合固定为中文/英文两种，输入做大小写与空白归一化（`strip().lower()`），因此 `"EN "`、`"Zh"` 均可被接受。
  - 转发路径下语言状态由所选 AgentServer 的用户目录持有（set_conf 的 docstring 称 "Update preferred language in the selected AgentServer directory"），依赖 `jiuwenswarm.gateway.routing.e2a_proxy` 与 `jiuwenswarm.common.schema.message.ReqMethod` 两个协作方。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3824–L3850](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3824-L3850),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3860–L3865](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3860-L3865)
- **双路径路由：本地配置 vs E2A 代理**
- 两个 handler 都用 `_resolve(agent_client)` 解析当前 Agent 客户端，并在其为 `None` 或被 `is_legacy_shared_directory_client` 判定为 legacy 共享目录客户端时走本地路径：get 从 `get_config()` 读 `preferred_language`，set 调 `update_preferred_language_in_config(lang)` 写回。注意 set handler 先在参数校验（L3832–L3850）通过后才于 L3851 调 `_resolve`。
  - 非 legacy 时经 `proxy_unary_request` 以 `ReqMethod.LOCALE_GET_CONF` / `LOCALE_SET_CONF` 转发到所选 AgentServer，携带 `session_id` 与 `user_id`，set 只透传归一化后的 `{"preferred_language": lang}`；这与 document.persist/document.formats 等共用同一 E2A 代理机制。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3724–L3751](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3724-L3751),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3803–L3822](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3803-L3822),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3841–L3865](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3841-L3865)
- **preferred_language 配置项与取值规则**
- 配置键名为 `preferred_language`。本地 get 分支读取 `get_config()` 中的该键，空值回落 `"zh"`，经 `strip().lower()` 后不在 `("zh", "en")` 内也回落 `"zh"`——这一默认与回落逻辑仅适用于本地/legacy 分支，代理读路径的行为未在所示代码中体现。
  - 本地 set 分支通过 `update_preferred_language_in_config(lang)` 持久化（L3857 的日志措辞为"写回 config.yaml 失败"，持久化目标的进一步细节未在所示范围内展示），写失败时 RPC 返回 `ok=False`、`code="INTERNAL_ERROR"`。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3804–L3816](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3804-L3816),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3851–L3859](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3851-L3859)
- **locale.get_conf / locale.set_conf 入口契约**
- 两个 handler 签名均为 `(ws, req_id, params, session_id, user_id=None)`。`locale.set_conf` 要求 params 为 dict 且 `preferred_language` 为字符串，经 `strip().lower()` 归一化后必须是 `"zh"` 或 `"en"`，否则返回 `ok=False`、`code="BAD_REQUEST"`（含非 dict params 与非字符串两种错误）；校验通过后走本地写回或 E2A 代理。
  - `locale.get_conf` 的本地分支成功时返回 `ok=True`、`payload={"preferred_language": lang}`；本地分支异常时返回 `ok=False`、`code="INTERNAL_ERROR"`。所示代码范围未包含 RPC 方法名到 handler 的注册映射，无法据此确认挂载方式。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3795–L3822](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3795-L3822),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3824–L3850](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3824-L3850)
- **本地白名单回退仅限本地分支；代理分支直接转发**
- get 的白名单校验与静默回退（空值或非法值回落 `"zh"`）只出现在本地/legacy 分支；代理分支通过 `proxy_unary_request` 以空 params 转发 `ReqMethod.LOCALE_GET_CONF`，其响应行为不在所示代码内。因此不能概括为「读路径总能返回可用语言」——本地分支在读配置抛异常时即返回 `INTERNAL_ERROR`。set 侧则在 Gateway 前置校验语言值，非法输入直接拒绝而不透传；
  - 本地写回 `update_preferred_language_in_config` 失败同样以 `INTERNAL_ERROR` 上报（L3856–L3858 的日志措辞为「写回 config.yaml 失败」，持久化目标细节未在所示范围展示）。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3804–L3822](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3804-L3822),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3851–L3865](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3851-L3865)
- **Web handler 单测模式与 locale 覆盖情况**
- 验证入口是 `tests/unit_tests/gateway/test_app_web_handlers.py`：用例通过 `_register_web_handlers(WebHandlersBindParams(channel=FakeWebChannel(), ...))` 完成绑定后，直接以 `(ws, req_id, params, session_id[, user_id])` 调用 `channel.methods["<method>"]`，
  - 并对响应字典断言 `ok`/`code`/`payload`（如 session.list 的 E2A 转发契约、heartbeat 的 SERVICE_UNAVAILABLE/NOT_FOUND 错误码）。所示 FakeWebChannel 仅显式展示 `channel_id` 与 `methods` 字典（L34–L37），各用例断言的 `channel.responses[-1]` 依赖其未在摘录内展示的记录行为。
  - 在该测试文件的所示摘录中未出现针对 `locale.get_conf` / `locale.set_conf` 的用例——这是对所示片段的有界观察，不代表整个仓库或本文件其余部分没有 locale 测试。
- Sources / 来源：[tests/unit_tests/gateway/test_app_web_handlers.py:L16–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_web_handlers.py#L16-L37),
  - [tests/unit_tests/gateway/test_app_web_handlers.py:L545–L577](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_web_handlers.py#L545-L577),
  - [tests/unit_tests/gateway/test_app_web_handlers.py:L427–L454](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_web_handlers.py#L427-L454)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-locale-conf-rpc.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3824-L3850；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3860-L3865
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3724-L3751；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3803-L3822
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3841-L3865；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3804-L3816
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3851-L3859；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3795-L3822
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3804-L3822；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3851-L3865
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_web_handlers.py:L16-L37；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_web_handlers.py:L545-L577
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_web_handlers.py:L427-L454
- 源页字段（feature）：locale-conf-rpc
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
