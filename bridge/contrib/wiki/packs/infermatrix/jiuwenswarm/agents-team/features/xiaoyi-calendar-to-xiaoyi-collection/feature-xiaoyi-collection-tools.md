---
name: feature-xiaoyi-collection-tools
description: 小艺收藏工具概览：query_collection / add_collection / delete_collection、com.huawei.hmos.vassistant 意图命令、本地文件上传分支读取 channels.xiaoyi 配置、错误契约与验证现状
metadata:
  scope: 只收收藏工具的功能概览；add_collection 流程、item_ids 归一化、失败包装、依赖与装配测试等实现级细节归 feature-depth-xiaoyi-collection-tools
---
# 小艺收藏工具（query/add/delete_collection）

## 现状

- **设备 intent 命令的组装与执行流**
- 每个工具把入参规范化后组装成一个 HarmonyOS 助手 intent 命令：header 固定为 `namespace=Common, name=Action`，executeParam 固定 `bundleName=com.huawei.hmos.vassistant`、`executeMode=background`、`appType=OHOS_APP`、`timeOut=5`、`achieveType=INTENT`，
  - 差异只体现在 `intentName`（QueryCollection/DeleteCollection/AddCollection）和 `intentParam`。命令交给共享的 `execute_device_command` 执行，返回值用 `raise_if_device_error` 做错误判定，非 dict 输出被包成 `{'outputs': ...}`。add_collection 在组装命令前多一步：uri 不以 http/https/file:// 开头时视为本地路径，先经 `upload_local_file_public_url` 上传换取公网 URL。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L75–L106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L75-L106),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L310–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L310-L330),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L342–L373](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L342-L373)
- **支持的行为与依赖关系**
- query_collection 支持全量查询（queryAll="true"，默认）或按 query 语义检索，queryAll 不为 "true" 时 query 必填，否则抛 ToolInputError；返回条目描述了 linkTitle/description/label/linkUrl 字段，提示可用 linkUrl 抓取原文。add_collection 支持四种 dataType：HYPER_LINK/TEXT 要求 content，IMAGE/FILE 要求 uri，非法类型或缺失字段在客户端即被拒绝。
  - delete_collection 的 item_ids 接受数组或 JSON 数组字符串，经 `_normalize_item_ids` 规范化后为空则报错。依赖共享的 `execute_device_command`、`raise_if_device_error`、`ToolInputError`（来自 `.utils`）和 `file_upload_helpers` 的 OBS 上传。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L29–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L29-L34),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L126–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L126-L146),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293–L303](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L293-L303)
- **公开入口与错误契约**
- 三个 async 工具通过 `@tool` 装饰器注册：`query_collection(query_all="true", query=None)`、`delete_collection(item_ids)`、`add_collection(data_type, content, uri, source_app_bundle_name, title)`。输入校验失败时抛 `ToolInputError`（如 queryAll 不为 true 且无 query、dataType 非法或对应字段缺失、itemIds 无法解析为数组）。
  - 设备返回若非 dict 会被包成 `{"outputs": ...}` 再序列化为 `content[0].text`。任何未被校验拦截的异常（例如 uri 为非字符串时 `uri.startswith` 抛 AttributeError）都会被兜底 except 捕获，以 `RuntimeError` 并通过 `from e` 保留原始异常链后抛出。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L27–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L27-L48),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293–L303](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L293-L303),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L103–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L103-L117),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L386–L390](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L386-L390)
- **配置读取：仅本地文件上传路径触发**
- 配置仅在 `add_collection` 走本地文件上传分支（uri 不以 http://、https://、file:// 开头）时惰性读取：`get_config()` 下的 `channels.xiaoyi.file_upload_url`、`api_key`、`uid` 三项构成 `XiaoyiObsUploadConfig`。缺失 `file_upload_url` 或 `api_key` 会抛 RuntimeError；但 `uid` 先经 `str()` 转换再判断，缺失时变成字符串 "None" 而不会触发该报错。
  - 其余 intent 命令参数（如 timeOut=5、bundleName）为固定值，intentParam 内容由各工具入参派生。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L310–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L310-L330)
- **验证现状：无测试代码，仅运行时日志**
- 本文件内无测试代码；docstring 声明与 xy_channel 的 TypeScript 工具（xiaoyi-collection-tool.ts 等）行为对齐，属文档性声明而非可执行验证。运行时可观测性有限：delete 仅记录规范化后的条目数量、add 仅记录 dataType，成功日志不含 outputs 内容；`ToolInputError` 被直接重抛，不产生失败日志。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L49–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L49-L49),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L182–L185](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L182-L185),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L305–L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L305-L308),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L386–L387](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py#L386-L387)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-collection-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L75-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L310-L330
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L342-L373
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L29-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L126-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L293-L303
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L27-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L103-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L386-L390
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L49-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L182-L185
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L305-L308
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py:L386-L387
- 源页字段（feature）：xiaoyi-collection-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_collection_tool.py
