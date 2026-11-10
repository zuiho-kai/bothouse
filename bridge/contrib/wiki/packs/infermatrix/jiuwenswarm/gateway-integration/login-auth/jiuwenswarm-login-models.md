---
name: jiuwenswarm-login-models
description: 登录模型目录与跨进程凭据句柄：Gateway 凭据消毒与 credential_ref 句柄注入、AgentServer 句柄登记表与 httpx 请求钩子、登录模型目录缓存（passthrough.py、login_credentials.py、model_catalog.py）
metadata:
  scope: 只收登录模型在 Gateway 与 AgentServer 间的凭据传递与目录缓存；OAuth 登录与加密会话持久化归 jiuwenswarm-common-auth
---
# 登录模型目录与跨进程凭据句柄

## 现状

### 职责和边界

- 说明登录模型在 Gateway 与 AgentServer 间的凭据传递、稳定句柄、请求钩子和目录缓存；OAuth 登录与加密会话持久化见登录主页面。

### Gateway 凭据消毒与句柄注入

- `normalize_model_auth` 就地改 params：**无条件先删**客户端传来的 `_model_auth` 键（原值非 None 时告警），前端塞什么都作废；之后仅当「有 session_id + APIG 已配置 + 是登录模型（`#index` 后缀取裸名比对）」才由服务端填 `{api_base, api_key(id_token), credential_ref}`。这条路径上所有取数都 `allow_refresh=False`（不为目录或 token 发同步 HTTP）；
  - 取不到凭据不抛错、只是不注入——AgentServer 侧解析模型时会走到同样的判断并给出面向用户的提示（[passthrough.py L27-L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/passthrough.py#L27-L136)）。
  - 测试 `test_client_supplied_auth_is_always_dropped`、`test_request_without_session_gets_nothing_even_if_someone_is_logged_in`、`test_catalog_lookup_never_triggers_a_network_refresh`、`test_expired_session_injects_nothing_instead_of_raising`。
- `credential_ref` = HMAC-SHA256(派生密钥, `jiuwen-login-credential:<openid>`) 的前 32 位 hex：密钥派生自本机主密钥，单拿 openid 算不出句柄；
  - **按账号不按会话**——重新登录会换 session id，句柄不变，新 token 经带凭据请求或更新推送登记后，在跑的成员下一次调用可查到更新值（会话存储同一账号只留一个会话，正好配套）（[login_credentials.py L128-L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L128-L151)）。
  - 测试 `test_credential_ref_is_keyed_so_openid_alone_does_not_give_it`、`test_logging_in_again_keeps_the_credential_ref`。
- `refreshed_credential_for_ref` 响应 AgentServer 发起的续期：按句柄逐账号重算 HMAC 找会话（单向、本机会话少）；找不到会话、或续不了且已过期 → 回 `{credential_ref, revoked: True}` 让 AgentServer 立即停用；
  - 暂时失败但旧 token 还能用 → 照旧返回旧 token，AgentServer 按重试节奏再来（[passthrough.py L89-L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/passthrough.py#L89-L121)）。
  - 测试 `test_gateway_revokes_when_expired_and_refresh_fails`、`test_gateway_keeps_the_old_token_when_refresh_fails_but_it_is_still_valid`、`test_gateway_finds_the_account_after_it_logged_in_again`。

### AgentServer 句柄登记表与请求钩子

- 模型配置里的 api_key 只是占位值 `jiuwen-login:<ref>`：真 token 一小时一换，而配置交出去收不回（集群成员创建时就定了 api_key，追问投递给在跑的团队不会重建成员；SDK 还按 `(api_key, api_base, …)` 缓存 HTTP 客户端）。带凭据的请求到达时 `login_auth_from_params` 校验 api_base/api_key/ref（32 位 hex）后登记进本进程表，登记 TTL 2 小时；
  - 该登录模型条目的 api_key 使用占位句柄，真 token 留在登记表中（[login_credentials.py L1-L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L1-L29)、
  - [L50-L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L50-L68)、
  - [L302-L315](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L302-L315)）。测试 `test_forwarded_credentials_are_registered_and_replaced_by_a_placeholder`、`test_incomplete_credentials_count_as_absent`。
- 推送通道只能换 token、不能造登记：`update_token` 只更新已登记的句柄且接入点不变（推送改不了 token 发往哪里）；收到 `revoked: True` 立即注销句柄，不必等 token 自然过期（[login_credentials.py L181-L223](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L181-L223)）。
  - 测试 `test_push_cannot_create_a_registration`、`test_revoke_stops_the_handle_immediately`。
- httpx 请求钩子 `inject_login_credential`（幂等包住 SDK `_build_async_openai_client`、往 event_hooks **追加**而非替换）：只处理 Bearer 占位值。登记过期/查不到 → 删掉 Authorization 放行，已安装且执行该钩子时，占位 Authorization 不会发出；SDK 钩子安装失败不能据此保证同样行为；目标地址不在登记时的接入点之下（协议 + 主机含端口一致、路径在其下）也删头放行，避免该钩子把登记 token 注入其他接入点；
  - 只有真正替换成功才记「在用」（[login_credentials.py L343-L429](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L343-L429)）。
- 无新请求时的续期：run_refresh_requests 被宿主启动后，默认每 60 秒扫登记表，把「15 分钟内到期 + 最近 20 分钟在用（窗口要盖过长工具调用）+ 距上次请求 ≥2 分钟」的句柄经 server_push `auth.credential.refresh` 只带句柄请 Gateway 续（登记与请求钩子更新时间戳，超过活跃窗口后不再请求续期）；
  - 扫描/发送失败记日志下一轮再试，任务不退出（[login_credentials.py L226-L277](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/login_credentials.py#L226-L277)）。
  - 测试 `test_active_and_expiring_handle_is_due`、`test_idle_handle_is_not_refreshed`、`test_requests_are_throttled_until_retry_interval`。

### 登录模型目录缓存

- 模型列表是**发现**出来的：拿该会话的 id_token 调 APIG，按远端白/黑名单过滤（id 或 display name 小写比对、去重）后写入 `auth/model_catalog.json`（TTL 30 分钟）；内存 memo 有效 = TTL 未过**且**磁盘 mtime 没变（多进程下 Gateway 写缓存、AgentServer 读）。
  - **活动没生效（拉不到配置或 `is_effective=false`）一个都不给**，哪怕本地还有热缓存——这一条统一管住 models.list、目录缓存和请求级凭据透传三个下游（[model_catalog.py L34-L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L34-L47)、
  - [L148-L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L148-L173)、
  - [L200-L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L200-L252)）。测试 `test_campaign_off_yields_no_models_even_with_a_warm_cache`、`test_get_models_uses_cache_without_network`。
- 发现失败进 30 秒冷却（APIG 不通时不让每次 models.list 都撞一次）；「没登录」不算发现失败、不进冷却，登录后立刻能再发现；登出/换号 `clear_cache` 连缓存文件一起删（[model_catalog.py L120-L129](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L120-L129)、
  - [L176-L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L176-L197)）。测试 `test_failed_discovery_is_not_retried_on_every_models_list`、`test_not_logged_in_does_not_start_the_cooldown`。
- `build_model_entry` 供两个调用方共用：Gateway 列表展示（api_key 留空）和 AgentServer 请求级构建（api_key 放占位句柄），**都不放真 id_token**、条目形状必须一致。条目带 `source="huawei-maas-login"` + `read_only` + `is_free`；`is_default: True` 的语义是「进聊天窗口的模型下拉」而非默认模型（配置的模型排前面）；
  - 用户可调的 `context_window` 单独存在 config.yaml `models.login_model_settings.<模型名>`、造条目时合入；写入侧由 `is_login_model` 拦住它们不落 config.yaml（[model_catalog.py L255-L322](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L255-L322)、
  - [L325-L369](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L325-L369)）。测试 `test_build_model_entry_shape`、`test_list_entries_use_apig_invoke_base_and_carry_no_token`、`test_is_login_model`。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-common-auth]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-common-auth]]（原模块架构与入口）
- [[jiuwenswarm-common-model-catalog]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/jiuwenswarm-login-models.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/login_credentials.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/model_catalog.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/passthrough.py
