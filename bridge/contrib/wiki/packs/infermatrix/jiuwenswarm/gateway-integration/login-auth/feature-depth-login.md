---
name: feature-depth-login
description: 账号登录与凭据续期实现深读：登录开关由远端配置决定、resolve_id_token 与 ModelAuthRequired、get_models 门控与 memo 新鲜度、begin_callback 重放、同账号续期锁取舍、全链路测试、claim 二次认领
metadata:
  scope: 只收七条实现深读条目；功能概览归 feature-login，owner 入口归 login-auth-overview
---
# 账号登录与凭据续期：实现深读

## 现状

- [[feature-login]]（功能概览） · [[login-auth-overview]]（owner 入口）
- **登录开关由远端配置决定** login_enabled() 的唯一判据是 get_remote_config() 返回非 None 且 is_effective 为真；配置地址有默认值所以默认开启，把 JIUWENSWARM_CONFIG_URL 显式设为 off（或空串等）或拉不到配置即整体关闭（auth 路由 404）。
- 来源：[jiuwenswarm/common/auth/account_kit.py:L92–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L92-L99),
  - [docs/zh/华为账号登录.md:L15–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L15-L27)
- **resolve_id_token 默认 allow_refresh=True；未登录或续期失败抛 ModelAuthRequired，非阻塞调用方须传 False** resolve_id_token(session_id, allow_refresh=True) 返回调 APIG 用的 credential.id_token（Authorization: Bearer）；会话解析不到抛 ModelAuthRequired(not_logged_in)，ensure_fresh 返回 None 抛(session_expired)；
  - 不能阻塞的调用方须传 allow_refresh=False，续期改后台做。
- 来源：[jiuwenswarm/common/auth/service.py:L342–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L342-L357)
- **get_models 受 get_remote_config 的 is_effective 门控；memo 新鲜度同时看 TTL 与缓存文件 mtime** get_models 先读 get_remote_config(allow_refresh)，config 为 None 或 is_effective=false 时直接返回 []，docstring 言明 models.list、模型缓存与请求级凭据透传等下游同受此门控；
  - 进程内 memo 命中还需缓存文件 mtime 未变，否则经 _read_cache 重读磁盘（注释：Gateway 写缓存、AgentServer 另一进程要读到）。
- 来源：[jiuwenswarm/common/auth/model_catalog.py:L200–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/model_catalog.py#L200-L252)
- **begin_callback：记录仍在且 callback_seen=True 抛 oauth_callback_replayed（不删记录）；无记录（含被 claim 弹出或过期清理）抛 oauth_state_invalid** 锁内查 _items：state 无记录（含 claim 成功后弹出、_prune 过期清理）抛 OAuthError(oauth_state_invalid)；记录存在且 callback_seen=True 抛 OAuthError(oauth_callback_replayed)，此分支不弹出记录，异常直接传给调用方。
- 来源：[jiuwenswarm/common/auth/account_kit.py:L265–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L265-L274),
  - [jiuwenswarm/common/auth/account_kit.py:L291–L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L291-L308)
- **按 user_id 进程内锁合并同账号并发续期：省重复刷新但同账号需排队（推断）** 设计推断（非作者历史意图）：
- try_refresh 按 user_id 取进程内 threading.Lock，同账号并发续期合并成一次；推断收益：省重复刷新请求，且华为不轮换 refresh_token、并发刷新不互废；推断代价：同账号调用排队等一次同步续期，合并仅限本进程，跨进程靠持锁后重读会话（按 mtime）发现。
- 来源：[jiuwenswarm/common/auth/service.py:L252–L267](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L252-L267),
  - [docs/zh/华为账号登录.md:L191–L192](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L191-L192)
- **TestClient 上的 authorize→callback→claim 全链路测试，逐条断言三态与落地页安全头** client fixture 对注册了 auth 路由的 FastAPI 实例构造 TestClient（默认带 X-Jiuwen-Auth 头）；test_full_login_flow 依次断言回调前 claim 为 202、落地页 200 且 Set-Cookie 含 jiuwenswarm_auth、cache-control 为 no-store、认领 200 并以 X-Auth-Session 返回会话 id、再次 claim 为 400。
  - 此处描述测试代码及其断言本身。
- 来源：[tests/unit_tests/gateway/test_web_http_auth_routes.py:L81–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_web_http_auth_routes.py#L81-L124),
  - [tests/unit_tests/gateway/test_web_http_auth_routes.py:L140–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_web_http_auth_routes.py#L140-L152),
  - [tests/unit_tests/gateway/test_web_http_auth_routes.py:L166–L184](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_web_http_auth_routes.py#L166-L184)
- **claim：首次 pending.claim 无结果且 callback_url 非空、helper 返回 True 时才二次认领** 仅当首次 pending.claim 无结果、callback_url 非空且 _claim_from_exchange_once 返回 True，claim 才再次认领；仍无结果返回 None，_store.get 查不到抛 OAuthError("登录会话已失效，请重新登录", "session_expired")。
  - helper 对 claim_from_exchange 抛异常或无结果均返回 False，有结果交 complete_callback（其异常仅捕 OAuthError）后返回 True。
- 来源：[jiuwenswarm/common/auth/service.py:L161–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L161-L180),
  - [jiuwenswarm/common/auth/service.py:L97–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L97-L112)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/feature-depth-login.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/account_kit.py:L92-L99；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/华为账号登录.md:L15-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/model_catalog.py:L200-L252；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_web_http_auth_routes.py:L81-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_web_http_auth_routes.py:L140-L152；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_web_http_auth_routes.py:L166-L184
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L342-L357；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/account_kit.py:L265-L274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/account_kit.py:L291-L308；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L252-L267
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/华为账号登录.md:L191-L192；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L161-L180
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py:L97-L112
- 源页字段（feature）：login
- 入口（entry_points）：jiuwenswarm/common/auth/service.py
- 源页字段（source_globs）：jiuwenswarm/common/auth/service.py；jiuwenswarm/common/auth/*.py
