---
name: rules-drama3-quant
description: "Drama 3 量化配置规则 VLLM-OMNI-PR9391-DRAMA3-INT4（PR #9391）：fish_omni/quantization.py 的 drama3-int4 hybrid GPTQ 注册，Drama3Int4Config.from_config 在解析期以 ValueError 拒绝不支持形态（bits、sym、desc_act、group_size、dense.targets、experts gptq / dense gptq_marlin），fused 层 qkv_proj / in_proj_qkvz 先展开 shard 再按 dense.targets 后缀分发，未命中回退 BF16；与 NPU bsgemm-moe 配置独立"
metadata:
  scope: 只收 Drama 3 hybrid INT4 量化配置解析与 per-prefix 分发的一条规则 VLLM-OMNI-PR9391-DRAMA3-INT4；Drama 3 的 NPU adapter 规则 VLLM-OMNI-PR9106-DRAMA3-NPU 归 rules-npu-model-adapters，INC/AutoRound 量化配置归 rules-inc-autoround，NVFP4 method dispatch 归 rules-autoround-dispatch
---
# Drama 3 量化配置规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-drama3-quant.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9391
- [VLLM-OMNI-PR9391-DRAMA3-INT4] Drama 3 hybrid INT4 量化必须解析期拒绝不支持形态，fused 层先展开 shard 再按 dense.targets 后缀分发
  - 触发：`vllm_omni/model_executor/models/fish_omni/quantization.py` 新增或修改模型专属量化注册（如 `drama3-int4` hybrid GPTQ）、experts/dense 分节量化或 per-prefix 量化分发，或改动与其共存的 NPU `bsgemm-moe`（`ExpertFp8Config`）路径；该 INT4 checkpoint 的文档口径是 CUDA SM80+（Ampere 及更新，A100 已验证）。
  - 强制：hybrid 格式以模型专属 method 名 `drama3-int4` 经 `register_quantization_config` 注册。`Drama3Int4Config.from_config` 必须在配置解析期以明确 `ValueError` 拒绝：顶层 `quant_method` 不是 `drama3-int4`；`bits` 不为 4、`sym` 为假或 `desc_act` 为真（非 symmetric 4-bit、无 activation ordering 的形态）；缺 `group_size` 或缺 `dense.targets`；
    - `experts.quant_method` 不是 `gptq`；`dense.quant_method` 不是 `gptq_marlin`。保证边界：`group_size` 与 `dense.targets` 只做存在性检查，不校验取值或 targets 内容；`sym` 是真值判断而非精确等于 `True`。
    - `get_quant_method` 的分发不是直接拿原始 layer prefix 匹配：fused 层（`self_attn.qkv_proj`、`linear_attn.in_proj_qkvz`）先展开为各自 shard 名（对应 targets 中的 `self_attn.q_proj`/`k_proj`/`v_proj` 与 `linear_attn.in_proj_qkv`/`in_proj_z`），再逐个 shard 与 checkpoint `dense.targets` 做 `endswith` 匹配；非 fused prefix 直接做 `endswith`。
    - 命中返回量化 linear method（测试以 mock `AutoGPTQLinearMethod` 断言），未命中 prefix（如 `linear_attn.in_proj_ba`、`mlp.shared_expert.gate_up_proj`、`mlp.gate`）回退 `UnquantizedLinearMethod`（BF16）。NPU block-FP8（`bsgemm-moe`）配置保持独立。
  - 验收：CPU 测试覆盖三点——`get_quantization_config('drama3-int4')` 解析到 `Drama3Int4Config`；逐 prefix 参数化断言量化/不量化，且必须包含 fused 层（`qkv_proj`、`in_proj_qkvz` 量化，`in_proj_ba` 不量化；mock `AutoGPTQLinearMethod`，未命中 target 断言 `UnquantizedLinearMethod`）；
    - 对 `bits`/`sym`/`desc_act`/`group_size`/`dense.targets` 及顶层与 experts/dense 两节 `quant_method` 的变形 checkpoint 逐一断言 `ValueError` 及报错信息。既有 `bsgemm-moe` CPU 测试保持通过。^[PR #9391]

## 决策与踩坑

- [VLLM-OMNI-PR9391-DRAMA3-INT4] 禁止：放宽 `from_config` 使 `bits=8`、`sym=False`、`desc_act=True`、experts 用 `awq`、dense 用普通 `gptq`、或缺 `group_size`/`dense.targets` 的变体通过；把格式错误推迟到权重加载或运行时才失败；跳过 fused 层的 shard 展开、只用未展开的 layer prefix 匹配（`qkv_proj`、`in_proj_qkvz` 将命中不了任何 target 而被错判为 BF16）；
  - 量化任何未被 shard 展开后 `dense.targets` 后缀匹配覆盖的投影；让未命中 prefix 抛错而不是回退 BF16；把 CUDA INT4 与 NPU `bsgemm-moe` 合并成同一 config 或共用 method 名。
