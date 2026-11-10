---
name: feature-depth-xiaoyi-photo-gallery-tools
description: search_photo_gallery / upload_photo 实现深读：upload_photo 下发 ImageUploadForClaw 并返回公网 URL 列表、search_photo_gallery 校验、executeMode 与 timeOut 硬编码、media_uris 兼容数组与 JSON 字符串、27 工具装配测试
metadata:
  scope: 只收 search_photo_gallery / upload_photo 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-photo-gallery-tools
---
# 小艺图库搜索与照片上传工具 (search_photo_gallery / upload_photo)：实现深读

## 现状

- [[feature-xiaoyi-photo-gallery-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **upload_photo 规范化入参后下发 ImageUploadForClaw 意令并返回解码后的公网 URL 列表** upload_photo 先调用 _normalize_media_uris 将 media_uris 规范为列表；非空、≤5 条且每项为非空字符串时，构造 intentName 为 ImageUploadForClaw 的命令并 await execute_device_command。
  - 返回的 result.imageUrls 中的非字符串项被跳过，字符串 URL 经 _decode_image_url_escapes 替换 \u003d/\u0026 后，以 {imageUrls, count, message} 的 JSON 文本 content 返回。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L173–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L173-L229),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L234–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L234-L275),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L154–L156](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L154-L156)
- **search_photo_gallery(query: str) 校验非空字符串并包装设备 outputs 返回** search_photo_gallery 接收单个 query 字符串，非字符串/为空/strip 后为空均抛 ToolInputError；设备 outputs 若非 dict 则包成 {"outputs": ...}，经 raise_if_device_error 检查后按 result.items 数量以 format_success_response 返回完整 outputs。调用方需传入有效会话下可用的描述语料。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L62–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L62-L130)
- **两工具命令硬编码 executeMode/timeOut，等待超时用 execute_device_command 默认 60 秒** 两个工具的 command 中 executeMode="background"、needUnlock=True、timeOut=5 均为硬编码；调用 execute_device_command 时未传 timeout，因此使用其签名默认 timeout=60.0 秒（文档注释称其为超时秒数）。所示片段不含覆盖该默认的配置项。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L88–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L88-L109),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L208–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L208-L229),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L58–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L58-L68)
- **依赖运行时 XiaoyiChannel 与 config 的 xiaoyi 会话标识** 两个工具都通过 execute_device_command 执行；该函数从 get_runtime_xiaoyi_channel() 取通道，若为 None 抛 RuntimeError（提示仅能在活跃会话中使用），否则从 config 的 channels.xiaoyi 读取 last_session_id/last_task_id（默认空字符串）。所示片段未展示这些标识后续如何使用。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L79–L97](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py#L79-L97),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L111–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L111-L116)
- **media_uris 兼容数组与 JSON 字符串带来灵活性，解析失败需调用方处理** 设计推断（非作者历史意图）：
- （推断）_normalize_media_uris 同时接受 list 与 JSON 数组字符串，方便不同调用形态；代价是字符串解析失败抛 ToolInputError 且超 5 条需分批，把重试/分批负担转移给调用方。5 条上限本身是文档与代码一致的事实，代价部分为推断。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L133–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L133-L151),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L192–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L192-L195)
- **upload_photo 输入校验失败抛 ToolInputError，其他异常包装为 RuntimeError（本地分支）** media_uris 为 None、非法 JSON 字符串、解析后非数组或类型不符时，_normalize_media_uris 抛 ToolInputError（含中文信息）；规范化后数组为空、超过 5 条或含非非空字符串项时同样抛 ToolInputError。
  - upload_photo 的本地 except 分支将 ToolInputError 原样上抛，其余 Exception 记录日志后包装为 RuntimeError("上传照片失败: …") from e。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L133–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L133-L151),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L189–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L189-L199),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L277–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L277-L281)
- **Swarm 组装测试在运行时执行 _build_xiaoyi_phone_tools 并断言开启时 27 个工具、关闭时为空** 现有测试 test_xiaoyi_phone_tools_gated_by_config 实际调用 tools._build_xiaoyi_phone_tools：config 含 channels.xiaoyi.phone_tools_enabled=True 时断言返回 27 个工具，config={}（默认 False）时断言返回 []。
  - 生产元组 _XIAOYI_PHONE_TOOLS 显式包含 search_photo_gallery 与 upload_photo，故两图库工具在该门控构建范围内；但断言仅针对聚合计数与空列表，不校验单个工具身份、传输行为或设备结果。测试在此次会话内未执行。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-photo-gallery-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L133-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L192-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L62-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L88-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L208-L229
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L58-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/utils.py:L79-L97
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L111-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L173-L229
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L234-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L154-L156
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L189-L199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L277-L281；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-photo-gallery-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py
