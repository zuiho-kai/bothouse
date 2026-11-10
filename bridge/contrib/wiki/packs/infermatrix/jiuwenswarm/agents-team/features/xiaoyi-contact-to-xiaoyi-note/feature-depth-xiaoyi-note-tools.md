---
name: feature-depth-xiaoyi-note-tools
description: create_note / search_notes / modify_note 实现深读：search_notes 完整执行路径、modify_note 需先取 entityId、固定 payload 字面量、ToolInputError 与 RuntimeError 分层、None 与 {} 返回值相同、27 工具装配测试
metadata:
  scope: 只收 create_note / search_notes / modify_note 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-note-tools
---
# 小艺备忘录工具 (create_note / search_notes / modify_note)：实现深读

## 现状

- [[feature-xiaoyi-note-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **search_notes 的完整执行路径：参数校验、构造 intent 命令、等待设备响应并包装返回** search_notes(query) 先检查 query 为非空字符串并 strip 后非空，否则抛 ToolInputError；随后构造 namespace=Common/name=Action、intentName=SearchNote、bundleName=com.huawei.hmos.notepad 的命令，await execute_device_command("SearchNote", command) 取 outputs；
  - 非 dict 时包为 {"outputs": outputs}，经 raise_if_device_error 检查后从 result.items 统计条数 n，返回 format_success_response(dict(outputs), f"搜索到 {n} 条备忘录")。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L107–L173](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L107-L173)
- **三个异步工具的契约：字符串入参、非空 guard、Dict 返回，modify_note 需先经 search_notes 取 entityId** create_note(title, content)、search_notes(query)、modify_note(entity_id, text) 均为 async 函数返回 Dict[str, Any]；每个参数都要求非空字符串（仅 search_notes 额外 strip，空白串抛 ToolInputError("query 不能为空")）。
  - modify_note 的描述声明 entityId 必须先从 search_notes 获取，且设备侧字段名为 entityId。成功时返回经 format_success_response 包装的完整 outputs。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L176–L204](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L176-L204),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L35–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L35-L51)
- **命令 payload 的固定字面量：executeMode=background、achieveType=INTENT、executeParam 内 timeOut=5** 三个工具的命令均为硬编码：executeParam 含 executeMode="background"、achieveType="INTENT"、needUnlock=True、actionResponse=True、timeOut=5，bundleName="com.huawei.hmos.notepad"；
  - payload 层（非 executeParam）固定 needUploadResult=True、noHalfPage=False、pageControlRelated=False。create/search 的 executeParam 不含 appType、permissionId，modify_note 则含 appType="OHOS_APP" 和 permissionId=[]。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L53–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L53-L80),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L211–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L211-L233)
- **输入错误原样抛出 ToolInputError，其余异常包装为 RuntimeError，设备错误码触发 RuntimeError** 三个工具中 except ToolInputError: raise 保持输入错误不变（其 status=400，文档称框架会返回 HTTP 400）；其他任何 Exception 被记录日志并 raise RuntimeError（如 f"创建备忘录失败: {str(e)}"）from e。
  - raise_if_device_error 在 outputs 为 dict 且 code 检查不过或 retErrCode 非 "0" 时抛 RuntimeError(f"{what_failed}: {err_msg} …")。注意 create/modify 的非空 guard 接受纯空白字符串（仅 search_notes strip）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L93–L97](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L93-L97),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L210–L228](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L210-L228),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L46-L55)
- **create_note 委托 execute_device_command，后者在无 channel 或 last_session_id 为空时抛 RuntimeError** create_note 通过共享的 execute_device_command("CreateNote", command) 下发命令（note_tools.py:18–23 导入该助手）；
  - 该助手在 get_runtime_xiaoyi_channel() 返回 None，或 config 中 channels.xiaoyi.last_session_id 为空（含取配置异常后的空串）时抛出 RuntimeError，提示只能在活跃会话中使用。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L15–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L15-L23),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L82–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L82-L87),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L80–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L80-L104)
- **共享执行管线用显式 None 检查代替 or 短路：成功空 outputs 保留为 {}，但 None 与 {} 返回值相同** 设计推断（非作者历史意图）：
- execute_device_command 在 error_result 非空时先抛出，随后用 `{} if result_data is None else result_data` 返回，注释说明空 dict 为假、勿用 or 短路。收益（推断）：设备成功但 outputs 为空 dict 时不会被误替换；代价（推断）：此处返回的 {} 既可能是真实空结果也可能是 result_data 为 None，调用方无法区分。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L184–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L184-L196),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L82–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L82-L87)
- **assembly 测试断言 27 个工具（含三个备忘录工具）仅在 phone_tools_enabled 开启时构建** tests/agents/swarm/test_swarm_assembly.py:1872 的 test_xiaoyi_phone_tools_gated_by_config 调用实际构建器 _build_xiaoyi_phone_tools，断言 channels.xiaoyi.phone_tools_enabled=True 时返回 27 个工具、config 为空时返回 []。
  - 生产元组 _XIAOYI_PHONE_TOOLS 显式包含 create_note/search_notes/modify_note。测试只断言聚合数量与门控，不校验单个工具身份或设备侧行为；本条为已有测试条目，此处未执行。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-note-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L107-L173
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L176-L204
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L35-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L53-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L211-L233
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L93-L97
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L210-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L15-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L82-L87
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L80-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L184-L196；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-note-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py
