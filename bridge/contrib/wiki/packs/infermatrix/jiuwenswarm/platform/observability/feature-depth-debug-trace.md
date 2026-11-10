---
name: feature-depth-debug-trace
description: Debug Dump 与 OTel 实现深读：子代理边界写入 dump 的调用链、resolve_debug_trace_settings 契约与 debug/dump/otel 判定、_write_raw 统一脱敏、配置尽力读取、dump 文件打开失败的降级与单测断言
metadata:
  scope: 只收 debug-trace 实现层深读条目（流程、API、取舍、配置、依赖、失败模式、验证）；功能概览归 feature-debug-trace
---
# Debug Dump 与 OTel：实现深读

## 现状

- [[feature-debug-trace]]（功能概览） · [[observability-overview]]（owner 入口）
- **子代理开始边界写入 dump 的调用链** 以一次子代理派发为例：输入是 source 标签与 prompt。DebugTraceLogger.begin_subagent 先调用 _flush_run 把此前累积的主 run 文本刷出，再调用 _write_raw 写入 "========== subagent start ==========" 边界行（含 timestamp/source/prompt，prompt 按 generic_payload_max_chars 截断）；
  - _write_raw 在写盘前对 body 做 _sanitize_log_text 脱敏并 flush 文件。整个调用链包在 try/except 中，异常经 _safe_warn 降级为警告，不向上抛。
- 调用路径：`jiuwenswarm/server/runtime/debug_trace/stream_logger.py`（`DebugTraceLogger.begin_subagent`） → `jiuwenswarm/server/runtime/debug_trace/stream_logger.py`（`DebugTraceLogger._write_raw`）
- 来源：[jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L304–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L304-L316),
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L556–L568](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L556-L568)
- **resolve_debug_trace_settings 与 feed_subagent 的契约** resolve_debug_trace_settings(*, mode: str, request_debug: bool) 是关键字-only 入口，每次调用都重新加载 debug_trace 配置块并返回 frozen 的 DebugTraceSettings；调用方义务是传入本 run 的模式与请求级 /debug 标志。
  - DebugTraceLogger.feed_subagent(*, source, chunk) 在禁用或 include_subagent_flow 关闭时是静默 no-op，调用方无需先自行判断开关。
- 来源：[jiuwenswarm/server/runtime/debug_trace/config.py:L71–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L71-L79),
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L293–L302](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L293-L302),
  - [jiuwenswarm/server/runtime/debug_trace/config.py:L21–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L21-L28)
- **在 _write_raw 统一脱敏兜底（推断）** 设计推断（非作者历史意图）：
- 推断：注释说明 trace 文件直接 file.write、不走 logging，主 SensitiveDataFilter 覆盖不到，因此在 _write_raw 这个所有写路径的汇聚点统一做 _sanitize_log_text（含 api_key/Bearer 及指纹）。收益是 _emit、run 边界、_safe_warn 等写入无需各自脱敏；代价是每行落盘前多一次扫描，且防护正确性完全依赖该单点与 _sanitize_log_text 的实现。
- 来源：[jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L556–L568](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L556-L568)
- **resolve_debug_trace_settings 内的 debug/dump/otel 判定（仅本函数）** mode 以 code 前缀取 debug_trace.code，否则取 agent 块；debug_enabled = request_debug 或该块 enabled；dump_enabled 在其下默认开、仅当值恰为 False 才关；otel_enabled 还需该块 otel_enabled（默认 False）——已为 true 的 agent_observability 由 sync_agent_observability 处理，不在此函数。
- 来源：[jiuwenswarm/server/runtime/debug_trace/config.py:L58–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L58-L59),
  - [jiuwenswarm/server/runtime/debug_trace/config.py:L71–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L71-L95)
- **_load_debug_trace_config 对 jiuwenswarm.common.config 的尽力读取** 函数体内延迟 import common.config.get_config 来读 debug_trace 块；任何异常或非 dict 值都返回 {}，随后 resolve_debug_trace_settings 把 mode/limits/redaction 三个块当空 dict 继续计算。
- 来源：[jiuwenswarm/server/runtime/debug_trace/config.py:L47–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L47-L55),
  - [jiuwenswarm/server/runtime/debug_trace/config.py:L76–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L76-L85)
- **dump 文件 mkdir/open 失败仅禁用当前 DebugTraceLogger 实例** init 这段 try 中 mkdir/open 抛异常即被 except 捕获：记 '[DebugTrace] disabled ... open failed' 警告并置 _disabled=True；此后 flush() 命中 _disabled 守卫直接 return，feed_subagent() 在 _disabled（或 include_subagent_flow 关闭）时同样 no-op 不写文件。
- 来源：[jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L240–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L240-L249),
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L293–L302](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L293-L302),
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L378–L380](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L378-L380)
- **include_subagent_flow 默认与覆盖的 helper 级单元断言** test_config_include_subagent_flow_default_and_override 把 debug_config._load_debug_trace_config 桩为 {}，调用真实导入的 resolve_debug_trace_settings(mode="code.normal", request_debug=True) 断言 include_subagent_flow 为 True（默认开）；
  - 桩改为 {"code": {"include_subagent_flow": False}} 后断言为 False。所示断言仅覆盖该配置解析 helper，不含 DebugTraceLogger 或 tracing/stream 运行；本轮未执行。
- 来源：[tests/unit_tests/agentserver/test_debug_trace.py:L17–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_debug_trace.py#L17-L21),
  - [tests/unit_tests/agentserver/test_debug_trace.py:L692–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_debug_trace.py#L692-L701)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/feature-depth-debug-trace.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L304-L316；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L556-L568
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py:L71-L79；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L293-L302
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py:L21-L28；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_debug_trace.py:L692-L701
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py:L58-L59；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py:L71-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py:L47-L55；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py:L76-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L240-L249；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L378-L380
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_debug_trace.py:L17-L21
- 源页字段（feature）：debug-trace
- 入口（entry_points）：jiuwenswarm/server/runtime/debug_trace/config.py；jiuwenswarm/server/runtime/debug_trace/stream_logger.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/debug_trace/config.py；jiuwenswarm/server/runtime/debug_trace/stream_logger.py；jiuwenswarm/server/runtime/debug_trace/*.py
