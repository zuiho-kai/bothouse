---
name: feature-xiaoyi-alarm-crud
description: 小艺手机设备闹钟 CRUD 工具概览：create/search/modify/delete_alarm、com.huawei.hmos.clock 意图命令与 execute_device_command、创建默认值与枚举校验、检索条件、部分更新覆盖风险
metadata:
  scope: 只收闹钟工具的功能概览（架构、配置、验证、取舍、入口契约、行为）；delete_alarm 流程、items 规范化、固定 timeOut、依赖与单测等实现级细节归 feature-depth-xiaoyi-alarm-crud
---
# 小艺手机工具 — 设备闹钟 CRUD（create/search/modify/delete_alarm）

## 现状

- **验证入口未在所示范围内出现**
- 所示片段不包含任何测试文件或测试引用；本任务无法基于这些证据描述该功能的测试入口与覆盖情况。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L320–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L320-L333)
- **命令构造 + 共享通道执行**
- 每个工具本地校验参数并构造一个 `header: Common/Action` 命令，`executeParam` 固定指向 `bundleName: com.huawei.hmos.clock` 与对应 intentName（CreateAlarm/SearchAlarm/ModifyAlarm/DeleteAlarm），然后交给共享的 `execute_device_command`。
  - 该函数从 runtime 取 xiaoyi channel，从 config 读会话标识，注册按 `intent_name` 匹配的 data-event 处理器，`asyncio.wait_for` 默认 60 秒等待响应，并在 finally 中注销处理器。`delete_alarm` 的输入归一化委托给未在节选中展示的 `_normalize_delete_items`。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L263–L288](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L263-L288),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L58–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L58-L96),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L168–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L168-L207),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L596–L601](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L596-L601)
- **创建默认值、枚举校验与会话配置**
- `create_alarm` 在参数缺省时填入默认值：标题 "闹钟"、`alarm_snooze_duration=10`、`alarm_snooze_total=0`、`alarm_ring_duration=5`、`days_of_wake_type=0`，随后对枚举型字段做成员校验（合法值集合定义于未展示的模块级常量 `_ALARM_SNOOZE_DURATION` 等，节选只显示校验逻辑与报错文案）。运行时会话身份从 config 读取：`channels.xiaoyi.last_session_id` / `last_task_id`；
  - 缺少有效 session_id 时抛 RuntimeError。命令内常量固定：`timeOut: 5`、`needUnlock: True`、`executeMode: background`。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L205–L221](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L205-L221),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L87–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L87-L104),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L263–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L263-L278)
- **所示输入中的验证入口**
- 所示文件节选（alarm_tools.py、utils.py 及对照的 calendar/contact tools）均为实现代码，不含测试文件或测试引用；本页无法基于这些证据描述该功能的测试入口与覆盖情况。已有的验证手段是运行时防御：参数校验抛 `ToolInputError`、设备错误经 `raise_if_device_error` 检查 `code`/`retErrCode` 后抛 RuntimeError。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L286–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L286-L292),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L210–L228](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L210-L228)
- **部分更新的覆盖风险与 days_of_week 的不一致处理**
- Inference / 设计推断（非作者历史意图）：
- `modify_alarm` 的 docstring 明确提示：修改未涉及字段若希望保持原值，宜先 `search_alarms` 取原值再一并传入，避免默认覆盖——即设备侧修改可能用默认值填充未传字段（此为文档声明的设计权衡）。另外对「`days_of_week` 配合非 3 的 `days_of_wake_type`」处理不一致：创建路径仅记 warning 并忽略，修改路径在 `days_of_wake_type=None` 时直接抛 `ToolInputError`。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L450–L455](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L450-L455),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L240–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L240-L247),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L517–L527](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L517-L527)
- **异步工具函数契约与统一响应格式**
- 四个闹钟操作均以带 Optional 类型注解的 async 函数形式定义：create_alarm 接受 alarm_time 或 hour+minute 等参数，search_alarms 接受五个可选过滤参数，modify_alarm 接受 entity_id/alarm_id 及可选字段，delete_alarm 接受 items 或 alarm_id。
  - 参数校验失败抛出 ToolInputError（该异常携带 status=400，docstring 说明框架会返回 HTTP 400 而非 500），且各工具的 except 分支会原样重新抛出 ToolInputError、仅把其他异常包装为 RuntimeError。成功路径统一经 format_success_response 返回 {"content":[{"type":"text","text": JSON}]} 形式的字典。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L191–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L191-L202),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L334–L340](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L334-L340),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L456–L468](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L456-L468),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L247–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L247-L269)
- **可组合检索条件与 modify 的兼容别名**
- search_alarms 支持可组合的检索条件（range_type、alarm_state、days_of_wake_type、成对的 start_time/end_time）；当全部条件缺省时自动回退为 range_type="all"，start_time 与 end_time 必须成对提供且 start 早于 end，时间区间转换为设备侧 timeInterval 毫秒数组。
  - modify_alarm 兼容两种入参别名：entity_id 与 alarm_id 均指向设备侧闹钟实体 ID（缺失时抛 ToolInputError），enabled 布尔在 alarm_state 未提供时映射为 1/0；docstring 同时提示修改未涉及字段时宜先 search_alarms 取原值再一并传入，避免默认覆盖。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L349–L377](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L349-L377),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L471–L495](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L471-L495),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L450–L455](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L450-L455)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-alarm-crud.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L320-L333
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L263-L288
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L58-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L168-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L596-L601
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L205-L221
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L87-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L263-L278
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L286-L292
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L210-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L450-L455
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L240-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L517-L527
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L191-L202
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L334-L340
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L456-L468
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L247-L269
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L349-L377
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py:L471-L495
- 源页字段（feature）：xiaoyi-alarm-crud
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py
  - jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py
