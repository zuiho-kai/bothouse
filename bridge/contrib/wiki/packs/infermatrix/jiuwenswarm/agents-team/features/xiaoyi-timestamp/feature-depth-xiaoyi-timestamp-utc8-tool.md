---
name: feature-depth-xiaoyi-timestamp-utc8-tool
description: "convert_timestamp_to_utc8_time 实现深读：秒/毫秒位宽启发式归一、@tool 注册与 timestamp: float 入参、固定 UTC+8、None/NaN/Inf 与 fromtimestamp 异常守卫、11-12 位兜底行为、权限测试未调用转换本体"
metadata:
  scope: 只收 convert_timestamp_to_utc8_time 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-timestamp-utc8-tool
---
# 时间戳转北京时间工具 (convert_timestamp_to_utc8_time)：实现深读

## 现状

- [[feature-xiaoyi-timestamp-utc8-tool]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **秒/毫秒时间戳经位宽启发式归一后转为北京时间字符串** 输入 timestamp 先经位宽判断（int 后字符串长 13 位视为毫秒、10 位视为秒，否则按 ts_abs>1000000000000 分流），乘 1000 归一为毫秒，再用固定 UTC+8 时区 datetime.fromtimestamp 转换并 strftime 为 "%Y%m%d %H%M%S"，返回 content 列表字典。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L49-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L77–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L77-L84)
- **@tool 注册、单一 timestamp: float 入参、返回 text content 字典** 函数经 openjiuwen @tool 装饰注册为名为 convert_timestamp_to_utc8_time 的工具，签名仅接受 timestamp: float；返回 {"content":[{"type":"text","text":格式化时间}]}，文档字符串声明输出格式 YYYYMMDD hhmmss 并建议先转换再回答。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L19–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L19-L38),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L77–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L77-L84)
- **固定 UTC+8 与位数判定规则，无外部配置项** 时区固定为 timezone(timedelta(hours=8))（L63），输出格式固定为 "%Y%m%d %H%M%S"（L69）。秒/毫秒判定基于绝对值整数的字符串位数：13 位按毫秒，10 位按秒并乘 1000，超过 1000000000000 按毫秒，其余按秒乘 1000（L50–L60）。所示分支内未读取任何配置项，且输入为 None/非数字/NaN/Inf 时直接抛 ToolInputError，不会到达转换逻辑（L39–L47）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L50–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L50-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L39–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L39-L47)
- **导入 openjiuwen @tool、logger 与本包 ToolInputError；仅成功格式化后记录 INFO 日志** L13–L16 显示三个直接依赖：tool 装饰器注册、logger、ToolInputError。日志（L71–L75）只在通过全部守卫且 fromtimestamp 成功后才执行；前置守卫抛错或 L65–L67 转换失败时不产生该 INFO 日志。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L13–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L13-L16),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L69–L75](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L69-L75)
- **None、非数字、NaN/Inf 守卫与 fromtimestamp 的 OSError/OverflowError/ValueError 均抛 ToolInputError** L39–L47 三条守卫各自抛 ToolInputError；L64–L67 的 try 仅包住 L65 的 fromtimestamp，捕获 OSError、OverflowError、ValueError 并包装为 ToolInputError 传播（携带 status=400，见 utils.py L53–L55）。不排除守卫之前其他未列异常。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L39–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L39-L47),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L64–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L64-L67),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L46-L55)
- **位宽启发式同时接受秒/毫秒，但 11-12 位输入落入乘 1000 兜底** 设计推断（非作者历史意图）：
- 用 int 后十进制位宽（13/10）区分毫秒/秒并配数值兜底，收益是无需额外参数即可兼容两种位宽；代价是 11 或 12 位的时间戳既不匹配 13 也不匹配 10，落入 ts_abs>1000000000000 else 分支被强制视为秒乘 1000，可能产出错误时间（推断）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L49-L60)
- **Runtime permission tests bind the real convert_timestamp_to_utc8_time and assert allow/interrupt/denied outcomes;
  - the UTC+8 conversion body is not invoked or asserted** test_readonly_real_binding_fast_path (pytest parametrized, async) registers the actual tool card (line 751 binds bindings.convert_timestamp_to_utc8_time, line 767 forces stateless=True only for this name) and asserts per variant: expected
  - == "allow" for valid and cross_session-with-convert_ (line 787), "denied" for deny/session_deny (line 789), via classify_permission_result(result) or AbortError→"interrupt" (lines 791-795).
  - Args are {"timestamp": 1700000000} (line 728) but no assertion checks the returned date; guards in timestamp_tool.py L39-47 are untested here. NOT EXECUTED by this review.
- 来源：[tests/unit_tests/agentserver/permissions/test_auto_permission_pipeline.py:L722–L754](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_auto_permission_pipeline.py#L722-L754),
  - [tests/unit_tests/agentserver/permissions/test_auto_permission_pipeline.py:L757–L798](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_auto_permission_pipeline.py#L757-L798),
  - jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/readonly_tool_bindings.py:L61–L70
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/readonly_tool_bindings.py#L61-L70`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-timestamp-utc8-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L77-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L19-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L13-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L69-L75
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L39-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L64-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L50-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_auto_permission_pipeline.py:L722-L754
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_auto_permission_pipeline.py:L757-L798
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/readonly_tool_bindings.py:L61-L70
- 源页字段（feature）：xiaoyi-timestamp-utc8-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py
