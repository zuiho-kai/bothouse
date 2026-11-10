---
name: rules-diffusion-attention-precedence
description: 规则 VOMNI-CFG-2d：diffusion_attention_backend shorthand、diffusion_attention_config structured config 与 fastvideo_vsa_topk 先经 reconcile_diffusion_attention_overrides() 再由 _finalize_engine_args_dict 规范成单一 structured 表示，含 CLI/YAML 优先级、per_role 保留与 global injection guard
metadata:
  scope: 只收 diffusion attention 配置的优先级与规范表示（VOMNI-CFG-2d）及其代码入口；backend 专用参数的 typed reachability（VOMNI-CFG-2c）归 configuration-rules-3
---
# diffusion attention 配置优先级与规范表示

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-diffusion-attention-precedence.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config, diffusion；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6645；Issue #6644；vllm_omni/config/stage_config.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/engine/stage_init_utils.py；tests/config/test_config_factory.py；tests/engine/test_async_omni_engine_stage_init.py；tests/engine/test_stage_engine_args.py
- 置信度（confidence）：high

### Direct 代码快速入口

- [VOMNI-CFG-2d] **VOMNI-CFG-2d — shorthand 与 structured attention config 的 reconcile。** 先看 `stage_config.py::reconcile_diffusion_attention_overrides`，再沿 `StageConfig` 的 legacy/typed projections 到 `stage_init_utils.py::_finalize_engine_args_dict` 和 `OmniDiffusionConfig.from_kwargs`；
  - 全局注入的 guard 在 `async_omni_engine.py`。

### [VOMNI-CFG-2d] diffusion attention shorthand 与 structured config 必须先 reconcile、后 canonicalize

- 触发：diffusion stage 同时可从 deploy YAML、stage CLI 或 runtime/global engine args 接收 `diffusion_attention_backend` shorthand、`diffusion_attention_config` structured config，或 `fastvideo_vsa_topk` legacy knob 时。
- 强制：把 shorthand 视为 structured config 的 `default`；同一个 shared `reconcile_diffusion_attention_overrides()` 必须先用于 typed 与 legacy projection。CLI shorthand 覆盖 YAML `default`，但保留 YAML `per_role`；只剩 default 时移除 structured 值。CLI structured 则移除 YAML shorthand。
  - 仅含 `per_role` 的 YAML 可与 CLI shorthand 一起进入最终 fold。stage 的 structured config **或** shorthand 只要 `getattr(..., None)` 为非 `None`，就拥有该 stage，阻止 global attention injection。
  - `_finalize_engine_args_dict()` 必须 pop 两个 legacy fields `diffusion_attention_backend`、`fastvideo_vsa_topk`，并以它们和 config 调用 `parse_attention_config(...)`，使 `OmniDiffusionConfig` 只收到一个 structured representation。
- 验收：覆盖 stage shorthand、CLI shorthand 覆盖 YAML default 且保留 `per_role`、per-role-only YAML 与 shorthand 合并、CLI structured 清除 YAML shorthand，以及 stage 任一种非空表示都不接收 global injection；对两种 projection 的输出经 `OmniDiffusionConfig.from_kwargs`/normalization 断言无 mutually-exclusive conflict，且最终无 shorthand。
  - 现有证据是 config/engine unit tests 与 reviewer 指出的 #6644 conflict path；不构成 kernel、硬件、端到端生成或 backend-support 证明。^[PR #6645] ^[Issue #6644]

## 决策与踩坑

- [VOMNI-CFG-2d] 禁止：用 `hasattr` 把声明但值为 `None` 的 field 当作 stage override；让 shorthand 与 `config.default` 同时流到 parser；用 CLI shorthand 删除 `per_role`；让 typed、legacy 或 headless projection 各自做不同 reconcile；据此推断任一 attention kernel/backend 已被支持或有性能收益。
