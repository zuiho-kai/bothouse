---
name: feature-depth-models
description: 模型平台实现深读：probe_model_connection 的 (3,16) token 档位与超时、ModelCatalog 快照与 get_model 查找、save_models_candidate 先校验后写配置、小 token 预算取舍及探测与目录脱敏单测
metadata:
  scope: 只收模型目录与连接探测的实现层深读条目；功能概览归 feature-models
---
# 模型平台与 API 配置：实现深读

## 现状

- [[feature-models]]（功能概览） · [[common-core-overview]]（owner 入口）
- **连接探测的默认 token 档位与外部超时** probe_model_connection 默认 token_limits=(3, 16)，即先用 3 个输出 token 探测，失败后升到 16 重试一次；timeout_seconds 默认 None（不外加超时），传入时对每次完整调用单独计时，即使模型客户端自身忽略超时设置也能被截止。
- 来源：[jiuwenswarm/common/model_config_validation.py:L70–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L70-L119)
- **小 token 预算多档重试（推断）** 设计推断（非作者历史意图）：
- 推断：探测默认用 (3, 16) 两档极小 max_tokens，收益是探测请求便宜且快速；代价是推理模型可能把预算全花在 reasoning_content 上导致误判失败，代码因此同时接受 reasoning_content 非空或 usage_metadata.output_tokens>0 作为成功证据，并以第二档预算兜底。
- 来源：[jiuwenswarm/common/model_config_validation.py:L30–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L30-L67),
  - [jiuwenswarm/common/model_config_validation.py:L70–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L70-L86)
- **探测与目录脱敏的单元测试入口** tests/unit_tests/common/test_model_config_validation.py 中的 test_probe_model_connection_retries_with_supremum_tokens 验证失败后按 (3,16) 重试并透传 invoke_kwargs；..._enforces_invocation_deadline 验证 timeout_seconds 截止挂起的调用。
  - tests/unit_tests/runtime/test_model_catalog.py 的 test_catalog_output_is_credential_and_endpoint_free 断言目录序列化结果不含 api_key、api_base、custom_headers 等敏感字段。
- 来源：[tests/unit_tests/common/test_model_config_validation.py:L64–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_model_config_validation.py#L64-L86),
  - [tests/unit_tests/common/test_model_config_validation.py:L116–L128](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_model_config_validation.py#L116-L128),
  - [tests/unit_tests/runtime/test_model_catalog.py:L72–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_model_catalog.py#L72-L81)
- **ModelCatalog 构建快照后按 model_id 查找** __init__ 把 load_models_config(config if config is not None else get_config()) 存入 self.snapshot；load_models_config 深拷贝配置、解密 defaults、并入 agentos，并把非空 model_id 索引进 by_id。
  - 随后 get_model 命中 snapshot["by_id"] 即返回，未命中 raise ModelSelectionError(MODEL_SELECTION_NOT_FOUND, f"unknown model_id {model_id!r}")。
- 来源：[jiuwenswarm/common/model_catalog.py:L80–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L80-L89),
  - [jiuwenswarm/common/config.py:L1593–L1606](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1593-L1606)
- **save_models_candidate 依赖 raise_if_invalid 前置校验后才写配置** save_models_candidate 先 deepcopy 并 _ensure_model_business_ids，再函数内从 jiuwenswarm.common.model_config_validation 导入 raise_if_invalid，校验通过后才 update_config 替换 models 段；无效时抛 ModelSelectionError(MODEL_GROUP_INVALID, 以"; "连接的错误)，update_config 不会执行。
- 来源：[jiuwenswarm/common/config.py:L1609–L1620](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1609-L1620),
  - [jiuwenswarm/common/model_config_validation.py:L275–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L275-L278)
- **probe_model_connection：空 token_limits 直接 ValueError；无输出按档重试、仅末档重抛** token_limits 为空时 raise ValueError("token_limits must contain at least one value")。docstring 界定无 content、reasoning 或生成 token 用量的响应算失败尝试；
  - _model_probe_output 判无输出即 raise ValueError("Empty response from model")，异常被逐次捕获，仅当 attempt + 1 >= len(limits) 才重抛，否则换下一档 max_tokens 重试并记 INFO 日志。
- 来源：[jiuwenswarm/common/model_config_validation.py:L70–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L70-L89),
  - [jiuwenswarm/common/model_config_validation.py:L103–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L103-L117)
- **get_model 命中返回 by_id 索引记录，未命中抛 ModelSelectionError 且方法内不捕获** ModelCatalog(config=None) 缺省用 get_config()，初始化调用 load_models_config 生成解密且不改写持久化配置的 snapshot。
  - get_model(model_id) 查 snapshot["by_id"]，命中返回 {"source","entry"} 记录（来自 defaults 或 agentos 的非空 model_id），未命中抛 ModelSelectionError(MODEL_SELECTION_NOT_FOUND)，方法内不捕获、异常继续向上传播，此处不规定调用方义务。
- 来源：[jiuwenswarm/common/model_catalog.py:L11–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L11-L13),
  - [jiuwenswarm/common/model_catalog.py:L80–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L80-L89),
  - [jiuwenswarm/common/config.py:L1593–L1606](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1593-L1606)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/feature-depth-models.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py:L70-L119；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py:L30-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py:L70-L86；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_model_config_validation.py:L64-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_model_config_validation.py:L116-L128；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_model_catalog.py:L72-L81
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L1609-L1620；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py:L275-L278
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_catalog.py:L80-L89；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L1593-L1606
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py:L70-L89；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py:L103-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_catalog.py:L11-L13
- 源页字段（feature）：models
- 入口（entry_points）：jiuwenswarm/common/model_catalog.py；jiuwenswarm/common/model_config_validation.py
- 源页字段（source_globs）：jiuwenswarm/common/model_catalog.py；jiuwenswarm/common/model_config_validation.py；jiuwenswarm/common/model*.py
