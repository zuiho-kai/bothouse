---
name: jiuwenswarm-common-auth
description: 华为账号登录与免费模型凭据（common/auth）：OAuth2 授权码 + PKCE 登录与待完成登录表、续期并发合并、AES-256-GCM 加密会话存档与跨进程共享，及关键文件与单测入口
metadata:
  scope: 只收 common/auth 的登录流程、续期与会话存档；凭据消毒、句柄登记表与登录模型目录缓存归 jiuwenswarm-login-models
---
# 华为账号登录与免费模型凭据（common/auth）

## 现状

- 负责华为账号 Account Kit 登录（OAuth2 授权码 + PKCE）、登录会话的加密落盘与 token 续期，并在登录后通过 APIG 通道发现免费模型、查询积分。Gateway 转发请求时附上用户的 id_token。AgentServer 的模型配置里只存 `jiuwen-login:<ref>` 占位句柄，请求发出前才换成真 token。
- **从这里读起**
- `jiuwenswarm/common/auth/service.py` — AuthService 是各 channel 共用的唯一登录入口，负责发起授权、回调、认领、登出、状态查询和续期；模型层通过 live_session / resolve_id_token 取凭据
- `jiuwenswarm/common/auth/passthrough.py` — Gateway 侧：normalize_model_auth 先删掉客户端传来的凭据键，再由服务端决定是否挂上该用户的 id_token
- `jiuwenswarm/common/auth/login_credentials.py` — AgentServer 侧：按句柄登记 token，并用 SDK httpx 钩子（inject_login_credential / apply_login_credential_patch）在请求发出前换成真 token
- `jiuwenswarm/common/auth/remote_config.py` — 官网下发的远端配置（get_config / warm_up_in_background），决定登录和免费模型功能是否开启
- **关键文件**
- `jiuwenswarm/common/auth/account_kit.py` — OAuth 流程本身：PKCE 生成、待完成登录表 PendingLogins、换码、认领、refresh_token 续期
- `jiuwenswarm/common/auth/session_store.py` — 登录会话存在内存里，并用 AES-256-GCM 加密落盘（密钥在 ~/.jiuwenswarm/auth/.install_key）；Gateway 与 AgentServer 靠它共享登录态
- `jiuwenswarm/common/auth/model_catalog.py` — 用 id_token 发现账号可用的模型并缓存，转成 models.defaults 条目；这些模型永远不写进 config.yaml（is_login_model 负责拦截）
- `jiuwenswarm/common/auth/apig.py` — APIG 客户端：模型列表、积分查询（ModelQuota）、推理接入点，积分用完时抛 QuotaExhausted
- `jiuwenswarm/common/auth/session_owners.py` — 记录对话会话由哪个账号选了免费模型，让飞书等 IM 通道中没有登录会话的请求也能找回凭据
- `jiuwenswarm/common/auth/net.py` — 登录链路的出网请求封装，以及 SSL 校验开关

### 登录流程与待完成登录表

- 入口是进程级单例 `AuthService`（`get_auth_service`）。`create_authorization_request` 返回 `{authorizeUrl, state, claimToken, expiresIn}`：PKCE verifier 为 32 字节随机数的 base64url、challenge 用 S256，授权请求包含 access_type=offline，用于申请 refresh_token；是否实际返回由服务端响应决定；
  - `expiresIn` 就是 state 有效期 10 分钟（STATE_TTL_S）（[service.py L69-L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L69-L79)、
  - [account_kit.py L337-L364](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L337-L364)）。
- `PendingLogins` 是进程内存表（回调和认领必须落同一个进程）：state 为 `token_urlsafe(24)`、claim_token 为 `token_urlsafe(32)`。`begin_callback` 置 `callback_seen=True` 并拒绝同一 state 的第二次回调（授权码一次性，`oauth_callback_replayed`）；`finish` 把条目有效期改判为 5 分钟（CLAIM_TTL_S）等发起方来取；
  - claim 在 state 不存在或 claim_token 常量时间比对不符时抛 oauth_state_invalid；discard 对这两种情况静默不操作，只有匹配时才删除（[account_kit.py L225-L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L225-L308)）。
  - 测试 `test_state_and_claim_token_are_unguessable`、`test_claim_window_restarts_when_callback_lands`、`test_pending_login_expires`。
- 回调落 ECS 鉴权服务时（配置 `callback_url`）：state 末尾拼 `claim_fingerprint(claim_token)`（加盐 SHA-256 取前 32 hex；取哈希是因为 state 会进地址栏、浏览器历史和华为日志），本地构造的指纹须与 ECS 的认领校验约定一致；本页不据此证明远端多实例部署的行为。Gateway 起后台线程按 2s 轮询认领、发起 2 分钟后放慢到 10s、state 过期即放弃；HTTP 202/429/5xx 和网络异常都只是「还没结果」，不当判死，`access_denied` 等错误才是终态；
  - 发起方 `claim` 没等到结果时会当场主动去取一次（[account_kit.py L38-L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L38-L49)、
  - [L311-L319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L311-L319)、
  - [L380-L426](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L380-L426)；
  - [service.py L81-L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L81-L112)、
  - [L161-L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L161-L173)）。
- `complete_callback` 的失败也会登记进 pending，发起方不必干等到过期：`access_denied`→`oauth_access_denied`、其他回调错误→`oauth_callback_failed`、缺授权码→`oauth_callback_missing_params`、store.create 抛异常→session_store_failed；当前 _flush 自身的落盘异常只告警并保留内存登录态。
  - 换码结果从 id_token 取 `openid`/`sub` 作 user_id、`exp` 作过期时刻（缺失回退 1 小时），响应没带 refresh_token 时沿用旧值（[service.py L114-L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L114-L159)、
  - [account_kit.py L196-L217](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/account_kit.py#L196-L217)）。测试 `test_session_store_failure_is_reported_to_the_waiting_client`。
- 登录成功不等模型目录：会话建好后另起 `auth-catalog-refresh` 后台线程去拉 APIG（不通时最长 10 秒），认领立即返回；认领成功后重拉列表时目录还没好，`models.list` 会自己再发现一次（[service.py L150-L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L150-L158)）。
  - 测试 `test_login_result_is_released_without_waiting_for_model_discovery`。

### 凭据续期与并发合并

- 有效期取 token 的 exp，缺失时默认 1 小时；`REFRESH_AHEAD_S=5 分钟`内到期就续。`try_refresh` 按 user_id 加锁，拿到锁后**重读一次会话**做双重检查——重读按存档 mtime 同步磁盘，能发现另一个进程（AgentServer）刚刷好的结果。结果四分：会话已注销→`None`；续期失败且已过期→`None`（须重新登录）；续期失败但旧 token 没过期→照常返回旧会话；
  - `update_credential` 返回 `None`（续期期间被登出）→新凭据丢弃、按失败处理（[service.py L39-L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L39-L41)、
  - [L260-L288](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L260-L288)）。
  - 测试 `test_concurrent_refresh_happens_only_once`、`test_refresh_result_discarded_when_session_logged_out`、`test_failed_refresh_of_expired_token_reports_none`、`test_failed_early_refresh_keeps_the_still_valid_token`。
- 转发热路径用 `ensure_fresh(blocking=False)`：续期丢后台线程（按 user_id 去重，不逐请求起线程），未过期就先带旧 token 发这一次。`live_session`/`resolve_id_token` 取不到凭据抛 `ModelAuthRequired`，reason 只有两种：`not_logged_in` / `session_expired`；
  - **没有会话 id 就是没登录**，绝不回落「本机唯一登录会话」（[service.py L234-L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L234-L250)、
  - [L290-L305](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L290-L305)、
  - [L335-L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L335-L357)）。
  - 测试 `test_non_blocking_caller_uses_old_token_and_refreshes_in_background`、`test_background_refresh_is_not_spawned_per_request`、`test_no_session_id_never_borrows_the_machines_login`。
- 已过期的凭据是例外：`expired_login_session` 只查内存/本地缓存判断「这次请求用登录模型且该会话凭据已过期」，它向调用方返回需续期的会话；转发前的线程续期接线需沿 Gateway 调用方核对，续期失败仍可能需要重新登录（[passthrough.py L139-L156](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/passthrough.py#L139-L156)）。
  - 测试 `test_first_message_after_idle_gets_a_refreshed_token`。
- `logout` 不带 session id 什么都不做——丢了 cookie 的浏览器点退出，不能清掉这台机器其他浏览器正在用的登录；登出同时清模型目录缓存，避免下一个用户看到上一个用户的模型（[service.py L185-L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L185-L197)）。
  - 测试 `test_logout_without_session_id_touches_nobody`。

### 加密会话存档与跨进程共享

- 存档 `auth/sessions.json` 形如 `{"v":2,"payload":<信封>}`；信封为 `{version:1, alg:"A256GCM", kid, iv, tag, data}`（tag 与密文分开存是为了和 relay-claw 的 encryptJson 互读，版本位用于区分「格式不对」和「密钥不对」）。主密钥 auth/.install_key 保存 base64url 编码的 32 字节；
  - 创建时尝试 chmod 0600，平台不支持时仅记 debug 日志（[session_store.py L34-L42](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L34-L42)、
  - [L141-L191](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L141-L191)）。
- 密钥生命周期：新建走「不覆盖」原子发布（POSIX 用 `os.link`、Windows 用 `rename`），两个进程首次启动撞上时用先落盘那把；读不了直接抛出——杀毒/备份工具短暂占用时重建会覆盖好密钥，之前保存的会话从此解不开；只有内容确实损坏才改名 `.corrupt-<ts>` 留档再重建、旧会话随之作废。
  - `derive_local_secret(label)=sha256(label+主密钥)` 派生专用 HMAC 密钥，不把加密密钥本身交出去（[session_store.py L83-L138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L83-L138)）。
  - 测试 `test_key_created_by_another_process_first_wins`、`test_unreadable_key_file_is_never_overwritten`、`test_corrupt_key_file_is_kept_aside_and_regenerated`。
- 存档读不出（v≠2）、解不开或损坏 → 一律按未登录处理，不做迁移，重新登录即可；会话 TTL 30 天按 `created_at` 起算（比 1 小时的 id_token 长，给续期留时间）；同一账号重复登录直接顶掉旧会话，不残留多份凭据（[session_store.py L276-L298](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L276-L298)、
  - [L343-L389](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L343-L389)）。测试 `test_unknown_archive_version_is_treated_as_logged_out`、`test_relogin_replaces_old_session`。
- 跨进程存档同步（Gateway 写、AgentServer 读）：读按存档 mtime 判断要不要重载，文件没变不重复加载；所有写路径（create / update_credential / remove / clear）写前强制重读一次——文件系统时间戳粒度不足时，减少陈旧内存快照覆盖其它进程更新的情况；这不是跨进程写事务锁，也不保证所有并发写无丢失（「注销后又复活」）；`_flush` 把整份内存快照加密写 tmp 后原子替换，并记下自己写出的 mtime（自己的写不触发重载）；
  - 落盘失败仅内存生效并告警（[session_store.py L300-L321](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L300-L321)、
  - [L343-L407](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/session_store.py#L343-L407)）。测试 `test_reloads_when_another_process_writes`、`test_logout_preserves_other_process_update_when_archive_mtime_is_unchanged`。

### 登录模型目录与跨进程凭据句柄

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-login-models]]（登录模型目录与跨进程凭据句柄）。

### 怎样验证

- 聚焦单测都在 `tests/unit_tests/common/` 下：`test_auth_account_kit.py`（OAuth 配置/PKCE/换码/续期原语）、`test_auth_service_callback.py`（回调登记与目录后台拉取）、`test_auth_refresh_coalescing.py`（续期合并与失败区分）、`test_auth_session_store.py` 与 `test_auth_session_crypto.py`（落档与密钥）、`test_auth_passthrough.py`（消毒/注入/闲置首条消息）、
  - `test_auth_login_credentials.py` 与 `test_auth_login_credential_refresh.py`（登记表/钩子/推送续期）、`test_auth_model_catalog.py`（目录缓存）。以上均为单元级验证，真实华为 OAuth/ECS/APIG 链路不在其中。
- **相关文档**
- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（jiuwenswarm/common 公共基础模块） — config.yaml 的读写边界；`models.login_model_settings` 和 user workspace 路径落在它管的配置与工作区里
- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（AgentServer 运行时会话） — 请求级登录模型条目装配进 runtime 后的会话/执行行为
- [[jiuwenswarm-channels-cli]]（Gateway 通道） — 登录状态在通道侧的呈现与转发入口
- **改动路由**
- `jiuwenswarm/common/auth/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/jiuwenswarm-common-auth.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/account_kit.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/session_store.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/passthrough.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/login_credentials.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/model_catalog.py
