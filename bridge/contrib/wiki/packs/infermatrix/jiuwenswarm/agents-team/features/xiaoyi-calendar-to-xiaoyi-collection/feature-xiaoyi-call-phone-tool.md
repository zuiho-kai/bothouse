---
name: feature-xiaoyi-call-phone-tool
description: 小艺拨打电话工具 call_phone 概览：StartCall 意图、主卡 slotId=0 / 副卡 1、phone_number 校验、返回契约、aidispatchservice 命令参数与固定常量、校验前置取舍
metadata:
  scope: 只收 call_phone 的功能概览（行为、验证、入口契约、数据流、可调参数、取舍）；流程细节、slot_id 默认、依赖、异常包装与装配测试等实现级事实归 feature-depth-xiaoyi-call-phone-tool
---
# 小艺拨打电话工具 (call_phone)

## 现状

- **支持的行为**
- 支持通过设备侧意图 `StartCall` 发起电话，可选主卡（slotId=0，默认）或副卡（slotId=1）；`phone_number` 会 strip，空串或非字符串被拒绝。依赖同包 `utils` 提供的 `execute_device_command`、`raise_if_device_error` 与 `ToolInputError`，并复用 `jiuwenswarm.common.utils.logger` 记录调用与失败。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L3–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L3-L7),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L53–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L53-L61)
- **验证**
- Inference / 设计推断（非作者历史意图）：
- 所示文件仅含工具实现，未见测试代码；实现的校验逻辑（空号码、slot_id 越界走 ToolInputError，非 dict 输出兜底为空 dict）是可被单测覆盖的分支，但本次输入中没有任何测试文件或测试入口的凭证。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L45–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L45-L61),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L91-L98)
- **公开入口与返回契约**
- `call_phone(phone_number: str, slot_id: Optional[int])` 经 `@tool(name="call_phone", ...)` 注册为异步工具。成功时返回工具消息结构：`content` 是列表，其中 `content[0]` 为 `{"type": "text"}` 对象，设备回调输出被 `json.dumps` 序列化后放在其 `text` 字段（L100–L107）。
  - 注意：L42–L43 的文档字符串声称返回 success/code/phoneNumber/slotId/message 字段，但实现只是把 `execute_device_command` 的输出原样序列化（非 dict 输出在 L93–L94 被替换为 `{}`），并不保证这些字段存在。错误契约：`ToolInputError` 原样抛出（L109–L110），其余任何异常被包装为 `RuntimeError("拨打电话失败: ...")`（L111–L113）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L24–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L24-L43),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L91-L113)
- **职责与数据流**
- 工具流程：归一化 slot_id 默认值并校验输入（L45–L61），组装 `Common/Action` 设备命令（intentName=StartCall、bundleName=com.huawei.hmos.aidispatchservice、executeMode=background、needUnlock=True，intentParam 携带 phoneNumber/slotId，L63–L89），委托给同包 `utils.execute_device_command("StartCall", command)` 执行（L91），随后对输出做非 dict 兜底为 `{}`、
  - 经 `raise_if_device_error` 检查设备错误（L93–L96），再把输出 JSON 序列化并包装为 content 消息返回（L100–L107）；设备执行与错误判定逻辑完全在 `utils` 中，本文件可见部分不含传输细节。异常路径区分 ToolInputError 与兜底 RuntimeError（L109–L113）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L45–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L45-L61),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L63–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L63-L96),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L100–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L100-L113)
- **可调参数与内置常量**
- 仅有两个输入参数：`phone_number`（必填，strip 后不可为空）与 `slot_id`（未传时按 0 主卡，仅允许 0/1，L46–L61）。其余命令参数均为代码内固定：`timeOut: 5`、`executeMode: "background"`、`needUnlock: True`、`actionResponse: True` 等（L63–L89），不通过外部配置注入。工具描述中向调用方声明：操作超时时间为 60 秒，请勿重复调用此工具；
  - 如果超时或失败，最多重试一次（L26–L30）——注意 60 秒是描述文本中的值，命令 payload 内另写死 `timeOut: 5`，两者关系在所示代码中不可见。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L26–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L26-L30),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L46–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L46-L61),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L63–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L63-L89)
- **取舍：输入校验前置与命令参数硬编码**
- Inference / 设计推断（非作者历史意图）：
- 工具在调用设备前做严格的前置校验：`phone_number` 必须是非空字符串且 strip 后非空，`slot_id` 仅允许 0/1，违规抛 `ToolInputError` 并原样上抛（L53–L61、L109–L110），使其与其余异常（统一包装为 `RuntimeError("拨打电话失败: ...")`，L111–L113）区分开，调用方可据此区分输入错误与执行失败。
  - 代价是：命令 payload 的协议字段（`executeMode: "background"`、`needUnlock: True`、`timeOut: 5`、bundleName 等）全部硬编码在代码中（L63–L89），调用方唯一可调的只有号码与卡槽；且工具描述向调用方声明 60 秒超时（L26–L30），与 payload 内写死的 `timeOut: 5` 之间的关系在所示代码中不可见。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L53–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L53-L61),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L109–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L109-L113),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L63–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L63-L89),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L26–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L26-L30)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-call-phone-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L3-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L53-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L45-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L24-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L91-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L63-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L100-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L26-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L46-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L63-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py:L109-L113
- 源页字段（feature）：xiaoyi-call-phone-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py
