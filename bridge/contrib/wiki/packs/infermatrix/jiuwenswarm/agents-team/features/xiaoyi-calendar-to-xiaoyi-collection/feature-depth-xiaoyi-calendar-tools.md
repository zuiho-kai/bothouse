---
name: feature-depth-xiaoyi-calendar-tools
description: 设备日历工具实现深读：create_calendar_event 校验与下发流程、硬编码 timeOut 5 与 bundleName、ToolInputError 与 RuntimeError 传播、朴素 datetime 时区取舍、.utils 依赖、装配门控测试（27 个工具）
metadata:
  scope: 收 calendar_tools.py 的实现级事实，来源另含 test_swarm_assembly.py、utils.py；日历工具的职责、验证情况、行为与入口契约概览归 feature-xiaoyi-calendar-tools
---
# 设备日历日程工具（create/search_calendar_event）：实现深读

## 现状

- [[feature-xiaoyi-calendar-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **create_calendar_event：校验后构造命令并经 execute_device_command 下发** 校验 title/dt_start/dt_end 非空，strptime 按 %Y-%m-%d %H:%M:%S 转毫秒时间戳，构造 executeParam 后 await execute_device_command("CreateCalendarEvent", command)；若 result 为 dict 才调用 raise_if_device_error，最后返回 format_success_response。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L113–L129](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L113-L129),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L137–L164](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L137-L164),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L166–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L166-L173)
- **命令字面量硬编码：timeOut 5、bundleName com.huawei.hmos.calendardata** 两处命令构造均硬编码 executeMode="background"、timeOut 5、bundleName "com.huawei.hmos.calendardata"；create 的 executeParam 不含 appType/permissionId，search 则含 appType="OHOS_APP" 与 permissionId=[]。所示片段内无外部配置读取。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L137–L160](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L137-L160),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L244–L256](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L244-L256)
- **输入错误抛 ToolInputError；设备错误码与超时分别转 RuntimeError 传播** search 中 start_time/end_time 缺失或 _parse_time_string_ymd_hhmmss 抛 ValueError 时转为 ToolInputError 并原样重抛；设备 outputs 的 code 失败或 retErrCode 非 "0" 时 raise_if_device_error 抛 RuntimeError；
  - execute_device_command 超时抛 asyncio.TimeoutError 转为 RuntimeError，finally 中注销事件处理器。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L219–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L219-L229),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L265–L267](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L265-L267),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L198–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L198-L207),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L210–L228](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L210-L228)
- **朴素 datetime 解析实现简单，但结果依赖主机本地时区** 设计推断（非作者历史意图）：
- （推断）create 用 strptime+timestamp()、解析器用 datetime(...).timestamp()*1000，均按本地时区换算毫秒，实现简洁；代价是同一输入字符串在不同时区主机上产生不同的毫秒时间戳。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L121–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L121-L125),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L72–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L72-L79)
- **依赖同包 .utils 辅助函数与共享 execute_device_command 下发命令** 模块从 .utils 导入 execute_device_command、format_success_response、raise_if_device_error、ToolInputError（L19–L24）。create 将命令委托给 await execute_device_command("CreateCalendarEvent", ...)，仅当 result 为 dict 时调用 raise_if_device_error（L163–L167）；
  - search 委托 execute_device_command("SearchCalendarEvent", ...) 后无条件调用 raise_if_device_error（L264–L267）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L19–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L19-L24),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L163–L167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L163-L167),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L264–L267](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L264-L267)
- **既有装配测试仅覆盖配置开关门控（helper 级，未执行）** tests/agents/swarm/test_swarm_assembly.py 的 test_xiaoyi_phone_tools_gated_by_config 实际调用 _build_xiaoyi_phone_tools：config 含 channels.xiaoyi.phone_tools_enabled=True 时断言返回 27 个工具，config 为空时断言返回 []。
  - 生产元组 _XIAOYI_PHONE_TOOLS 明确包含 create_calendar_event 与 search_calendar_event，故两工具的注册随该开关被此测试间接覆盖；但断言只检查聚合计数与空列表，不校验单工具身份、意图构造或设备执行结果。validation_kind 为 helper_unit：断言只覆盖构建 helper 本身。标注：本条为对既有测试的静态审读，测试未在本次执行。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-calendar-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L113-L129
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L137-L164
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L166-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L137-L160
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L244-L256
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L219-L229
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L265-L267
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L198-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L210-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L121-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L72-L79
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L19-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L163-L167
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py:L264-L267；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-calendar-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py
