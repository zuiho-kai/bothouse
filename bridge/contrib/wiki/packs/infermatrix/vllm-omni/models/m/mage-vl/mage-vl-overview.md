---
name: mage-vl-overview
description: "Mage-VL 目录入口：实验性 checkpoint microsoft/Mage-VL、代码在 experimental/fullduplex/mage_vl 而非 model_executor、离线入口 end2end.py 与 WS /v1/mage-vl/duplex、Transformers remote code 加载、PR #6537 明确不含 native registry、OMNI_PIPELINES、deploy YAML 与 unified 路由"
metadata:
  scope: 只收 Mage-VL 的名称范围、入口与不属于本 owner 的声明；transport、adapter 与 backend 结构归 mage-vl-architecture，MAGEVL-1a 规则归 mage-vl-rules
---
# Mage-VL

## 现状

### 名称、范围与入口

- 实验性 checkpoint 是 `microsoft/Mage-VL`。代码 owner 是 `vllm_omni/experimental/fullduplex/mage_vl/`，不是 `model_executor/models/`。
- 离线入口是 `examples/offline_inference/mage_vl/end2end.py`；独立 server 的 public transport 是 `WS /v1/mage-vl/duplex`，client 是 `examples/online_serving/mage_vl/duplex_client.py`。
- checkpoint 由 Transformers remote code 加载：`AutoProcessor` 与 `AutoModelForCausalLM` 均使用 `trust_remote_code=True`。共享 deferred-session lifecycle 见 [[rules-session-lifecycle]]（Serving session lifecycle）。

### 明确不属于本 owner 的声明

- PR #6537 没有 native vLLM Mage-VL architecture/`_OMNI_MODELS` registration、`OMNI_PIPELINES` key、deploy YAML 或 unified `/v1/duplex` route；也不能把这个 experimental standalone adapter 写入正常 catalog/supported-model family。未来 native executor support 必须以独立变更和真实 checkpoint compatibility evidence 证明。^[PR #6537]

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| remote-code backend、encoded-video transport、codec/frames boundary、session/runtime topology | [[mage-vl-architecture]]（architecture） |
| bounded state、gate、cancellation、capability 与 non-native boundary | [[mage-vl-rules]]（rules） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mage-vl/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, model-executor；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6537；recipes/Microsoft/Mage-VL.md；examples/offline_inference/mage_vl/end2end.py；examples/online_serving/mage_vl/duplex_client.py；vllm_omni/experimental/fullduplex/mage_vl/
- 置信度（confidence）：high
