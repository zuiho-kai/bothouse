---
name: feature-depth-video-generation-tools
description: generate_video / check_video_status 实现深读：默认 /videos 提交与轮询流程、工具签名（16:9 / 480p / 15 秒）、凭证缺失与后端探测、check_video_status 后端分支、提交阶段四类 [ERROR]、扁平参数取舍、单测
metadata:
  scope: 收 video_gen_tools.py 的实现级事实，来源另含 test_video_gen_tools.py；视频生成的配置、厂商后端、取舍与验证概览归 feature-video-generation-tools
---
# generate_video / check_video_status Submit-then-Poll Video Generation：实现深读

## 现状

- [[feature-video-generation-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **generate_video 默认分支：提交 POST {api_base}/videos 后轮询，完成则下载** 先取凭证并校验 prompt（video_gen_tools.py:240-248）；detect_backend 无匹配时走默认 OpenRouter 风格分支：POST {api_base}/videos（287），非 200/201/202 即返回错误，否则取 job id 后经 _poll_job 轮询（301），completed 才调 _download_video（317），未到终态则返回含 job_id 的提示（306-310）。
- 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L240–L264](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L240-L264),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L285–L319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L285-L319)
- **generate_video 工具签名：扁平参数，默认 16:9 / 480p / 15 秒，返回 str** 签名为 prompt（必填 str）、aspect_ratio="16:9"、resolution="480p"、duration_seconds=15、first_frame_path=None、generate_audio=False、save_dir=None；返回文件路径字符串，或轮询窗口结束后仍运行时返回 job_id + 状态消息（docstring 236-238）。
- 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L199–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L199-L207),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L233–L238](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L233-L238)
- **凭证缺失时直接报错；后端由 VIDEO_GEN_PROTOCOL + api_base 探测分流** 凭证来自 _get_video_gen_api_credentials()，api_key/api_base/model 任一缺失即返回 "[ERROR]: video generation is not configured - set the Video processing API key, API URL, and model name..."（240-245）；
  - 随后 detect_backend("VIDEO_GEN_PROTOCOL", api_base) 命中时把请求转给 gen_toolkits.submit_video（258-264），否则走内置 /videos 协议。
- 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L240–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L240-L245),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L256–L264](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L256-L264)
- **check_video_status backend branch delegates to gen_toolkits.check_video before its default httpx client** When `backend` is truthy, check_video_status builds a gen_toolkits.GenerationTarget and returns `await gen_toolkits.check_video(target, job_id, save_dir)` at video_gen_tools.py:352-354,
  - so that branch never reaches the module's own httpx client.
  - The non-backend poll path instead constructs httpx.AsyncClient(timeout=30, verify=get_requests_verify()) (356-359), coupling its TLS verification to ssl_config.get_requests_verify; generate_video's submit uses the same verify helper with timeout=60 (285-287).
- 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L352–L359](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L352-L359),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L285–L287](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L285-L287),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L37–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L37-L39)
- **提交阶段四类失败均以 [ERROR] 字符串返回，不抛出** 非 200/201/202 → "[ERROR]: video generation submit failed: {status} {text}"（288-289）；JSON 解析失败 → "...invalid JSON: {exc!r}"（290-293）；缺 job id → "...returned no job id"（294-296）；
  - httpx.HTTPError 被 except 捕获 → "[ERROR]: video generation request failed: {exc!r}"（318-319）。
- 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L287–L297](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L287-L297),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L318–L319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L318-L319)
- **刻意保留扁平参数而非 BaseModel，换取 LLM 可见的工具 schema** 设计推断（非作者历史意图）：
- docstring 自述：CallableSchemaExtractor 对 dataclass 只生成无属性的 {"type":"object"}，BaseModel 虽可展开但会把顶层扁平参数改成嵌套对象、是对已验证工具的行为变更，故扁平签名是有意保留（211-222）。收益是模型能看到全部字段；成本是参数数量触发 pylint huawei-too-many-arguments 豁免（199）。此为基于 docstring 的推断。
- 来源：[jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L211–L222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L211-L222),
  - [jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L199–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L199-L199)
- **单测直接调用 vg.generate_video._func，经 mock httpx 传输断言错误字符串** 测试取 @tool 包装内的原始异步函数（test 文件 16-21），如 test_generate_video_http_error_during_submit_is_caught 断言 ConnectError 时返回以 "[ERROR]: video generation request failed:" 开头的字符串（339-349），400 提交断言完整错误串（276-278）。
- 来源：[tests/unit_tests/agents/test_video_gen_tools.py:L16–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_video_gen_tools.py#L16-L21),
  - [tests/unit_tests/agents/test_video_gen_tools.py:L339–L349](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_video_gen_tools.py#L339-L349),
  - [tests/unit_tests/agents/test_video_gen_tools.py:L276–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_video_gen_tools.py#L276-L278)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-video-generation-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L240-L264；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L285-L319
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L199-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L233-L238
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L240-L245；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L256-L264
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L287-L297；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L318-L319
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L211-L222；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L199-L199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_video_gen_tools.py:L16-L21；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_video_gen_tools.py:L339-L349
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_video_gen_tools.py:L276-L278；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L352-L359
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L285-L287；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/video_gen_tools.py:L37-L39
- 源页字段（feature）：video-generation-tools
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/video_gen_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/video_gen_tools.py；jiuwenswarm/agents/harness/common/tools/gen_toolkits.py
