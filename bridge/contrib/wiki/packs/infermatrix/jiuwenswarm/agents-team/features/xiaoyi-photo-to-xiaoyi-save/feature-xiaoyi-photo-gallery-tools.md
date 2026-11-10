---
name: feature-xiaoyi-photo-gallery-tools
description: 小艺图库工具 search_photo_gallery / upload_photo 概览：公开入口与输入输出契约、设备指令转发与数据流、内嵌指令参数、能力边界与验证路径（photo_tools.py）
metadata:
  scope: 只收 search_photo_gallery / upload_photo 的功能概览；调用链、异常分支与测试等实现细节归 feature-depth-xiaoyi-photo-gallery-tools
---
# 小艺图库工具：search_photo_gallery / upload_photo (photo_tools.py)

## 现状

- **公开入口与输入输出契约**
- 两个 async 工具通过 `@tool` 装饰器注册。`search_photo_gallery(query: str)` 要求非空字符串 query，返回设备 outputs 经 `format_success_response` 包装的结果并附带命中数量消息。
  - `upload_photo(media_uris: Union[str, List[str]])` 接受 URI 数组或 JSON 数组字符串（空数组或超过 5 条抛 `ToolInputError`），成功时返回 `{content: [{type: "text", text: JSON}]}`，JSON 含 `imageUrls`、`count`、`message`。两者均把 `ToolInputError` 原样抛出、其余异常包装为 `RuntimeError`（含中文错误信息）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L62–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L62-L81),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L173–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L173-L195),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L263–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L263-L281)
- **设备指令转发与数据流**
- 两个工具都是设备指令的薄封装：构造 `Common/Action` 命令并通过共享的 `execute_device_command` 发给手机。搜索走 intent `SearchPhotoVideo`（bundle `com.huawei.hmos.aidispatchservice`），上传走 intent `ImageUploadForClaw`（bundle `com.huawei.hmos.vassistant`），均为 background 执行模式且 `needUnlock: True`。
  - 上传返回后从 `result.imageUrls` 提取 URL 并经 `_decode_image_url_escapes` 还原 `\u003d`/`\u0026` 转义（注释说明与 TypeScript 版 upload-photo-tool 的 getPhotoUrls 保持一致）。数据流是：搜索返回本地 mediaUri/thumbnailUri → 上传将其转为公网 URL。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L83–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L83-L116),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L203–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L203-L229),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L154–L156](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L154-L156)
- **内嵌指令参数**
- 模块没有用户可配置项；命令参数硬编码在函数体内：两次调用均设置 `executeMode: "background"`、`needUnlock: True`、`actionResponse: True`、`appType: "OHOS_APP"`、`timeOut: 5`、`achieveType: "INTENT"`、`needUploadResult: True`。工具描述声明面向调用方的操作超时为 60 秒且失败最多重试一次，但这属于提示词层面的约束，代码中并未实现重试逻辑。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L88–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L88-L108),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L56–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L56-L60)
- **支持的行为与能力边界**
- `search_photo_gallery(query)` 按自然语言描述检索手机本地（非云端）图库，返回照片的本地 `mediaUri`/`thumbnailUri`；工具描述要求优先使用 thumbnailUri 交给 `upload_photo` 换取公网 URL。描述声明支持口语化实体、相册名和人像（需人像 tag）检索；多实体/"或"逻辑及时间范围查询**必须**拆分成多次单实体查询（如"南京或上海"需分别查询），相对时间词（"最新""去年"）必须换算为具体年份，且需主动拆分并告知用户。
  - `upload_photo(media_uris)` 把 `file://` 本地 URI（数组或 JSON 数组字符串，每次最多 5 条）上传并返回 `imageUrls`/`count`/`message`。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L30–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L30-L48),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L56–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L56-L60),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L161–L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L161-L171)
- **验证路径**
- 本文件内的可验证逻辑是输入校验与响应构造：`search_photo_gallery` 对缺失/空白 query 抛 `ToolInputError`（L76–L81），`upload_photo` 对空数组、超 5 条、非字符串元素抛 `ToolInputError`（L189–L199）。错误契约方面，两工具均将 `ToolInputError` 原样上抛、其余异常包装为中文 `RuntimeError`（L126–L130、L277–L281）。
  - 成功路径上两者使用共享助手的程度不同：搜索调用 `execute_device_command` 后经 `raise_if_device_error` 与 `format_success_response` 返回（L111–L124）；上传仅调用 `execute_device_command`，自行从 `result.imageUrls` 构造 JSON text 响应，不经 `raise_if_device_error`/`format_success_response`（L229–L275）。所示输入中没有该模块的测试文件。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L111–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L111-L124),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L189–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L189-L199),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L229–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L229-L275),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L126–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L126-L130)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-photo-gallery-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L62-L81
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L173-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L263-L281
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L83-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L203-L229
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L154-L156
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L88-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L56-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L30-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L161-L171
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L111-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L189-L199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L229-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py:L126-L130
- 源页字段（feature）：xiaoyi-photo-gallery-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py
