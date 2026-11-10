---
name: feature-xiaoyi-timestamp-utc8-tool
description: 时间戳转北京时间工具 convert_timestamp_to_utc8_time 概览：职责与数据流、固定 UTC+8 参数、公开入口与输入输出契约、依赖关系、设计取舍与验证入口（timestamp_tool.py）
metadata:
  scope: 只收 convert_timestamp_to_utc8_time 的功能概览；调用链、异常分支与测试等实现细节归 feature-depth-xiaoyi-timestamp-utc8-tool
---
# 时间戳转北京时间工具 (convert_timestamp_to_utc8_time)

## 现状

- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 秒/毫秒判别采用混合启发式：先按十进制字符串长度（13 或 10）匹配，再用 `> 1e12` 阈值兜底，其余一律按秒处理。这换来对常见输入的鲁棒性，但边界值（如 11–12 位或极小的毫秒时间戳）会被误判为秒级——属于推断的代价，所示代码未附作者说明。函数签名标注 `float` 却同时接受 int，NaN/Inf 显式拒绝，是防御性校验的选择。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L37–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L37-L60)
- **验证入口**
- 所示文件中不含测试代码；工具内的运行时校验（None 检查、类型检查、NaN/Inf 检查、`fromtimestamp` 的异常捕获）构成输入层面的防御，成功转换会通过 `logger.info("[TIMESTAMP_TOOL] ...")` 留下可观测日志。未在本次提供的材料中看到针对该工具的测试文件，无法断言其覆盖情况。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L39–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L39-L47),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L71–L75](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L71-L75)
- **职责与数据流**
- 该工具位于 `xiaoyi_phone_tools` 包内，依赖 `openjiuwen.core.foundation.tool` 的 `@tool` 装饰器完成注册，复用包内 `utils.ToolInputError` 和 `jiuwenswarm.common.utils.logger`。
  - 执行流程为：输入校验（None/类型/NaN/Inf）→ 秒/毫秒判别（按绝对值取整后的十进制字符串长度 13 或 10，`abs > 1e12` 兜底为毫秒，其余按秒乘 1000）→ 用固定 UTC+8 时区 `datetime.fromtimestamp` 转换 → `strftime("%Y%m%d %H%M%S")` 格式化。它不是纯函数：成功转换会执行 `logger.info("[TIMESTAMP_TOOL] ...")` 产生可观测的日志副作用，然后再返回结果字典。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L13–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L13-L16),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L49-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L71–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L71-L84)
- **固定行为参数**
- 工具没有可配置项：时区硬编码为 `timezone(timedelta(hours=8))`，输出格式硬编码为 `%Y%m%d %H%M%S`。秒/毫秒判别的启发式也是编译在代码里的常量：对绝对值 `ts_abs = abs(timestamp)` 取整后转字符串，长度为 13 按毫秒、为 10 按秒，`ts_abs > 1000000000000` 也按毫秒，其余一律按秒（乘 1000）。注意阈值比较的是绝对值，例如绝对值超过 1e12 的负数时间戳同样按毫秒处理。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L49-L63),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L69–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L69-L69)
- **公开入口与输入输出契约**
- 公开入口是经 `@tool` 装饰器注册的 `convert_timestamp_to_utc8_time(timestamp: float) -> dict`，工具名为 `convert_timestamp_to_utc8_time`，描述中声明接受秒级（10 位）或毫秒级（13 位）数字时间戳。输入契约：None、非 int/float 类型、NaN/Inf 均抛出 `ToolInputError`（中文错误消息）；`datetime.fromtimestamp` 转换失败时同样包装为 `ToolInputError`。
  - 输出为 `dict`，形如 `{"content": [{"type": "text", "text": "YYYYMMDD hhmmss"}]}`，格式由 `strftime("%Y%m%d %H%M%S")` 硬编码为 UTC+8 时间。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L19–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L19-L43),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L62–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L62-L84)
- **支持行为与依赖关系**
- 核心行为：自动判别秒/毫秒时间戳——对绝对值取整后的十进制字符串长度为 13 按毫秒、为 10 按秒，绝对值大于 1e12 也按毫秒，其余按秒乘 1000；随后用固定时区 `timezone(timedelta(hours=8))` 转换为北京时间。依赖：`openjiuwen.core.foundation.tool` 的 `@tool` 装饰器、包内 `utils.ToolInputError`、`jiuwenswarm.common.utils.logger`（成功转换时记录 `[TIMESTAMP_TOOL]` 日志）。
  - 工具描述明确其与日程/闹钟搜索工具的关系：当 `search_calendar_event`、`search_alarm` 返回结果含时间戳时，建议优先调用本工具转换为标准北京时间再做回答。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L13–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L13-L16),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L29–L35](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L29-L35),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L49-L65)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-timestamp-utc8-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L37-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L39-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L71-L75
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L13-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L71-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L69-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L19-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L62-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L29-L35
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py:L49-L65
- 源页字段（feature）：xiaoyi-timestamp-utc8-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py
