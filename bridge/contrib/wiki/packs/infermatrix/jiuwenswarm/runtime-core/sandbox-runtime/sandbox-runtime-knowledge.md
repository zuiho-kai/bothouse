---
name: sandbox-runtime-knowledge
description: sandbox-runtime 综合知识：box-server FastAPI lifespan 的启停顺序与 proxy-only 分流、JIUWENBOX_IO_THREADS / JIUWENBOX_UDS_MODE 环境变量、代理 update 后路由不恢复启用与 64KiB 头部限制的推断、最长前缀路由、测试观测接口、/api/v1/proxies 路由生命周期
metadata:
  scope: 只收 JiuwenBox 服务与推理隐私代理的架构、配置、取舍、功能、验证与 API 六类知识；Windows 软删除审查规则归 sandbox-runtime-rules，功能知识与实现深读归 feature-sandbox 与 feature-sandbox-privacy-proxy 及各自的 feature-depth 页
---
# sandbox-runtime（JiuwenBox 服务与推理隐私代理）

## 现状

- **FastAPI lifespan 编排沙箱与代理两个子系统**
- box-server 的 lifespan 在启动时先抬高 RLIMIT_NOFILE 并为 asyncio 默认执行器配置线程池，再按 PolicyReader.is_proxy_only() 分流：proxy-only 模式跳过沙箱侧全部组件（无 ProcessRuntime、subreaper、僵尸/idle reaper），否则先 enable_child_subreaper、构建全局 SandboxManager 并注册 SIGCHLD 僵尸回收与 idle reaper，随后创建并启动 ProxyManager、给 UDS socket 打权限位、
  - 启动 MCP session manager。关停按固定顺序：MCP session → proxy → idle reaper → shutdown_all_sandboxes → clear_persistent_state（清空 state_dir/policies_dir）→ 注销僵尸回收器，各步均为 best-effort 只记日志。模块级单例 _sandbox_manager/_proxy_manager/_proxy_only_mode 由 lifespan 维护，get_sandbox_manager 在 proxy-only 模式下懒加载时直接抛 503。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/server/app.py:L260–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L260-L330),
  - [jiuwenbox/src/jiuwenbox/server/app.py:L332–L402](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L332-L402),
  - [jiuwenbox/src/jiuwenbox/server/app.py:L207–L224](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L207-L224)
- **IO 线程数与 UDS 权限的环境变量**
- JIUWENBOX_IO_THREADS 控制 asyncio 默认 ThreadPoolExecutor 线程数：非整数或 <1 的值被忽略并回退到默认 max(64, cpu_count*16)。JIUWENBOX_UDS_PATH（由 launcher 写入）存在时，启动阶段按 JIUWENBOX_UDS_MODE（八进制，默认 "0666"）对 socket 文件做一次 chmod；mode 非法或 chmod 失败仅告警不阻塞启动。策略侧 load_from_policy 要求 listen_port > 0 才加载全局代理，listen_host 缺省回退 127.0.0.1。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/server/app.py:L83–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L83-L114),
  - [jiuwenbox/src/jiuwenbox/server/app.py:L227–L257](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L227-L257),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L581–L633](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L581-L633)
- **update 重启不恢复路由启用；首读 64KiB 的头部限制**
- Inference / 设计推断（非作者历史意图）：
- update_proxy 更新某路由时若代理在运行，会先 stop 再重建 InferencePrivacyProxy；新代理的 _enabled_routes 初始为空集合，且 _match_route 只匹配已启用的前缀，重启代码也未重新调用 enable_route——因此更新后即使重启成功，所有路由（含未更新的）都不再转发请求，需要逐条重新启用。另一取舍：_handle_connection 只在首次 read(65536) 的缓冲里找 \r\n\r\n 头部结束符，找不到即回 400；
  - 但超出的请求体由 forward_remaining_request 循环读取转发，不受 64KiB 限制（推断：分片到达导致头部不完整的请求会被误判为 400）。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L119–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L119-L123),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L189–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L189-L196),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L501–L510](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L501-L510),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L294–L306](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L294-L306)
- **最长前缀路由与 proxy-only 部署模式**
- 路由匹配按字符串前缀进行：'/api' 仍会字符串匹配 '/api-v2/chat'，_match_route 在所有已启用且前缀命中的路由中选前缀最长者——只有当更长、更具体的路由（如 '/api-v2'）存在且已启用时才胜出；若它未启用，请求会落到较短的 '/api' 路由上。
  - 服务器侧 lifespan 还支持 proxy-only 模式：policy 只配置 inference_privacy_proxies 时跳过构建 SandboxManager（不起 ProcessRuntime、subreaper 等），get_sandbox_manager 对沙箱 API 返回干净的 503，代理子系统照常启动。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L167–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L167-L196),
  - [jiuwenbox/src/jiuwenbox/server/app.py:L275–L295](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L275-L295),
  - [jiuwenbox/src/jiuwenbox/server/app.py:L207–L224](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L207-L224)
- **面向测试的可观测性接口**
- 代码内建有测试/管理观测接口：InferencePrivacyProxy 通过 server 属性暴露 asyncio 监听器，注释明确 "for tests and management code"；manager 提供 reset()（"Intended for isolated tests"，清空 _proxies，不加锁）与 get_global_instance()（返回 "default" 实例供测试检查）。每个 ProxyInstance 维护带 UTC 时间戳的内存日志环形缓冲，上限 1000 行，get_proxy_logs(name, lines) 返回尾部若干行。
  - 所示片段中未包含对上述行为的自动化测试本体。
- Sources / 来源：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L130–L133](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L130-L133),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L204–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L204-L210),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L164–L183](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L164-L183),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L557–L579](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L557-L579)
- **REST 代理路由生命周期：POST /api/v1/proxies 创建后经 /start 启动**
- 集成测试演示了 REST 层的路由生命周期入口：先 POST /api/v1/proxies 提交 {"path_prefix": ..., "target_endpoint": ...} 创建路由，再 POST /api/v1/proxies/{name}/start，断言返回 200 且响应 JSON 的 state 为 "running"，随后经代理端口验证请求被真实转发。
  - 底层 manager 的 create_proxy(name, config) 在全局代理 listen_port==0 时抛 ValueError("...listen_port=0 (disabled)...")，仅当非零端口才创建路由并返回 {name, state: "stopped", created_at}。
- Sources / 来源：[jiuwenbox/tests/integration/test_inference_privacy_proxy.py:L1225–L1241](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/tests/integration/test_inference_privacy_proxy.py#L1225-L1241),
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L277–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L277-L292)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L260-L330；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L332-L402
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L207-L224；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L83-L114
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L227-L257；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L581-L633
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L119-L123；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L189-L196
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L501-L510；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L294-L306
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L167-L196；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L275-L295
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L130-L133；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L204-L210
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L164-L183
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L557-L579；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/tests/integration/test_inference_privacy_proxy.py:L1225-L1241
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L277-L292
