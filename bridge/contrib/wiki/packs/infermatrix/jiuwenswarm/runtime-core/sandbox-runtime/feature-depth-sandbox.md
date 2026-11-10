---
name: feature-depth-sandbox
description: JiuwenBox 隔离执行实现深读：HTTP 错误映射（404/409/400）、JIUWENBOX_SAVE_LOGS_DIR 与健康响应体、ProcessRuntime.exec 信号量与 daemon 执行、stop 超时 SIGTERM、日志 16KiB 上限取舍、创建沙箱集成测试断言
metadata:
  scope: 只收隔离执行的逐点实现深读；功能入口级知识归 feature-sandbox，推理隐私代理的实现深读归 feature-depth-sandbox-privacy-proxy
---
# JiuwenBox 隔离执行：实现深读

## 现状

- [[feature-sandbox]]（功能概览） · [[sandbox-runtime-overview]]（owner 入口）
- **HTTP 错误映射契约** create_app 注册异常处理器把领域异常映射为标准 JSON 错误响应：SandboxNotFoundError→404，SandboxStateError/SandboxConflictError→409，InvalidSandboxIdError/InvalidJobIdError/PolicyValidationError/ValidationError→400，BackgroundJobNotFoundError→404；调用方因此可用状态码区分不存在、状态冲突与请求非法。
  - CLI 侧 _CliClient.sandbox_create 向 /api/v1/sandboxes POST 可选 env/policy/policy_mode/sandbox_id 并返回 dict。
- 来源：[jiuwenbox/src/jiuwenbox/server/app.py:L405–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L405-L528),
  - [jiuwenbox/src/jiuwenbox/cli/jiuwenbox.py:L302–L319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/cli/jiuwenbox.py#L302-L319)
- **JIUWENBOX_SAVE_LOGS_DIR 与健康响应体** JIUWENBOX_SAVE_LOGS_DIR 默认未设置即完全不写日志文件（仅 DEBUG 级审计事件）；设置后 _build_sandbox_manager 用该目录（expanduser + mkdir）构造 AuditLogger(log_dir=..., filename_strategy="timestamped")，文件在沙箱销毁后保留。JIUWENBOX_HEALTH_RESPONSE_BODY 非空时 /health 以 text/plain 200 原样返回该值，空串视为未设置，且按请求读取。
- 来源：[jiuwenbox/src/jiuwenbox/server/app.py:L153–L204](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L153-L204),
  - [jiuwenbox/src/jiuwenbox/server/app.py:L44–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L44-L59)
- **ProcessRuntime.exec：信号量约束内经 _exec_via_daemon 执行** exec(sandbox_id, request) 先记命令摘要日志，经 `_ensure_exec_semaphore()` 取信号量，在 `async with semaphore` 内 `await self._exec_via_daemon(sandbox_id, request)` 并返回其 ExecResult；
  - 文档字符串称命令经每沙箱常驻 daemon 的 Unix socket 单次往返执行，在飞命令数受 JIUWENBOX_EXEC_CONCURRENCY（默认可用 CPU 数）约束。
- 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L3070–L3100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L3070-L3100)
- **create_app 内联导入 sandbox/policy/proxy 三个 router；jiuwenswarm 侧 sandbox.type 当前仅接通 jiuwenbox（文档表述）** create_app() 内联导入 routes.sandbox / routes.policy / routes.proxy 三个 router 模块，server 的 API 面依赖这三处路由代码；jiuwenswarm 配置项 sandbox.type 默认 jiuwenbox，文档称当前只接通该 provider。
- 来源：[jiuwenbox/src/jiuwenbox/server/app.py:L488–L490](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/app.py#L488-L490),
  - [jiuwenbox/README_CN.md:L565–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L565-L576)
- **ProcessRuntime.stop 在守护进程等待超时后向进程组发 SIGTERM；killpg 遇 ProcessLookupError 则清理并返回** 当 proc.wait 超过 DAEMON_SHUTDOWN_TIMEOUT_SECONDS 时，stop 调用 os.killpg(proc.pid, SIGTERM)；若抛出 ProcessLookupError，则弹出 _processes 与 _daemon_socket_ready 表项、移除主机防火墙规则、拆除 cgroup 后 return。
- 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L2280–L2319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L2280-L2319)
- **DAEMON_STARTUP_LOG_MAX_BYTES=16KiB：启动失败 RuntimeError 有界（注释）vs 超出诊断截断（推断）** 设计推断（非作者历史意图）：
- 该 16*1024 上限约束计入 supervisor 早退 RuntimeError 的 spawn 期 stdout/stderr：注释称可容纳 traceback 加少量 bwrap/seccomp/landlock 诊断、对经 HTTP 透出的调用方保持有界；代价是超出 16KiB 的诊断丢失（推断）。
- 来源：[jiuwenbox/src/jiuwenbox/server/runtime/process.py:L281–L286](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/server/runtime/process.py#L281-L286)
- **集成测试断言 POST /api/v1/sandboxes 返回 201 且 phase 为 ready** test_sandbox_process_cannot_inspect_sandbox_daemon_memory 经 client fixture 发起 POST /api/v1/sandboxes，断言 status_code == 201 且 sandbox['phase'] == 'ready'；所示行止于取出 sandbox_id，后续探测断言未在所示范围内。
- 来源：[jiuwenbox/tests/integration/test_server_api_default.py:L716–L728](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/tests/integration/test_server_api_default.py#L716-L728)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/feature-depth-sandbox.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L405-L528；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/cli/jiuwenbox.py:L302-L319
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L153-L204；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L44-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/app.py:L488-L490；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/README_CN.md:L565-L576
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L3070-L3100；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L281-L286
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/server/runtime/process.py:L2280-L2319；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/tests/integration/test_server_api_default.py:L716-L728
- 源页字段（feature）：sandbox
- 入口（entry_points）：jiuwenbox/src/jiuwenbox/server/app.py
- 源页字段（source_globs）：jiuwenbox/src/jiuwenbox/server/app.py；jiuwenbox/src/jiuwenbox/*
