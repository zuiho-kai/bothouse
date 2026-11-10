---
name: feature-depth-xiaoyi-contact-search
description: search_contact 实现深读：校验 name 后组装 SearchContactLocal 命令、硬编码参数与 channels.xiaoyi 会话标识、活动会话依赖、ToolInputError 与 RuntimeError 失败路径、assembly 测试仅断言 27 个工具
metadata:
  scope: 只收 search_contact 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-contact-search
---
# 设备联系人搜索工具（search_contact）：实现深读

## 现状

- [[feature-xiaoyi-contact-search]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **search_contact 校验 name 后组装 SearchContactLocal 设备命令并格式化返回** 回调先校验 name 为非空字符串（否则抛 ToolInputError），strip 后记录日志，组装 namespace=Common/name=Action 的命令（intentName=SearchContactLocal、bundleName=com.huawei.hmos.aidispatchservice、timeOut=5、intentParam={"name": name_clean}），
  - 经 execute_device_command 取 outputs；非 dict 则包成 {"outputs": ...}，从 result.items 数出条数，返回 format_success_response(dict(outputs), f"搜索到联系人信息（{n} 条）")。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L45-L96)
- **async def search_contact(name: str) -> Dict[str, Any]：单必填参数、成功返回设备 outputs 的包装** 经 openjiuwen @tool 注册为名为 "search_contact" 的工具，唯一参数 name（联系人姓名）；文档承诺 Returns 的 content[0].text 为设备 outputs 的 JSON 字符串。name 非字符串或去空白后为空时抛 ToolInputError（"缺少必填参数 name"）且不被兜底 except 吞掉（ToolInputError 直接 re-raise）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L28–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L28-L47),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L93–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L93-L102)
- **命令字段硬编码、intentParam.name 为唯一变量，会话标识从 channels.xiaoyi 配置读取** executeParam 中 intentName=SearchContactLocal、bundleName、timeOut:5 等均硬编码，仅 intentParam.name 取自入参；execute_device_command 的 timeout 形参默认 60.0 秒；session_id 从 config 的 channels.xiaoyi.last_session_id 读取，task_id 初始为空串。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L56–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L56-L82),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L58–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L58-L62),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L87–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L87-L96)
- **依赖 get_runtime_xiaoyi_channel() 返回的活动会话通道** execute_device_command 首先取 get_runtime_xiaoyi_channel()；返回 None 时直接抛 RuntimeError（"No active XY session found. {intent_name} tool can only be used during an active conversation."），即该工具只能在活动小艺会话期间使用。
  - search_contact 本身依赖 openjiuwen 的 @tool 装饰器与 jiuwenswarm.common.utils 的 logger。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L76–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L76-L85),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L18–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L18-L25)
- **空 name 抛 ToolInputError 原样上抛；无活动会话或设备执行异常时抛 RuntimeError** name 非字符串或去空白后为空时抛 ToolInputError（status=400）并被 except ToolInputError: raise 原样传播；get_runtime_xiaoyi_channel() 返回 None 时抛 RuntimeError（无活动 XY 会话）；其余任意异常被捕获并包装为 RuntimeError("搜索联系人失败: …") 后抛出。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L45-L49),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L98–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L98-L102),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L80–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L80-L85)
- **区分输入错误与执行失败，但以 RuntimeError 统一包装其他异常类型** search_contact 对空白 name 抛出 status=400 的 ToolInputError 并原样上抛，使参数错误与设备执行失败在类型上可区分；代价是其余任何 Exception 都被改写为 RuntimeError（搜索联系人失败: …），原始异常类型仅通过 `from e` 的 cause 链保留。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L45-L47),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L98–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L98-L102),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L53–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L53-L55)
- **既有 assembly 测试断言 phone_tools_enabled 开关下工具数量为 27 或 0（未执行）** tests/agents/swarm/test_swarm_assembly.py:1872 的 test_xiaoyi_phone_tools_gated_by_config 实际调用 tools._build_xiaoyi_phone_tools：config 含 channels.xiaoyi.phone_tools_enabled=True 时断言返回 27 个工具，config 为空（默认 False，tools.py:464-468）时断言返回 []。
  - 生产元组 _XIAOYI_PHONE_TOOLS 显式含 search_contact（tools.py:129），故该开关覆盖其暴露；但断言仅为聚合计数，不校验 search_contact 的检索行为或设备交互。NOT EXECUTED。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-contact-search.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L28-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L93-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L76-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L18-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L56-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L58-L62
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L87-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L98-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L80-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py:L45-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L53-L55；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-contact-search
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py
