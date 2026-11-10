---
name: rules-diffusion-parallel-transport
description: "规则 VOMNI-CFG-1q：SymmMem Ulysses transport 开关 ulysses_a2a_permute 在 deploy、structured parallel config、legacy/default-stage 与 serve CLI 用同一 bool 字段完整投影，省略为 false，不由 ulysses_degree 隐式开启（PR #6340）"
metadata:
  scope: 只收 ulysses_a2a_permute 配置投影一条规则（VOMNI-CFG-1q）；stage transport 字段（VOMNI-CFG-1p、1v）归 rules-stage-transport
---
# Diffusion parallel transport 配置规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-diffusion-parallel-transport.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config, diffusion；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6340；vllm_omni/config/stage_config.py；vllm_omni/config/omni_config.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/engine/arg_utils.py；vllm_omni/entrypoints/cli/serve.py；tests/config/test_omni_config.py；tests/entrypoints/test_async_omni_diffusion_config.py
  - tests/entrypoints/test_serve.py
- 置信度（confidence）：high
- [VOMNI-CFG-1q] SymmMem Ulysses transport 开关必须完整投影且默认关闭
  - 触发：新增/修改 diffusion 并行 transport flag、`StageDeployConfig`、`OmniStageDiffusionParallelConfig`、default diffusion stage 或 `serve` CLI。
  - 强制：`ulysses_a2a_permute` 在 deploy、structured parallel config、legacy/default-stage construction 和 CLI 都以同一 bool 字段传递；省略时最终值为 false，显式 true 必须到达 strict-Ulysses consumer，不能由 `ulysses_degree` 或其他 SP mode 隐式开启。
  - 验收：覆盖 CLI true/false、deploy true、structured/default-stage true 与 omitted false，断言最终 `parallel_config`；再由 DIFF-4x 覆盖 eligible consumer init 与不合资格组合不走 fused path。^[PR #6340]

## 决策与踩坑

- [VOMNI-CFG-1q] 禁止：只在 parser/dataclass 声明、在 default stage 或 deploy merge 丢失；以 truthiness 吞掉明确 false；把 `advanced_uaa`、Ring 或 AllGather 配置解释为已启用 SymmMem；将 JIT/capability failure 推迟到首个请求。
