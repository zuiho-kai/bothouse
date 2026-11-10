---
name: feature-depth-multimodal
description: 多模态实现深读：strict 开关与三级回退、环境变量作为配置介质、GEMINI_API_KEY 本地文件路径与错误串、generate_visual 契约、_RetryExecutor 重试、运行时输出断言
metadata:
  scope: 只收视觉与媒体工具的配置回退、Gemini 调用与重试的实现细节；功能概览归 feature-multimodal
---
# 多模态理解与媒体配置：实现深读

## 现状

- [[feature-multimodal]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **strict 开关与三级回退优先级** models.{model_type}.model_config 的 strict 默认为 False（_parse_bool(mc.get("strict"), default=False)）。非 strict 时按 embed.embed_api_key/embed_api_base、embed 模型名、环境变量 API_KEY/API_BASE/MODEL_NAME/MODEL_PROVIDER 逐项回退；strict 时跳过全部回退。
  - 视频类型额外将 strict 写为环境变量 VIDEO_UNDERSTANDING_STRICT="1"，且 config_base 非 dict 时会 pop 该变量。运行时 _get_vision_api_credentials 中 VISION_MODEL_NAME 缺省为 "gpt-4o"。
- 来源：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L233–L282](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L233-L282),
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L185–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L185-L230),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L89–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L89-L93)
- **以环境变量作为配置传递介质（推断）** 设计推断（非作者历史意图）：
- 推断：apply_vision_model_config_from_yaml 把 YAML 配置落到 VISION_API_KEY 等进程级环境变量，视觉工具经 _get_vision_api_credentials 读取。收益是配置装配与工具运行时解耦（工具无需持有 config 字典）；代价是引入进程全局可变状态，同一进程内多个配置来源互相覆盖，且 VISION_MODEL_NAME 之类缺省值只在消费端可见。
- 来源：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L185–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L185-L230),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L89–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L89-L93)
- **GEMINI_API_KEY 已设置时的 Gemini VQA 本地文件执行路径** `_invoke_gemini_vision` 在 GEMINI_API_KEY 已设置时把本地文件字节读成 `types.Part`（HTTP 来源最多尝试 4 次，延时 5/15/60 秒），调用 `gemini-2.5-pro` 成功后返回 `resp.text`。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L167–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L167-L233)
- **generate_visual：async 契约，凭据缺失或空 prompt 时返回错误串而非抛异常** async 工具 generate_visual(prompt, aspect_ratio="16:9", resolution="512", save_dir=None) -> str；凭据不全或 prompt 去空白后为空时返回 "[ERROR]" 开头的错误串而不抛异常；检测到后端时直接 return await gen_toolkits.generate_image(...)。
- 来源：[jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py:L105–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py#L105-L132),
  - [jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py:L136–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py#L136-L139)
- **image_tools 视觉运行时耦合 openai/genai SDK 与 _RetryExecutor(max_tries=3)，配置函数导入自共享 multimodal_config** `_call` 以 `OpenAI(api_key,base_url)` 调 `chat.completions.create`（空 content 抛异常），并经 `_RetryExecutor.with_backoff(max_tries=3)` 执行；Gemini 分支以 `genai.Client` 调 `gemini-2.5-pro`；
  - 模块并从共享 multimodal_config 导入 apply_image/apply_vision/_get_model_config。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L15–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L15-L25),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L150–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L150-L161),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L210–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L210-L214)
- **GEMINI_API_KEY 为空本地返回精确错误串；503/429/500/空文本类异常重试，retries>max_r 时终止返回错误** GEMINI_API_KEY 未设置或为空时 `_invoke_gemini_vision` 守卫直接返回 "[ERROR]: GEMINI_API_KEY is not configured for Gemini vision."；
  - 异常串含 503/429/500/"Response text is None or empty" 时重试并 sleep，retries>max_r 返回 "[ERROR]: Gemini Error after {retries} retries: {e}"。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L167–L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L167-L171),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L218–L224](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L218-L224),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L225–L231](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L225-L231)
- **test_generate_visual_no_images_returned_error 的运行时精确输出断言（本次未执行该测试）** 该 pytest.mark.asyncio 用例以 `_patch_async_client` 注入 200 响应（choices content="I cannot generate that image."），
  - 断言 `await generate_visual(prompt="a cat")` 精确等于 "[ERROR]: no images returned. Model response: I cannot generate that image."。
- 来源：[tests/unit_tests/agents/test_visual_gen_tools.py:L330–L343](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_visual_gen_tools.py#L330-L343)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-multimodal.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L233-L282；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L185-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L89-L93；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L167-L233
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L15-L25；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L150-L161
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L210-L214；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L167-L171
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L218-L224；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L225-L231
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_visual_gen_tools.py:L330-L343；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py:L105-L132
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py:L136-L139
- 源页字段（feature）：multimodal
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/multimodal_config.py；jiuwenswarm/agents/harness/common/tools/image_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/multimodal_config.py；jiuwenswarm/agents/harness/common/tools/image_tools.py；jiuwenswarm/agents/harness/common/tools/*
