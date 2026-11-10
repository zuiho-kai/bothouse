---
name: login-auth-knowledge
description: login-auth 功能知识：远端配置来源与开关（JIUWENSWARM_CONFIG_URL）、AuthService 职责分层与凭据数据流、登录模型目录发现与推理错误分类、测试挂钩、AuthService 入口与模型层取凭据
metadata:
  scope: 只收配置、架构、目录发现、测试入口、API 五段知识；OAuth 流程细节归 jiuwenswarm-common-auth，凭据句柄归 jiuwenswarm-login-models
---
# login-auth：华为账号登录与免费模型凭据（common/auth）

## 现状

- **配置来源与开关**
- 本地唯一的配置项是环境变量 JIUWENSWARM_CONFIG_URL（config_url()）：未设时用 DEFAULT_CONFIG_URL（https://aigw.openjiuwen.com/v1/config），显式设成空串/off/none/false/0/disabled 之一即彻底关闭（一个请求都不发）。
  - 其余配置全部由该远端接口下发：OAuthConfig.from_remote 从 huaweiaccount_login 段读 client_id（默认 118944053）、redirect_uri（默认 http://localhost:19000/api/v1/auth/callback）、scope（默认 openid profile）、exchange_url、callback_url、claim_url、account_center_url；
  - gateway 段给 base_url 与 models/quota/invoke 路径（默认 /v1/models、/v1/usage、/v1），未给 base_url 表示能登录但没有免费模型。
- Sources / 来源：[jiuwenswarm/common/auth/remote_config.py:L45–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/remote_config.py#L45-L49),
  - [jiuwenswarm/common/auth/remote_config.py:L161–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/remote_config.py#L161-L166),
  - [jiuwenswarm/common/auth/account_kit.py:L135–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L135-L151),
  - [docs/zh/华为账号登录.md:L69–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L69-L74)
- **职责分层与凭据数据流**
- AuthService 是各 channel 共用的唯一登录入口，把流程（AccountKitFlow，OAuth2 授权码 + PKCE）和会话（AuthSessionStore）粘起来：发起授权 / 回调 / 认领 / 登出接在 HTTP 路由上，模型层经 live_session / resolve_id_token 取凭据；它以进程级单例 get_auth_service() 提供。
  - 凭据向 AgentServer 的传递由 passthrough.normalize_model_auth 完成：先无条件删除客户端传来的 _model_auth 键，之后仅当请求使用登录模型且能取到该会话凭据时，才由服务端挂上 {api_base, api_key=id_token, credential_ref}；AgentServer 侧模型配置里只放句柄占位值，真实 id_token 按句柄登记进凭据表。
- Sources / 来源：[jiuwenswarm/common/auth/service.py:L3–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L3-L11),
  - [jiuwenswarm/common/auth/service.py:L308–L319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L308-L319),
  - [jiuwenswarm/common/auth/passthrough.py:L27–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/passthrough.py#L27-L57),
  - [docs/zh/华为账号登录.md:L249–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L249-L253)
- **登录模型目录发现与推理错误分类**
- 登录模型是发现出来的：get_models 用登录用户的 id_token 请求 APIG 模型列表，受远端配置门控（config 为 None 或 is_effective=false 一律返回空，本地缓存也不给），进程内 memo 命中需同时满足 30 分钟 TTL 和缓存文件 mtime 未变（Gateway 写、AgentServer 另一进程要读到），刷新失败 30 秒内不再重试并继续用旧目录。
  - 推理错误分类 classify_model_error 有优先级：先匹配 apig.xxxx 错误码（0305/0307/0316/0319 → login_required，0308 → rate_limited），再判额度耗尽（402 状态或 budget_exceeded 等文本提示 → quota_exhausted），然后才是限流；HTTP 状态码只在前缀为 error code / status 的上下文里匹配，裸数字不算。
- Sources / 来源：[jiuwenswarm/common/auth/model_catalog.py:L200–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L200-L252),
  - [jiuwenswarm/common/auth/apig.py:L295–L315](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/apig.py#L295-L315),
  - [jiuwenswarm/common/auth/apig.py:L46–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/apig.py#L46-L48)
- **测试入口与测试挂钩**
- 文档第八节列出验证入口：tests/unit_tests/common/test_auth_*.py 覆盖 auth 模块，tests/unit_tests/gateway/test_web_http_auth_routes.py 走 authorize → callback → claim 全链路。源码为测试提供进程级替换挂钩：reset_auth_service_for_test(service) 直接设置 AuthService 单例，remote_config.set_config_for_test(config) 覆盖缓存的远端配置并复位退避状态；
  - 这些挂钩的存在不证明测试如何替身网络调用，测试体不在本次所示范围内。
- Sources / 来源：[docs/zh/华为账号登录.md:L386–L393](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L386-L393),
  - [jiuwenswarm/common/auth/service.py:L322–L325](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L322-L325),
  - [jiuwenswarm/common/auth/remote_config.py:L300–L305](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/remote_config.py#L300-L305)
- **AuthService 登录入口与模型层取凭据**
- 登录服务的公共入口是进程级单例 `AuthService`（`get_auth_service()` 双检锁构造）。`create_authorization_request()` 返回 `{authorizeUrl, state, claimToken, expiresIn}`，由调用方负责打开浏览器；回调落 ECS 鉴权服务（配置了 `callback_url`）时还会顺带起后台轮询线程去认领授权码。`claim(state, claim_token)` 供发起方取回结果：回调还没到时返回 `None`，登录失败抛 `OAuthError`；
  - `cancel` 放弃本次登录，`logout(session_id)` 只清指定会话（无 id 时什么都不做），`status` 返回不含 token 的登录状态视图。
- 模型层取凭据走模块级函数：`live_session(session_id, allow_refresh=True)` 严格按传入的 session id 解析会话（无 id 即视为未登录，绝不退回「本机唯一登录用户」），拿到会话再经 `ensure_fresh` 保证凭据可用，返回 `AuthSession`；
  - 解析不到会话时抛 `ModelAuthRequired("请先登录后再使用该模型", "not_logged_in")`——构造签名为 `(message, reason="not_logged_in")`，message 是异常文本，`reason` 是单独的属性，供前端区分 `not_logged_in` 与 `session_expired`。`resolve_id_token` 是其便捷形式，直接返回 `credential.id_token` 用于 `Authorization: Bearer` 头。
  - `allow_refresh=False` 供不能阻塞的调用方：续期改在后台线程做，本次先用未过期的旧 token。
- Sources / 来源：[jiuwenswarm/common/auth/service.py:L69–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L69-L79),
  - [jiuwenswarm/common/auth/service.py:L161–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L161-L180),
  - [jiuwenswarm/common/auth/service.py:L312–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L312-L332),
  - [jiuwenswarm/common/auth/service.py:L335–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L335-L357)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/remote_config.py:L45-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/remote_config.py:L161-L166
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/account_kit.py:L135-L151；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/华为账号登录.md:L69-L74
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L3-L11；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L308-L319
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/passthrough.py:L27-L57；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/华为账号登录.md:L249-L253
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/model_catalog.py:L200-L252；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/apig.py:L295-L315
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/apig.py:L46-L48；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/华为账号登录.md:L386-L393
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L322-L325；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/remote_config.py:L300-L305
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L69-L79；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L161-L180
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L312-L332；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L335-L357
