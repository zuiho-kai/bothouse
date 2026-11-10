---
name: feature-depth-xiaoyi-call-phone-tool
description: call_phone 实现深读：校验后构造 StartCall 命令、async 签名与返回、slot_id 默认 0 且仅 0/1、execute_device_command 与 WebSocket 依赖、RuntimeError 包装取舍、ToolInputError 原样重抛、装配门控测试
metadata:
  scope: 收 phone_tools.py 的实现级事实，来源另含 test_swarm_assembly.py、utils.py；call_phone 的行为、命令参数与取舍概览归 feature-xiaoyi-call-phone-tool
---
# 小艺拨打电话工具 (call_phone)：实现深读

## 现状

- [[feature-xiaoyi-call-phone-tool]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **call_phone 校验入参后构造 StartCall 命令并等待设备响应** slot_id 为 None 时置 0；phone_number 非空字符串且 strip 后非空、slot_id 属于 (0, 1)，否则抛 ToolInputError。随后构造 Common/Action、intentName=StartCall 的命令，交给 execute_device_command("StartCall", command)，dict 化后经 raise_if_device_error 检查，成功返回 content 内嵌 outputs JSON 的响应。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L45–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L45-L107)
- **async call_phone(phone_number: str, slot_id: Optional[int] = None) -> Dict[str, Any]** 用 @tool(name="call_phone") 注册；docstring 声明返回 success、code、phoneNumber、slotId、message（与设备成功回调字段一致），实际返回 {"content":[{"type":"text","text":<设备 outputs 的 JSON>}]}. 调用方须传有效 phone_number。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L24–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L24-L44),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L98–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L98-L107)
- **slot_id 未传时按 0（主卡），仅接受 0 或 1** slot_id 默认 None，函数内 if slot_id is None: slot_id = 0；随后 slot_id not in (0, 1) 时抛 ToolInputError("slot_id 必须是 0（主卡）或 1（副卡）")。命令中另固定 timeOut: 5、executeMode: "background" 等字段，非可配置参数。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L46–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L46-L61),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L70–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L70-L82)
- **依赖 execute_device_command 与 raise_if_device_error，经频道 WebSocket 与设备通信** call_phone 从 .utils 导入 execute_device_command、raise_if_device_error、ToolInputError，并经 openjiuwen 的 @tool 注册。
  - execute_device_command 通过 channel.send_xiaoyi_phone_tools_command 发送并在 asyncio.wait_for(result_event.wait(), timeout=timeout) 内等响应；发送失败（sent 为假）抛 RuntimeError("发送指令失败，WebSocket 未连接")，finally 注销事件处理器。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L14–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L14-L21),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L91-L96),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L171–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L171-L207)
- **统一包装为 RuntimeError 简化了非输入错误的对外类型，但调用方需经 __cause__ 区分原始异常** 设计推断（非作者历史意图）：
- 收益：非输入失败统一为 RuntimeError 并带中文上下文「拨打电话失败: …」；成本：调用方若需原始异常类型必须检查 __cause__（`from e` 已保留），不能仅凭被抛类型区分超时、设备错误等不同来源。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L109–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L109-L113)
- **输入校验抛 ToolInputError；其他异常被包装为 RuntimeError 且 ToolInputError 原样重抛** phone_number 为空/非字符串、strip 后为空或 slot_id 不在 (0,1) 时抛 ToolInputError（其 status 属性为 400；docstring 称框架会返回 HTTP 400，但框架处理代码未在所示片段中）；except 分支中 ToolInputError 原样 raise，其余 Exception 记录 error 日志并以 RuntimeError("拨打电话失败: ...") from e 重抛。
  - execute_device_command 的非 dict 输出先兜底为 {} 再经 raise_if_device_error 检查。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L53–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L53-L61),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L91-L98),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L109–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L109-L113),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L46-L55)
- **配置门控构建 helper 的既有单测（helper 覆盖，未执行）** 设计推断（非作者历史意图）：
- tests/agents/swarm/test_swarm_assembly.py 的 test_xiaoyi_phone_tools_gated_by_config 调用 tools._build_xiaoyi_phone_tools：config 为 {"channels":{"xiaoyi":{"phone_tools_enabled":True}}} 时断言返回 27 个工具，config 为 {} 时断言返回空列表。
  - 生产侧 _XIAOYI_PHONE_TOOLS 元组显式包含 call_phone，_build_xiaoyi_phone_tools 在开关关闭时返回 []（默认 False）。该断言只覆盖聚合门控 helper，不校验单个工具身份、入参校验或设备调用行为。NOT EXECUTED：此处仅引用既有测试代码，未在本次运行。推断（inference）：call_phone 仅经由元组成员关系与计数 27 间接被覆盖。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-call-phone-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L45-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L24-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L98-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L46-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L70-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L14-L21
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L171-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L109-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L53-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46-L55；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-call-phone-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py
