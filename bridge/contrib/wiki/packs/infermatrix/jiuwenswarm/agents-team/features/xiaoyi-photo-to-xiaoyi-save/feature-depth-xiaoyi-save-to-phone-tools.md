---
name: feature-depth-xiaoyi-save-to-phone-tools
description: save_media_to_gallery / save_file_to_file_manager 实现深读：_get_obs_config 与 uid 缺失检查、三段式 OBS 上传（共享 aiohttp 会话）、全量读入内存的成本、SaveFileToFileManager 契约、RuntimeError 包装
metadata:
  scope: 只收 save_media_to_gallery / save_file_to_file_manager 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-save-to-phone-tools
---
# 小艺保存到手机工具 (save_media_to_gallery / save_file_to_file_manager)：实现深读

## 现状

- [[feature-xiaoyi-save-to-phone-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **_get_obs_config 读取 channels.xiaoyi 的 file_upload_url/api_key/uid，但 uid 经 str() 转换削弱了缺失检查** 从 get_config() 取 cfg["channels"]["xiaoyi"]，读取 file_upload_url、api_key、uid；三者传入非空检查，缺失时抛 ToolInputError("缺少 channels.xiaoyi 的 file_upload_url / api_key / uid 配置...")。
  - 但 uid 先执行 str(xc.get("uid")) 再判空：uid 为 None 时变成非空字符串 "None"、为 0 时变成 "0"，因此该检查实际只可靠拦截 file_upload_url 与 api_key 的缺失。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L43–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L43-L54)
- **Local paths depend on three-step OBS upload via shared aiohttp session** _ensure_public_url 对非 http(s) 路径调用 upload_local_file_public_url：POST prepare（sha256/size 元数据）→ 按 uploadInfos[0] 的 method/url 直传文件 → POST completeAndQuery 取 fileDetailInfo.url；
  - 上传与设备命令均经由调用方创建的 aiohttp.ClientSession 或 execute_device_command 通道完成。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L29–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L29-L40),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L36–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py#L36-L92)
- **非 ToolInputError 异常在工具层被包装为 RuntimeError 后抛出** 上传 helper 中显式分支失败（prepare/upload/completeAndQuery HTTP 非 ok、code!="0"、无 uploadInfos、fileDetailInfo.url 为空）各自 raise RuntimeError（file_upload_helpers.py L60–92）；
  - 工具函数里除 ToolInputError 原样上抛外，其余 Exception 记录日志并以 raise RuntimeError(...) from e 重新抛出（save_tools.py L273–277）。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L60–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py#L60-L92),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L273–L277](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L273-L277)
- **本地文件全量读入内存并经三次串行请求换公网 URL：实现简单但内存与延迟成本随文件增大** 设计推断（非作者历史意图）：
- （推断）收益：一次性 f.read() 使 sha256、fileSize 与上传体来自同一份内存内容，逻辑简单、无需流式分块。成本：整个文件驻留内存，且本地输入需顺序完成 prepare、文件传输、completeAndQuery 三次网络请求才拿到 URL，大文件时内存峰值与总延迟同时升高；http(s) 输入则完全跳过该路径。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L39–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py#L39-L43),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L60–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py#L60-L89),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L35–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L35-L40)
- **save_file_to_file_manager：校验入参后经 _ensure_public_url 换公网 URL 并下发 SaveFileToFileManager 命令** 在 save_file_to_file_manager 内，url/file_name/suffix 任一为空或非字符串时先抛 ToolInputError；随后 _get_obs_config 取配置，_ensure_public_url 对已是 http(s):// 的 url 原样返回，否则经 upload_local_file_public_url 上传，返回空则抛 RuntimeError。
  - 命令交给 execute_device_command("SaveFileToFileManager", command)，输出非 dict 时包成 {"outputs": outputs}，再经 raise_if_device_error 检查，成功后以 content[0].text 返回 json.dumps 的 outputs。注意 L51–L52 中 uid 经 str(xc.get("uid")) 转换，缺失时成为 "None" 字符串并通过非空检查，不触发 ToolInputError。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L187–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L187-L225),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L29–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L29-L54),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L249–L277](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L249-L277)
- **save_file_to_file_manager 契约：三个字符串必填参数，ToolInputError(status=400) 原样上抛，成功返回 content[0].text 为 JSON 字符串** 调用方须传非空字符串 url、file_name、suffix，任一不满足抛 ToolInputError（L203–L208）；该异常在兜底 except 中被原样 re-raise 不包装（L273–L274），其余异常记日志后包装为 RuntimeError 并链上原异常（L275–L277）。
  - ToolInputError 的 __init__ 设 self.status = 400；其 docstring 说明抛出后框架返回 HTTP 400 而非 500，属文档陈述。成功返回 {"content": [{"type": "text", "text": json.dumps(outputs, ensure_ascii=False)}]}。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L187–L208](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L187-L208),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L264–L277](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L264-L277),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L46-L55)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-save-to-phone-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L29-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L36-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L43-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L39-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L60-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L35-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py:L60-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L273-L277
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L187-L225
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L29-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L249-L277
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L187-L208
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py:L264-L277
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L46-L55
- 源页字段（feature）：xiaoyi-save-to-phone-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py
