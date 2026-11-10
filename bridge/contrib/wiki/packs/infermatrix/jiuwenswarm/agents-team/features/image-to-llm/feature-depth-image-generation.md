---
name: feature-depth-image-generation
description: generate_image 实现深读：调用链到 _invoke_model_image_generation 与落盘、返回契约、image_gen 配置默认值（wanx-v1、DashScope）、IMAGE_GEN_* 环境变量镜像、错误分支与工厂门控单测
metadata:
  scope: 收 image_tools.py 与 multimodal_config.py 的实现级事实，来源另含 test_multimodal_config.py、test_swarm_assembly.py；职责、配置入口与取舍的概览归 feature-image-generation
---
# 图片生成与产物落盘：实现深读

## 现状

- [[feature-image-generation]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **生图调用链：generate_image 到配置读取与落盘** generate_image 接收 prompt（如 "一只猫"），先尝试从 config.yaml 应用环境变量配置，随后在 L477 直接调用 _invoke_model_image_generation；后者在 L339-340 调用 get_config() 并把结果传给 multimodal_config._get_model_config 读取 models.image_gen 模型配置（api_key/api_base/model）。
  - 拿到结果后在 L392-395 用 get_agent_workspace_dir() 加时间戳与随机后缀生成输出路径，把 base64 或下载的 URL 图片写入该 .png 文件，返回包含 image_path 的 dict，最终 generate_image 返回带保存路径的多行字符串。
- 调用路径：`jiuwenswarm/agents/harness/common/tools/image_tools.py`（`generate_image`） → `jiuwenswarm/agents/harness/common/tools/image_tools.py`（`_invoke_model_image_generation`） → `jiuwenswarm/agents/harness/common/tools/multimodal_config.py`（`_get_model_config`）
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L474–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L474-L477),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L335–L350](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L335-L350),
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L39–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L39-L49),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L390–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L390-L415)
- **generate_image 的输入输出契约** generate_image(prompt: str, size="1024x1024", quality="standard", save_dir=None) -> str：成功时返回多行字符串（含 Saved to 路径、Prompt，可选 Revised prompt 与 Original URL）；结果 dict 含 "error" 键时直接原样返回错误字符串而非抛异常。调用方若指定 save_dir，需容忍该目录被 mkdir(parents=True) 创建，文件会 rename 到该目录下。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L450–L467](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L450-L467),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L479–L505](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L479-L505)
- **image_gen 优先读 models.image_gen 配置，api_base/model/provider 缺省为 dashscope 地址、wanx-v1、DashScope** api_base 缺省 https://dashscope.aliyuncs.com/api/v1，model 缺省 wanx-v1；provider 为 DashScope 时改写为 OpenAI 并补 endpoint_profile=dashscope；apply_image_gen_model_config_from_yaml 仅把非空值镜像到 IMAGE_GEN_* 环境变量。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L340–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L340-L360),
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L285–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L285-L314)
- **generate_image 依赖 get_config→apply_image_gen_model_config_from_yaml（值非空才写 IMAGE_GEN_*）与 openjiuwen Model 函数内延迟导入** generate_image 函数内导入 get_config，先执行 apply_image_gen_model_config_from_yaml(get_config())；
  - 后者经 _get_model_config(config_base, "image_gen") 取值，仅在字段非空时写入 IMAGE_GEN_API_KEY/API_BASE/MODEL_NAME/PROVIDER 环境变量；_invoke_model_image_generation 在函数体内延迟导入 openjiuwen 的 Model/ModelClientConfig。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L323–L335](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L323-L335),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L468–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L468-L477),
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L300–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L300-L314),
  - [jiuwenswarm/common/config.py:L237–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L237-L244)
- **apply_image_gen_model_config_from_yaml 仅在取出的值非空时覆盖 IMAGE_GEN_*，配置留空不会清掉进程内旧值** 设计推断（非作者历史意图）：
- mc 来自 _get_model_config：models 为 dict 或 list 块两种形式均可，inner 取 model_config 或 model_client_config，model_name 还可回退 model 键；strip 后仅非空值写入对应环境变量。收益：字段缺省不覆盖进程内已有值；代价：从配置删字段也无法清除残留旧值（推断）。
- 来源：[jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L42–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L42-L60),
  - [jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L300–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/multimodal_config.py#L300-L314)
- **缺 key/无有效图片数据/try 内 Exception 时 helper 返回 error 字典，generate_image 直接返回该错误字符串** api_key 为空（config 与 IMAGE_GEN_API_KEY/API_KEY 均未提供）时，_invoke_model_image_generation 在 try 之前返回 error 字典；
  - try 内响应无有效图片数据返回 "[ERROR]: No valid image data in response"，普通 Exception 捕获为 "[ERROR]: Image generation failed: {ex}"，base64 解码、URL 下载与首次写盘均在该 try 内。generate_image 检测 result 的 error 键后直接把该字符串作为返回值；入口处 save_dir 的 mkdir/rename 不在此 try 范围内。
- 来源：[jiuwenswarm/agents/harness/common/tools/image_tools.py:L323–L439](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L323-L439),
  - [jiuwenswarm/agents/harness/common/tools/image_tools.py:L450–L505](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/image_tools.py#L450-L505)
- **image_gen 工具工厂 IMAGE_GEN_API_KEY 门控的已有 helper 单测** test_image_gen_tool_gated_by_env 构造 SwarmBuildContext(config={})，并把 apply_image_gen_model_config_from_yaml 桩为无操作：monkeypatch.delenv IMAGE_GEN_API_KEY 后断言 tools._build_image_gen_tools(ctx) == []，
  - setenv "k" 后断言 [tool.card.name for tool in built] == ["generate_image"]。断言仅覆盖工厂门控 helper，不触发模型调用或落盘；该测试本轮未执行。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1902–L1913](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1902-L1913),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L433–L438](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L433-L438),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L41–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L41-L45)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-image-generation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L474-L477；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L335-L350
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L39-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L390-L415
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L450-L467；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L479-L505
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L340-L360；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L285-L314
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/harness/test_multimodal_config.py:L26-L48；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L323-L335
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L468-L477；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L300-L314
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L237-L244；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/multimodal_config.py:L42-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L323-L439；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/image_tools.py:L450-L505
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1902-L1913；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L433-L438
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L41-L45
- 源页字段（feature）：image-generation
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/image_tools.py；jiuwenswarm/agents/harness/common/tools/multimodal_config.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/image_tools.py；jiuwenswarm/agents/harness/common/tools/multimodal_config.py
