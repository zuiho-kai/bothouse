---
name: feature-xiaoyi-note-tools
description: 小艺备忘录工具 create_note / search_notes / modify_note 概览：三个异步工具接口、参数校验与设备命令组装、固定 payload 参数、调用纪律与追加式修改取舍（note_tools.py）
metadata:
  scope: 只收 create_note / search_notes / modify_note 的功能概览；调用链、异常分支与测试等实现细节归 feature-depth-xiaoyi-note-tools
---
# 小艺备忘录工具（create_note / search_notes / modify_note）

## 现状

- **公开接口：三个异步备忘录工具**
- 模块导出三个用 `@tool` 装饰的异步函数：`create_note(title: str, content: str)`、`search_notes(query: str)` 和 `modify_note(entity_id: str, text: str)`，均返回 `Dict[str, Any]`。参数校验失败时抛出 `ToolInputError`（如缺少 title/query/entity_id），其余异常统一包装为带中文上下文的 `RuntimeError`（如“创建备忘录失败: …”），且 `ToolInputError` 原样上抛不包装。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L26–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L26-L51),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L93–L97](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L93-L97)
- **职责边界：参数校验 + 组装设备命令 + 结果包装**
- 每个工具校验输入后组装一个 `header(namespace=Common, name=Action)` + `payload.executeParam` 的命令字典，通过共享的 `execute_device_command` 下发到设备，再用 `raise_if_device_error` 检查错误、`format_success_response` 包装设备完整 outputs 返回。工具本身不处理设备通信细节，边界清晰依赖 `utils` 模块的四个辅助件。
  - 三个命令分别对应 intentName `CreateNote` / `SearchNote` / `ModifyNote`，bundle 均为 `com.huawei.hmos.notepad`。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L15–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L15-L23),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L54–L91](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L54-L91)
- **命令载荷中的固定参数**
- 三个工具组装的设备命令中，除来自函数参数的 title/content/query/text/entityId 外，其余字段为固定值：executeMode="background"、needUnlock=True、actionResponse=True、timeOut=5、achieveType="INTENT"、bundleName="com.huawei.hmos.notepad"，header 固定为 namespace="Common"、name="Action"，没有外部配置入口或环境变量覆盖。
  - create_note 与 search_notes 的 executeParam 不含 appType、permissionId 且带 dimension=""，而 modify_note 不含 dimension，但额外带 appType="OHOS_APP"、permissionId=[] 与 contentType="1"。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L53–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L53-L80),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L126–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L126-L152),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L206–L234](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L206-L234)
- **支持的备忘录行为与调用纪律**
- create_note 需要必填的 title 与 content 创建备忘录；search_notes 接受关键词 query（去除首尾空白后不得为空）检索备忘录的标题、内容和附件名称，成功时统计设备 outputs 中 result.items 的条数并写入日志与提示语，返回包装后的完整 outputs。modify_note 为追加模式：必须先用 search_notes 取得备忘录的 entityId，再把 text 追加到该备忘录。三个工具的描述均约定操作超时时间 60 秒、失败最多重试一次、不可重复调用。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L100–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L100-L124),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L161–L167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L161-L167),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L176–L193](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L176-L193)
- **设计取舍：共享执行管线与追加式修改**
- 三个工具复用同一执行管线：本地校验参数后组装命令字典，交给共享的 execute_device_command 下发，再统一用 raise_if_device_error 检查、format_success_response 包装返回；工具本身不实现设备通信，异常时除 ToolInputError 原样上抛外，其余异常经 logger.error 记录后包装为带中文上下文的 RuntimeError。
  - 取舍上，modify_note 选择追加模式而非任意编辑：调用方必须先经 search_notes 取得 entityId 才能定位目标备忘录，intentParam 仅携带 contentType/text/entityId 三个字段，简化了修改语义但限制了只能追加文本。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L18–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L18-L23),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L179–L193](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L179-L193),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L221–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L221-L225),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L236–L251](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L236-L251)
- **验证：运行时校验与日志观测点**
- 所示代码中的验证是运行时输入校验：三个工具在组装命令前检查必填参数的存在与字符串类型，缺失即抛 ToolInputError（search_notes 还对 query 做 strip 后非空检查），该异常被 except 子句直接重新抛出、不包装。设备侧结果由 raise_if_device_error 统一判定错误。日志观测点：成功路径记录 create 完成、search 的 result.items 条数统计、modify 成功；失败路径仅在非 ToolInputError 异常分支用 logger.error 记录后再抛 RuntimeError。
  - 本片段未展示测试文件，无法据此判断测试覆盖情况。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L119–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L119-L124),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L161–L167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L161-L167),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L243–L251](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L243-L251)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-note-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L26-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L93-L97
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L15-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L54-L91
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L53-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L126-L152
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L206-L234
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L100-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L161-L167
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L176-L193
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L18-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L179-L193
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L221-L225
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L236-L251
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L119-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py:L243-L251
- 源页字段（feature）：xiaoyi-note-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py
