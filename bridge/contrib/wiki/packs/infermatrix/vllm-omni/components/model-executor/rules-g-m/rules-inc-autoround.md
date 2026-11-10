---
name: rules-inc-autoround
description: "INC/AutoRound 量化配置规则 VLLM-OMNI-PR8870-INC-PARSER（PR #8870）：vllm_omni/quantization/inc_config.py 的 OmniINCConfig.from_inc_config 复制 __dict__ 后必须用升级实例重建 config_parser，使 apply_vllm_mapper 的前缀重映射（thinker.model.layers → thinker.language_model.model.layers）对层解析可见；issue #5652 的 qweight 加载错误、test_upgraded_config_resolves_remapped_blocks 回归与 Qwen2.5-Omni AutoRound W4A16 五条 e2e"
metadata:
  scope: 只收 OmniINCConfig 升级后 config_parser 接线的一条规则 VLLM-OMNI-PR8870-INC-PARSER；NVFP4 的 method dispatch（EXEC-AUTOROUND-NVFP4-1a）归 rules-autoround-dispatch，Drama 3 hybrid INT4 归 rules-drama3-quant，全局与组件量化配置作用域 EXEC-2d 归 rules-loader-contract
---
# Model Executor — INC/AutoRound 量化配置规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-inc-autoround.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-13；updated: 2026-10-13
- 来源（sources）：PR #8870
- [VLLM-OMNI-PR8870-INC-PARSER] OmniINCConfig 升级后必须重建 config_parser，使阶段前缀重映射对层解析可见
  - 触发：改动 `vllm_omni/quantization/inc_config.py` 中 `OmniINCConfig.from_inc_config` / `maybe_upgrade` 的属性复制或 `config_parser` 接线，或改动 `apply_vllm_mapper` 之后的层名解析路径；也覆盖 Qwen2.5-Omni AutoRound W4A16 的加载与 `tests/e2e/offline_inference/test_qwen2_5_omni_autoround_w4a16_expansion.py` 中的 e2e 测试。
  - 强制：`from_inc_config` 以 `omni.__dict__.update(inc.__dict__)` 复制原 INCConfig 属性后，必须用升级后的实例重建 parser（`omni.config_parser = type(inc.config_parser)(omni)`）。
    - 否则被复制的 parser 仍指向原 vanilla `INCConfig`，`apply_vllm_mapper` 对升级配置上 `block_name_to_quantize` 的前缀重映射（`thinker.model.layers` → `thinker.language_model.model.layers`）在层解析时不可见，受影响 thinker 层退化为未量化方法，
    - 加载 checkpoint 打包 `qweight` 张量时报 `There is no module or parameter named 'layers.0.mlp.down_proj.qweight'`（issue #5652）。
    - 升级与重映射行为由 `tests/diffusion/quantization/test_component_routing.py::test_upgraded_config_resolves_remapped_blocks` 回归守护：重映射后的 thinker 层解析为 (4, 128, True)、量化块之外的层保持未量化 (16, -1, True)、原始 vanilla 配置的 `block_name_to_quantize` 不被改写。
    - issue #5652 专属的 e2e skip 已随本修复移除，Qwen2.5-Omni AutoRound W4A16 五条 e2e 测试须保持启用；Qwen3-Omni 同路径测试因独立的部署后端限制（默认 `moe_backend: triton` 被 vLLM 0.31.0 对该 AutoRound MoE checkpoint 拒绝）仍保持跳过，不得以本规则要求启用。
  - 验收：`from_inc_config` 在复制 `__dict__` 后重建 `config_parser` 指向新实例；`pytest tests/diffusion/quantization/test_component_routing.py` 通过；`test_qwen2_5_omni_autoround_w4a16_expansion.py` 不再含 `_SKIP_ISSUE_5652` 且五个测试均无该 skip 装饰。^[PR #8870]

## 决策与踩坑

- [VLLM-OMNI-PR8870-INC-PARSER] 禁止：令升级后的 `OmniINCConfig` 沿用指向原 `INCConfig` 的 `config_parser`，或以其他方式使 `get_layer_config` 读不到重映射后的块名；删除或绕过 `test_upgraded_config_resolves_remapped_blocks`；以本次修复已解决为由给 Qwen2.5-Omni AutoRound e2e 重新加回 issue-5652 skip，或把 Qwen3-Omni 的跳过误判为本规则违反。
