---
name: feature-video-generation-tools
description: generate_video / check_video_status 视频生成工具概览：VIDEO_GEN_* 环境变量与后端选择、文生/图生视频与厂商后端、有界轮询（120s/300s）与扁平参数签名、错误路径
metadata:
  scope: 只收视频生成工具的功能概览（配置、支持行为、取舍、验证）；generate_video 默认分支流程、签名、失败字符串、单测等实现级细节归 feature-depth-video-generation-tools
---
# generate_video / check_video_status 提交后轮询的视频生成工具

## 现状

- **配置项与后端选择**
- 凭据只来自 "Video processing" 配置槽的三个环境变量：`VIDEO_GEN_API_KEY`、`VIDEO_GEN_API_BASE`、`VIDEO_GEN_MODEL_NAME`，无回退变量、无内置默认端点或模型，三者（check_video_status 仅前两者）非空才算已配置。`VIDEO_GEN_ENABLED` 是独立的开关门（"1"/"true"/"yes"/"on" 视为开启），与凭据是否完整互不影响。
  - 后端选择由 `VIDEO_GEN_PROTOCOL` 环境变量（detect_backend 的第一个参数指定其名字）或 API URL 主机名推断：minimax/modelark 域名命中即返回对应后端，否则 None 走 OpenRouter 路径。模块 docstring 还提到 VIDEO_GEN_PROVIDER 属于该配置槽，但代码中未见其被读取。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L14–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L14-L21),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L48–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L48-L79),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L258–L258](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L258-L258),
  - [jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L147–L162](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/gen_toolkits.py#L147-L162)
- **支持的行为与厂商后端**
- 支持文本生视频与可选首帧图（本地路径/URL/data: URI）的图生视频；generate_audio 开关仅在后端支持时生效（MiniMax H3 后端无音频开关，构造请求体时不传入该字段）。厂商后端各自做参数映射：MiniMax 把 resolution 映射为 "768P"/"2K"、ratio 不在集合内回退 "16:9"；ModelArk 分辨率不在 {480p,720p,1080p} 时回退 "720p"，有首帧时 ratio 用 "adaptive" 以跟随首帧比例，并传递 generate_audio 与 watermark=False。
  - 完成视频会下载为本地持久副本（远端 URL 限时失效）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L354–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/gen_toolkits.py#L354-L376),
  - [jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L622–L642](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/gen_toolkits.py#L622-L642),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L132–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L132-L143)
- **有界轮询与平面参数签名**
- 提交后同步轮询的预算以 sleep 时长累计（每轮 sleep 10s 后累加 10s），OpenRouter/MiniMax 路径为 120s、ModelArk 为 300s（依据是 5s Seedance 片段约需 2.5 分钟渲染）；预算只计入 sleep 时间，不含 HTTP 请求耗时，超时后返回 job_id 让 agent 改调 check_video_status，而不是无限阻塞。
  - docstring 记录了刻意保留平面参数签名而非 dataclass/BaseModel 的理由：CallableSchemaExtractor 会把 dataclass 参数压成无属性的 object schema，而 BaseModel 会改变调用约定，属行为变更。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L170–L174](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L170-L174),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L211–L222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L211-L222),
  - [jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L98–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/gen_toolkits.py#L98-L99),
  - [jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L77–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/gen_toolkits.py#L77-L77)
- **错误路径处理与作者自述的验证**
- 在展示的输入中没有可供引用的测试入口点。代码内可核的验证证据是：`_poll_job` 把非 200 轮询响应和非法 JSON 作为返回错误上报而非抛出（docstring 说明 RuntimeError/JSONDecodeError 不属于外层 `except httpx.HTTPError`，此前会让工具调用崩溃），并用调用方已知的提交响应作为种子以免已终止的 job 丢失 error 字段。
  - generate_video 的函数 docstring（非模块 docstring）自述曾直接对照 `CallableSchemaExtractor.get_type_schema` 验证过 dataclass 参数会坍缩为空 object schema——这是作者声明，未见配套测试。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L152–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L152-L169),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L175–L184](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L175-L184),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L208–L222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L208-L222)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-video-generation-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L14-L21；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L48-L79
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L258-L258；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L147-L162
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L354-L376；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L622-L642
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L132-L143；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L170-L174
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L211-L222；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L98-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/gen_toolkits.py:L77-L77；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L152-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L175-L184；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L208-L222
- 源页字段（feature）：video-generation-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/video_gen_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/video_gen_tools.py；jiuwenswarm/agents/harness/common/tools/gen_toolkits.py
