---
name: feature-depth-sdk
description: SDK 实现深读：Client 构造参数真实默认值与校验、shutdown_grace_seconds 超时后的 force_stop 强制回收（taskkill / killpg）、run→_execute 单次拉起子进程、每次新起进程的取舍、test_no_automatic_approval（未执行）
metadata:
  scope: 只收 Python SDK Client 与进程清理的实现级事实；职责、接口与配置概览归 feature-sdk，Client 知识页归 sdk-clients-knowledge
---
# Python 与 TypeScript SDK：实现深读

## 现状

- [[feature-sdk]]（功能概览） · [[sdk-clients-overview]]（owner 入口）
- **Client 构造参数的真实默认值与校验** Client.__init__ 默认 command=("jiuwenswarm-process",)、shutdown_grace_seconds=30、max_record_bytes=8 MiB；command 必须是非空 argv 序列（传入 shell 字符串或空序列抛 ValueError），env 非空时与 os.environ 合并覆盖。max_record_bytes 同时作为 create_subprocess_exec 的 limit，超限的输出记录触发 ProtocolError。
- 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L38–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L38-L61),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L240–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L240-L249)
- **优雅关闭超时后的强制回收** 若子进程在 shutdown_grace_seconds（默认 30 秒）内未完成清理，_Invocation.close 捕获 TimeoutError 后调用 force_stop：Windows 用 taskkill /PID <pid> /T /F 杀掉整棵进程树，POSIX 用 killpg 向进程组发 SIGKILL，最后再对进程本身 kill 兜底。
- 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L299–L325](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L299-L325),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L327–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L327-L356)
- **Client.run→_execute：校验 deadline/request_id 后单次拉起 CLI 子进程** run 复制 request 调 _execute(query=False)：deadline_seconds 非正或非有限抛 ValueError；补默认 schema_version/type/request_id 并要求非空字符串后 encode，经 create_subprocess_exec（stdin/stdout/stderr 三管道、limit=self.max_record_bytes）拉起 self.command 子进程；
  - 所示段内启动 OSError 包装为 TransportError，无重试。
- 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L63–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L63-L99),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L101–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L101-L141)
- **Client.run：单个 request Mapping 加仅关键字选项，deadline_seconds 必须为正有限值** run 复制请求 Mapping（dict(request)）并以 query=False 转发仅关键字的 on_event/on_interaction/cancel/deadline_seconds；_execute 对非正或非有限的 deadline_seconds 抛 ValueError，再 setdefault schema_version、type 与 request_id。
- 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L63–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L63-L80),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L111–L120](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L111-L120)
- **_Invocation 持有 Records 与所属 Client，清理时读取 client.shutdown_grace_seconds 作超时** _Invocation.__init__ 接收并保存 protocol 的 Records 与所属 Client；所示清理路径用 asyncio.timeout(self.client.shutdown_grace_seconds) 包住 drain_and_wait，TimeoutError 时 await force_stop。
- 来源：[sdks/python/src/jiuwenswarm_sdk/client.py:L181–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L181-L194),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L316–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L316-L320)
- **每次调用新起进程的隔离收益与启动及慢宿主代价（推断）** 设计推断（非作者历史意图）：
- 每次调用新起进程（两次 query 断言 pid 不同）：收益是调用间状态隔离、无常驻 stdio 服务（推断）；代价是每次调用的进程启动开销，且慢宿主在 TS 端按 256 条待投递上限 fail closed、Python 靠管道背压（推断：以失败换取宿主保护）。
- 来源：[sdks/python/tests/test_client.py:L36–L42](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/tests/test_client.py#L36-L42),
  - [sdks/python/src/jiuwenswarm_sdk/client.py:L128–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/src/jiuwenswarm_sdk/client.py#L128-L139),
  - [sdks/README.md:L121–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/README.md#L121-L123)
- **test_no_automatic_approval 断言无 on_interaction 的 run 抛 InteractionRequired** 该 @pytest.mark.asyncio 测试用 client("ask")（真实 fixture 子进程，SDK_FIXTURE=ask）调用 run 且不传 on_interaction，以 pytest.raises 断言 InteractionRequired；此处为静态描述，未在本次执行。
- 来源：[sdks/python/tests/test_client.py:L110–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/tests/test_client.py#L110-L113),
  - [sdks/python/tests/test_client.py:L19–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/sdks/python/tests/test_client.py#L19-L25)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sdk-clients/feature-depth-sdk.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L38-L61；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L240-L249
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L299-L325；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L327-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/tests/test_client.py:L36-L42；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L128-L139
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/README.md:L121-L123；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L63-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L101-L141；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L63-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L111-L120；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L181-L194
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/src/jiuwenswarm_sdk/client.py:L316-L320；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/tests/test_client.py:L110-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:sdks/python/tests/test_client.py:L19-L25
- 源页字段（feature）：sdk
- 入口（entry_points）：sdks/python/src/jiuwenswarm_sdk/client.py
- 源页字段（source_globs）：sdks/python/src/jiuwenswarm_sdk/client.py；sdks/*
