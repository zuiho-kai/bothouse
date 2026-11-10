---
name: feature-depth-xiaoyi-location-tool
description: get_user_location 实现深读：无参异步工具构建 GetCurrentLocation 指令并经 WebSocket 设备通道等待响应、硬编码参数、非 dict outputs 包装与 code/retErrCode 校验、装配测试断言 27 个工具
metadata:
  scope: 只收 get_user_location 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-location-tool
---
# 设备定位工具（get_user_location）：实现深读

## 现状

- [[feature-xiaoyi-location-tool]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **构建 GetCurrentLocation 指令并经设备通道等待响应** 无参协程先构造 namespace=Common/name=Action、intentName=GetCurrentLocation（isNeedGeoAddress=True、timeOut=5、executeMode=background）的命令 dict，调用 execute_device_command 等待 outputs；
  - 非 dict 则包成 {"value": outputs}，经 raise_if_device_error 校验后以 content[0].text 返回 outputs 的 JSON 字符串（ensure_ascii=False）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L33–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L33-L86)
- **无参异步工具，返回设备 outputs 的 JSON 文本** get_user_location 以 @tool(name="get_user_location") 注册，async 无参；成功时返回 {"content":[{"type":"text","text": json.dumps(outputs)}]}，outputs 为 WebSocket 指令 GetCurrentLocation 的设备响应（非 dict 时包装为 {"value": outputs}）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L19-L31),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L68-L86)
- **指令参数在函数体内硬编码，无外部配置入口** executeParam 各项（achieveType="INTENT"、bundleName="com.huawei.hmos.aidispatchservice"、intentName、timeOut=5、needUnlock=True 等）均为字面量硬编码；get_user_location 本身不接收也不读取任何配置。execute_device_command 的 timeout 由其自身默认/调用方决定，此处未传入。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L34–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L34-L68)
- **依赖 execute_device_command 的 WebSocket 通道与事件处理** 工具将发送与等待全部委托给 execute_device_command：后者注册 intent_name 数据事件处理器，经 channel.send_xiaoyi_phone_tools_command 发送；sent 为假抛 RuntimeError("发送指令失败，WebSocket 未连接")，成功路径返回 result_data（None 时返回 {}，注释明确勿用 or 短路），finally 中注销处理器。工具对通道协议的耦合即此两函数调用。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L168–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L168-L207),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L16–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L16-L16)
- **非 dict outputs 先包装；code/retErrCode 校验失败抛 RuntimeError** L70–L73 将非 dict 的 outputs 包成 {"value": outputs} 后调用 raise_if_device_error。utils.py L215–L228：非 dict 直接 return；顶层 code 未通过 _outputs_top_level_code_ok 时抛 RuntimeError，消息含 errorMsg/errMsg（默认"未知错误"）与错误码；
  - retErrCode 仅在非 None 且 str(ret) != "0" 时抛 RuntimeError（空字符串也触发），消息含 retErrCode 值。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L68-L73),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L215–L228](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L215-L228)
- **装配测试断言 27 个工具与空列表，get_user_location 位于生产元组** test_swarm_assembly.py:1872 的测试实际调用 _build_xiaoyi_phone_tools，断言 channels.xiaoyi.phone_tools_enabled 为 True 时返回 27 个工具、配置为空时返回 []。生产元组 _XIAOYI_PHONE_TOOLS 显式包含 get_user_location。该断言仅覆盖配置门控辅助函数与聚合数量，不涉及 get_user_location 的运行时行为；本条为已有测试证据，本次未执行。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-location-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L33-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L34-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L168-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L16-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L215-L228；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150
- 源页字段（feature）：xiaoyi-location-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py
