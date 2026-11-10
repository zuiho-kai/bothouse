---
name: sdk-clients-knowledge
description: jiuwenswarm Python SDK Client（client.py）：每次调用拉起 jiuwenswarm-process 子进程的数据流、构造参数默认值（shutdown_grace_seconds=30、max_record_bytes）、两级清理与取舍、pytest 测试入口、run/query 错误契约与 stdin 三类记录
metadata:
  scope: 只收 Python SDK Client 的职责、构造、清理、测试入口与公开入口契约；Python 与 TypeScript 两语言的概览归 feature-sdk，实现深读归 feature-depth-sdk
---
# jiuwenswarm Python SDK Client (sdks/python/src/jiuwenswarm_sdk/client.py)

## 现状

- **职责与数据/控制流**
- Client 是无 Runtime 依赖的异步薄进程宿主：每次 run/query 拉起一个子进程（默认 `jiuwenswarm-process`），encode 后的请求经 stdin 写入，stdout 逐行读取并由 protocol 的 Records.accept 校验收敛，stderr 由独立任务 drain 并只保留尾部 64 KiB。控制流在 _execute 中：写入载荷 →（query 时关闭 stdin）→ consume 处理事件与交互 → 等待进程退出与 stderr 收尾，Records.finish(exit_code) 把终端记录与 OS 退出状态对账。
- Sources / 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L1–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L1-L36),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L101–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L101-L177),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L227–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L227-L233)
- **构造参数与默认值**
- 构造参数：`command`（默认 `("jiuwenswarm-process",)`，必须是非空 argv 字符串序列，拒绝 shell 字符串）、`cwd`、`env`（非 None 时与 os.environ 合并覆盖）、`shutdown_grace_seconds=30`（须正有限）、`max_record_bytes=8*1024*1024`（须正整数）。max_record_bytes 同时作为 create_subprocess_exec 的 StreamReader limit，超限输出记录触发 ProtocolError。
  - 调用级 `deadline_seconds` 须正有限，用 asyncio.timeout 包住 I/O 与退出等待。
- Sources / 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L38–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L38-L61),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L111–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L111-L141),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L240–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L240-L249)
- **清理策略与交互取舍**
- Inference / 设计推断（非作者历史意图）：
- 清理是两级的：run 路径先发协议 cancel，query 路径发 SIGTERM（Windows 用 CTRL_BREAK_EVENT），在 shutdown_grace_seconds 内未退出才强制回收——POSIX 用 killpg SIGKILL 杀整个进程组、Windows 用 taskkill /T /F，均只针对本次调用拥有的子树；代码注释明确强制终止是失败兜底而非正常路径。
  - 交互设计上 SDK 不猜测权限/Plan 决策，保留 Runtime 的 answers 结构，无宿主回调即抛 InteractionRequired 而非自动批准（文档明确 ASK 是宿主决定、DENY 不放宽）。这些是接口与文档声明的选择；作者历史意图无进一步文档证据，属推断。
- Sources / 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L299–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L299-L356),
  - [sdks/README.md:L52–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/README.md#L52-L59)
- **测试入口与覆盖**
- 文档给出的入口是 `python -m pytest -o addopts='' sdks/python/tests tests/unit_tests/process_cli/test_query.py`（另有 sdks/typescript 的 npm test）。共享的真实子进程 fixture 覆盖 UTF-8 分帧、大 stderr、framing、交互、取消、回调、deadline 与进程退出，但不是真实模型的 E2E——文档要求另行在隔离环境中验证 SDK → CLI → 共享 Runtime 链路。
- Sources / 来源：[sdks/README.md:L137–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/README.md#L137-L148)
- **Client 的公开入口与错误契约**
- `Client.run(request, *, on_event, on_interaction, cancel, deadline_seconds)` 接收一个 Mapping 并以 query=False 走 `_execute`；
  - `Client.query(operation, params, *, workspace, timeout_seconds, deadline_seconds)` 组装 operation/params（可选 workspace、timeout_seconds）后以 query=True 执行，返回 `query_result` 而非活 Session。`_execute` 对非正或非有限的 `deadline_seconds` 抛 ValueError，补默认 `schema_version`/`type`/`request_id` 后 encode 写入子进程 stdin；
  - query 用 `--query-json -` 参数、run 用 `--run-jsonl`，启动时的 OSError 包装为 `TransportError`，无自动重试。交互回调返回的 answers 会在未取消时回写 stdin（构造 `type: "answer"` 信封），但存在两个例外：回调期间已触发取消则跳过回写，stdin 已关闭时 write 直接返回。
- Sources / 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L63–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L63-L99),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L111–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L111-L122),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L140–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L140-L141),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L254–L261](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L254-L261)
- **stdin/stdout 承载的三类记录与失败保护**
- 子进程 stdin 承载三种写出：初始 run/query 载荷（query 写入后即关闭 stdin）、取消时的 `type: "cancel"` 记录（由 `cancel` asyncio.Event 触发或清理阶段发送）、以及交互回调产生的 `type: "answer"` 信封；文档确认答复与取消都不会另起命令。stdout 逐行读取经 `Records.accept` 校验：超限记录抛 `ProtocolError`，流结束仍无终端结果也抛 `ProtocolError`；
  - 收到 `interaction.requested` 事件且未取消时若无 `on_interaction` 回调则抛 `InteractionRequired`（不自动批准），stderr 由独立任务 drain 并只保留尾部 64 KiB。
- Sources / 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L154–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L154-L158),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L208–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L208-L220),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L238–L280](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L238-L280),
  - [sdks/README.md:L79–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/README.md#L79-L83)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sdk-clients/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L1-L36；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L101-L177
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L227-L233；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L38-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L111-L141；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L240-L249
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L299-L356；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/README.md:L52-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/README.md:L137-L148；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L63-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L111-L122；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L140-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L254-L261；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L154-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L208-L220；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L238-L280
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/README.md:L79-L83
