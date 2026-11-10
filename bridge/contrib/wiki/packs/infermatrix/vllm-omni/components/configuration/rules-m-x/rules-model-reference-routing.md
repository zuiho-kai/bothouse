---
name: rules-model-reference-routing
description: "规则 CONF-7a：对象存储模型引用（s3://、gs://、is_runai_obj_uri）把轻量文件物化到 model_streamer/<hash> 后读取 HF 配置与 model_index.json，name-based fallback 只比较末个路径组件；#6624 的 HF-cache snapshot repo-name recovery 已被 #6642 revert，不是当前合同"
metadata:
  scope: 只收模型引用解析与 pipeline 名称匹配一条规则（CONF-7a）及其代码入口；checkpoint 身份与架构路由（CONF-3d）归 configuration-rules-3
---
# 模型引用路由规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-model-reference-routing.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：vllm_omni/config/config_factory.py；vllm_omni/config/pipeline_registry.py；tests/config/test_config_factory.py；PR #5036；PR #6624；PR #6642

### Direct 代码快速入口

- [CONF-7a] **CONF-7a — 模型引用解析。** 从 `config_factory.py::{_materialize_object_storage_configs,_name_match_candidate,StageConfigFactory._try_infer_model_type}` 直达 `pipeline_registry.py::OMNI_PIPELINES`；当前 name-fallback 的回归入口是 `tests/config/test_config_factory.py::TestObjectStorageConfigResolution`。
- [CONF-7a] 模型引用解析必须物化对象存储配置，并只从受控名称组件匹配
  - 触发：父进程在 stage-specific `ModelConfig` 初始化前，需要从 `s3://`、`gs://` 或上游 `is_runai_obj_uri` 支持的对象存储 URI 推断模型类型、读取 HF 配置或解析 `model_index.json`。
  - 强制：通过 `is_runai_obj_uri` 将对象存储模型的 `*.model`、`*.py`、`*.json` 轻量文件按 URI 缓存一次到确定性的 `model_streamer/<hash>` 目录；`get_config`、`config.json` 和 `model_index.json` 的读取统一使用该本地目录，同时让各 stage 继续接收原始 URI 以保留 `model_weights` 的流式加载语义。当前 name-based fallback **只**比较去掉尾部 `/` 后的末个路径组件，不能让 bucket 或组织名参与匹配。
  - 验收：用 mock 覆盖对象存储 URI 的单次物化、配置驱动的 pipeline 选择、`model_index.json` 回退和欺骗性 bucket 名；空 `config.json` 时断言普通对象存储路径仍只以 basename 匹配。#6624 的 HF-cache repo-name recovery（含 CosyVoice3 空配置 snapshot）及其 `TestNameMatchCandidateSnapshotPaths` 回归测试已由 #6642 整体 revert；
    - PR 正文只归因为 main Buildkite #14139 失败，公开 metadata 仅能确定其中 H100 entrypoint job hard-failed，不能从该记录归因到具体测试。故这不是当前实现合同。未解决后果是这类 resolved snapshot 会把 revision hash 当候选，可能无法推断模型类型并落入默认 diffusion 初始化；在恢复并验证更窄的修复前，使用显式 deploy pipeline 或一个以模型名结尾的模型引用。^[PR #5036] ^[PR #6624] ^[PR #6642]

## 决策与踩坑

- [CONF-7a] 禁止：把原始对象存储 URI 交给 Hugging Face 仓库解析；把临时 `model_streamer/<hash>` 路径传播成 stage 的模型身份；用完整 URI、bucket 或组织名参与模型类型名称匹配；也不要在这个目标版本把 `models--<org>--<name>/snapshots/<revision>` 或 legacy `models--<name>/snapshots/<revision>` 解码为 repo 名。
