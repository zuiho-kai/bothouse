---
name: feature-depth-xiaoyi-collection-tools
description: 收藏工具实现深读：add_collection 校验与本地文件上传、delete_collection 的 item_ids 归一化、ToolInputError 与 RuntimeError 分工、非 dict 输出包装、file_upload_url / api_key / uid 配置、装配门控测试
metadata:
  scope: 收 xiaoyi_collection_tool.py 的实现级事实，来源另含 test_swarm_assembly.py、tools.py；收藏工具的命令组装、行为、入口契约与验证现状概览归 feature-xiaoyi-collection-tools
---
# 小艺收藏/个人知识库工具 (query/add/delete_collection)：实现深读

## 现状

- [[feature-xiaoyi-collection-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **add_collection 校验入参后可先上传本地文件再下发 AddCollection 指令** add_collection 先校验 dataType ∈ {HYPER_LINK,TEXT,IMAGE,FILE} 及对应必填字段；
  - 若 uri 不以 http://、https://、file:// 开头，则读取 channels.xiaoyi 配置上传换公网 URL，随后组装 executeMode=background、intentName=AddCollection 的 command，经 execute_device_command 执行，输出 dict 包成 content[0].text 的 JSON 字符串返回。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293–L373](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L293-L373),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L377–L384](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L377-L384)
- **delete_collection 接受数组或 JSON 数组字符串的 item_ids，返回 content[0].text JSON** delete_collection(item_ids: Union[str, List[str]]) 经 _normalize_item_ids 归一（None/非数组 JSON/其他类型抛 ToolInputError，空数组也抛 ToolInputError），成功时返回 {"content":[{"type":"text","text": json.dumps(outputs)}]；调用方需提供非空 itemId 合集。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L165–L231](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L165-L231),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L126–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L126-L146)
- **输入错误抛 ToolInputError 原样上抛，其余异常统一包成 RuntimeError** delete_collection/add_collection 中 ToolInputError 被原样 re-raise（如 itemIds 为空、dataType 非法或对应字段缺失）；任何其他 Exception 记录 error 日志后抛 RuntimeError("删除/添加小艺收藏失败: …") from e；设备返回的错误由 raise_if_device_error 以同样中文消息检查。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L217–L237](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L217-L237),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293–L303](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L293-L303),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L386–L390](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L386-L390)
- **非 dict 输出兜底包一层 outputs，换取统一返回形状** 设计推断（非作者历史意图）：
- 收益：execute_device_command 返回非 dict 时包成 {"outputs": …}，使后续 raise_if_device_error 与 JSON 序列化总有统一形状（推断：调用方解析逻辑因此更简单）。代价：原始标量输出被多包一层嵌套，调用方需知晓这一隐式包装约定（推断自 217-218、370-371 行的兜底分支）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L215–L231](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L215-L231)
- **本地路径上传分支内读取 channels.xiaoyi 三项配置（uri 非空且无远程前缀）** 在 add_collection 中，仅当 uri 为真值且不以 http://、https://、file:// 开头时，才惰性调用 get_config() 读取 channels.xiaoyi 下的 file_upload_url、api_key、uid。缺失 file_upload_url 或 api_key 时抛出 RuntimeError；uid 先经 str() 转换，缺失时变为字符串 "None" 仍为真值，不触发该报错。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L310–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L310-L330)
- **共享 .utils 与模块级导入的 file_upload_helpers、分支内导入的 aiohttp/get_config** 模块顶层从 .utils 导入 execute_device_command、raise_if_device_error、ToolInputError，并从 .file_upload_helpers 导入 XiaoyiObsUploadConfig 和 upload_local_file_public_url（L19–L24）；
  - delete_collection 通过 execute_device_command("DeleteCollection", ...) 执行并用 raise_if_device_error 检查（L215–L220）。仅 aiohttp 与 get_config 在本地文件分支内延迟导入（L314–L315），随后用 aiohttp.ClientSession 调用上传助手，返回为空则抛 RuntimeError（L325–L330）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L19–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L19-L24),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L215–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L215-L220),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L313–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L313-L330)
- **既有 swarm 装配测试覆盖配置门控下的构建数量，未覆盖工具行为** 既有测试 test_xiaoyi_phone_tools_gated_by_config 执行实际的 _build_xiaoyi_phone_tools：channels.xiaoyi.phone_tools_enabled 为 True 时断言返回 27 个工具，config 为空（默认 False）时断言返回空列表。生产元组 _XIAOYI_PHONE_TOOLS 显式包含 query_collection、add_collection、delete_collection。
  - 该断言只验证聚合数量与门控默认值，不校验单个工具身份、intent 组装或设备结果；属配置门控辅助函数级别的 helper 单元验证。本次 NOT EXECUTED，未运行该测试。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L141–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L141-L143),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-collection-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293-L373
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L377-L384
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L165-L231
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L126-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L217-L237
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293-L303
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L386-L390
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L215-L231
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L310-L330
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L19-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L215-L220
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L313-L330；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L141-L143；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-collection-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py
