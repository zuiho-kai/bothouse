---
name: feature-depth-sandbox-privacy-proxy
description: JiuwenBox 推理隐私代理实现深读：listen_port=0 禁用与 skip_cert_verify、头部注入校验复用、start_proxy/stop_proxy 失败传播、无凭据路由透传与 use_tls、通配覆写凭据头取舍、start_proxy 单测断言
metadata:
  scope: 只收代理的逐点实现深读；功能入口级知识归 feature-sandbox-privacy-proxy，隔离执行的实现深读归 feature-depth-sandbox
---
# JiuwenBox 推理隐私代理：实现深读

## 现状

- [[feature-sandbox-privacy-proxy]]（功能概览） · [[sandbox-runtime-overview]]（owner 入口）
- **listen_port=0 默认禁用与 skip_cert_verify 默认关闭** start_proxy 在 config.listen_port == 0 时拒绝启动：只记 warning（"Cannot start proxy: listen_port=0 (disabled). ... Set listen_port > 0 in policy YAML to enable."）并返回当前状态字典，不抛异常也不改状态。ProxyRoute 的 skip_cert_verify 默认 False；
  - 仅当为 True 时 _get_ssl_context 才设置 check_hostname=False、verify_mode=ssl.CERT_NONE。
- 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L343–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L343-L356),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L35–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L35-L40),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L157–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L157-L165)
- **复用 policy 模块的头部注入校验** manager 从 jiuwenbox.models.policy 导入 _contains_control_chars 与 _contains_crlf_or_null，在 _resolve_basic_credentials 中对用户名和解析出的密码做 CR/LF/NUL/控制字符检查，防止凭据值注入 HTTP 头部；校验放在 manager 层而非 Pydantic 模型，使 ValueError 消息为通用文本、不泄露密钥。
- 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L21–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L21-L22),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L37–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L37-L53),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L100–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L100-L104)
- **启动失败的错误传播与最后一路由停用** start_proxy 中 proxy.start() 或 enable_route 抛异常时，路由状态被置为 ProxyState.ERROR、error_message 记录 str(e) 并写入日志后重新 raise，向 REST 调用方传播。stop_proxy 在禁用最后一条路由（get_enabled_route_count()==0）时停止全局代理监听并将实例置 None、状态回到 STOPPED；停用过程抛异常同样置 ERROR 并 raise。
- 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L370–L389](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L370-L389),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L425–L448](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L425-L448)
- **无 basic_username 且无 api_key 的路由经 _inject_api_key 原样透传，仅当 route.use_tls 才走 TLS 转发** _handle_connection 先 client_reader.read(65536) 读入请求；354 行把整理好的 new_headers_raw 交给 _inject_api_key——route.basic_username 未设（230–231 行不触发 Basic 改写）且 route.api_key 为空时按 233–234 行原样返回字节；
  - 重组后的请求仅当 route.use_tls 才构造 ssl_ctx，随后写入并 drain 到 route.target_host:route.target_port（358–368 行）。
- 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L284–L294](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L284-L294),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L219–L246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L219-L246),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L354–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L354-L372)
- **start_proxy(name) 契约：缺失抛 not found，listen_port=0 仅告警返回** start_proxy(name) 持锁查 _proxies["default"] 与同名路由，任一缺失抛 ValueError("Proxy '<name>' not found")；listen_port==0 时不抛错，记 warning "Set listen_port > 0 in policy YAML to enable." 后返回 {name,state,started_at,error_message}，启用由调用方在 policy YAML 设端口。
- 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L327–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L327-L356),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L367–L396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L367-L396)
- **通配覆写仅替换已存在的凭据头：可纠正占位密钥但不为缺失头新增凭据（推断）** 设计推断（非作者历史意图）：
- 推断：L238-L250 以 `re.sub` 把已存在的 `Authorization: Bearer …` 与 `X-Api-Key: …` 整体替换为路由配置的 `route.api_key`，客户端带任意占位值都会被纠正为策略密钥；代价是请求本不带这两类头时不会新增凭据（无匹配则 `result` 原样、`injected` 为 False，仅少一条注入日志）。
- 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L219–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L219-L255)
- **test_start_proxy 断言 start_proxy 返回 running；
  - 缺失名断言抛 ValueError "not found"** `TestProxyManagerLifecycle.test_start_proxy`（L484-L497）在运行时断言 `manager.start_proxy("test")` 返回 `state=="running"`、`get_proxy("test")` 亦为 running，随后调用 `validate_proxy_http(proxy_listen_port, "/test/v1/chat", expect_forward=True)` 辅助（其内部断言未在所示片段给出）；
  - `test_start_nonexistent_proxy_raises`（L500-L502）断言 `start_proxy("nonexistent")` 抛 `ValueError` 且 match="not found"。
- 来源：[jiuwenbox/tests/integration/test_inference_privacy_proxy.py:L484–L497](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/tests/integration/test_inference_privacy_proxy.py#L484-L497),
  - [jiuwenbox/tests/integration/test_inference_privacy_proxy.py:L500–L502](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/tests/integration/test_inference_privacy_proxy.py#L500-L502)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/feature-depth-sandbox-privacy-proxy.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L343-L356；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L35-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L157-L165；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L21-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L37-L53；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L100-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L370-L389
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L425-L448
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L327-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L367-L396；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L219-L255
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/tests/integration/test_inference_privacy_proxy.py:L484-L497；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/tests/integration/test_inference_privacy_proxy.py:L500-L502
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L284-L294；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L219-L246
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L354-L372
- 源页字段（feature）：sandbox-privacy-proxy
- 入口（entry_points）：jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py；jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py
- 源页字段（source_globs）：jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py；jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py
