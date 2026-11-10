---
name: minimax-music3-rules
description: "MiniMax Music3 规则：MM3-1a composite checkpoint 的 rvq_depth_decoder/condition_encoder/transformer/vocoder 四个直接组件须与 AR snapshot 同 revision 且完整（PR #6640）、MM3-1b float32 声学注意力在自动选中不兼容 backend 时改走 torch SDPA（PR #7354）"
metadata:
  scope: 只收 MM3-1a 与 MM3-1b 及 Direct 快速入口表；名称、源码路径与 deploy 配置速览归 minimax-music3-overview
---
# MiniMax Music3 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-music3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-05；updated: 2026-09-22
- 来源（sources）：PR #6640；vllm_omni/model_executor/models/minimax_music3/acoustic.py；vllm_omni/model_executor/models/minimax_music3/weights.py；tests/model_executor/models/test_minimax_music3_repo_root.py；PR #7354
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| composite checkpoint root、component completeness 或 snapshot revision | `MM3-1a` |

### [MM3-1a] composite checkpoint 的直接组件必须与 AR snapshot 同 revision 且完整

- 触发：MiniMax-Music3 从 Hub/cache/root/`language_model/` 初始化 AR 或 acoustic stage、恢复 repo identity/revision，或加载 root checkpoint component。
- 强制：`language_model/` 由 vLLM stage loader 所有；`rvq_depth_decoder/`、`condition_encoder/`、`transformer/` 与 `vocoder/` 是从同一 composite repo root 直接 strict-load 的必需组件。root markers 只能用于发现 candidate，不能代替四组件 completeness；进入任一直接加载前，每个组件都必须有可加载的单文件 safetensors，或完整的 numeric `-N-of-M` shard run。
  - 若从 cached `language_model/` 进入，必须恢复 Hub repo identity 与 `snapshots/<sha>` revision，并将该 revision/`download_dir` 传给 cache repair，使直接组件与 AR snapshot 对齐。非标准 shard 名只有在 `load_component_state` 本身可加载时才接受；component `state_dict` 保持 `strict=True`。
- 验收：覆盖 Hub ID、repo root 与 cached `language_model/` 三种入口，cold/partial/complete offline cache、缺 `condition_encoder`、缺一个 numeric indexed shard、snapshot revision recovery、custom loadable shard naming 与 strict-load failure；真实 checkpoint/audio E2E、音质、吞吐和跨平台仍需独立证据。^[PR #6640]

### [MM3-1b] float32 声学注意力在自动选中不兼容 backend 时必须改走 SDPA

- 触发：修改 MiniMax Music 3 DiT `Attention`、共享 diffusion attention 的自动 backend 选择，或该 stage 的 float32 decode 路径。
- 强制：该 `LLM_GENERATION` stage 常以 float32 运行。当自动选中的 backend 属于 float32 不兼容集合（`FLASH_ATTN`/`FLASH_ATTN_HUB`/`FLASH_ATTN_3_HUB`/`CUDNN_ATTN`/`FLASHINFER_ATTN`）时，float32 Q/K/V 必须走 torch SDPA；低精度输入仍用选定 native backend。显式 backend 选择保持 fail-fast，不得在此静默替换。`backend_name` 须同时报告两条运行时路由。
- 验收：参数化覆盖上述 backend 的 float32→SDPA、fp16/bf16 与显式 float32 仍走 native、兼容自动 backend 保留、native 不可用时 SDPA。^[PR #7354]

## 决策与踩坑

- [MM3-1a] 禁止：stage 0 只下载 language model/tokenizer 后就把 root components 当作 ready；以 marker、目录、index 或单个 numeric shard 证明完整；遗漏不在 marker set 中的 `condition_encoder`；从 cached subdir 回退到 `main`，或把 model-specific root recovery 误写成独立 tokenizer revision 传播。
- [MM3-1b] 禁止：把自动 FA/cuDNN/FlashInfer 路径直接喂 float32；把自动回退逻辑套用到显式 backend；改变共享 diffusion attention 全局 dispatch。
