---
name: feature-xiaoyi-location-tool
description: 设备定位工具 get_user_location 概览：公共入口与返回契约、GetCurrentLocation 命令构造与设备执行流、硬编码参数、设计取舍与验证（location_tool.py）
metadata:
  scope: 只收 get_user_location 的功能概览；调用链、异常分支与测试等实现细节归 feature-depth-xiaoyi-location-tool
---
# 设备定位工具 get_user_location（feature-xiaoyi-location-tool）

## 现状

- **公共入口与返回契约**
- `get_user_location` 是一个用 `@tool` 装饰器注册的异步工具，名称为 `get_user_location`，无输入参数。工具描述声明返回 WGS84 经纬度坐标、需要设备授权位置权限，且操作超时 60 秒、失败后最多重试一次。返回值是工具标准响应结构：`content[0].text` 为设备 `outputs` 的 JSON 字符串（`ensure_ascii=False`）。非 dict 的 `outputs` 会被包成 `{"value": outputs}`；
  - 检测到设备错误时通过 `raise_if_device_error(outputs, "获取位置失败")` 抛出异常。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L19-L31),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L68-L86)
- **命令构造与设备执行流**
- 工具自身不直接访问定位硬件，而是构造一个 `Common/Action` 协议命令并交给共享的 `execute_device_command("GetCurrentLocation", command)` 异步等待设备返回。
  - 命令的 `executeParam` 指向华为 HMOS 的意图派发服务（`bundleName: com.huawei.hmos.aidispatchservice`，`intentName: GetCurrentLocation`，`achieveType: INTENT`，`executeMode: background`，`needUnlock: True`，`timeOut: 5`），属于典型的代理/转发模式：定位能力由设备端实现，工具只做命令拼装、响应校验与格式化。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L33–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L33-L68)
- **配置项与硬编码参数**
- 工具无输入参数，所有命令参数均以字面量硬编码在函数体内：`bundleName: com.huawei.hmos.aidispatchservice`、`intentName: GetCurrentLocation`、`isNeedGeoAddress: True`、`timeOut: 5` 等。工具描述另声明面向调用方的操作超时为 60 秒、失败后最多重试一次；这两个数字分属不同层（提示语 vs 命令字段 `timeOut`），所示代码未说明 `timeOut: 5` 的单位与作用范围，也不含任何外部配置读取。改动这些行为需修改此文件代码。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L19-L26),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L41–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L41-L54)
- **设计取舍（推断）**
- Inference / 设计推断（非作者历史意图）：
- 推断：工具选择零参数、全部协议字段硬编码的薄代理设计，换取调用简单与行为可预测，代价是坐标精度、超时单位、目标 bundle 等无法按调用调整。重试与节流不在工具内实现——函数体 L26–L86 未包含任何重试逻辑，而是把"60 秒超时、最多重试一次"写入面向调用模型的工具描述（L23），即由模型侧遵守；该约束的来源与理由无文档证据，标注为基于代码形态的推断。`execute_device_command` 的内部行为（如它自身的超时/重试）未在所示代码中体现。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L19-L26),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L68-L73)
- **功能行为**
- `get_user_location` 是注册名为 `get_user_location` 的零参数异步工具，声明返回用户当前位置的 WGS84 经纬度坐标，且需要设备授权位置访问权限；描述还要求调用方遵守 60 秒操作超时、失败后最多重试一次。
  - 功能实现上，它构造 `Common/Action` 协议命令（`intentName: GetCurrentLocation`、`bundleName: com.huawei.hmos.aidispatchservice`、`executeMode: background`），并通过 `intentParam.isNeedGeoAddress: True` 请求逆地理地址，随后交由共享的 `execute_device_command` 等待设备返回，定位能力本身由设备端服务提供。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L19-L26),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L41–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L41-L54),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L67–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L67-L73)
- **验证与运行时防护**
- 所示输入不含任何自动化测试：location_tool.py 是纯工具实现文件，整个文件（L1–L86）没有测试函数或测试入口，也未展示针对该工具的测试文件。代码中实际存在的校验是运行时防护而非测试：L70–L71 将非 dict 的设备返回归一化为 {"value": outputs}，随后 L73 调用共享辅助函数 raise_if_device_error(outputs, "获取位置失败") 做设备错误检查。该辅助函数与 execute_device_command 的内部校验/超时行为在所示代码中不可见（仅 L16 导入），因此无法断言完整错误处理范围。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L68-L73),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L14–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L14-L17)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-location-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L33-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L19-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L41-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L68-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L67-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py:L14-L17
- 源页字段（feature）：xiaoyi-location-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py
