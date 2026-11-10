---
name: sensenova-u1-rules
description: "SenseNova-U1 规则：SENSENOVA-1a U1.5 distilled LoRA 启动期单文件单向融合（PR #6516）、1b paged AR decode 单序列 CUDA opt-in、1c native GQA 与三轴 RoPE、2a Online FP8 路由 language_model 且拒绝 distilled LoRA 冲突、3a TeaCache extractor 传递三轴 RoPE（PR #8260）"
metadata:
  scope: 只收 SENSENOVA-1a、1b、1c、2a、3a 及开头的信号表；registry 与结构要点归 sensenova-u1-overview
---
# SenseNova-U1 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sensenova-u1/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #6516；Issue #6471；recipes/SenseNova/SenseNova-U1.5.md；vllm_omni/diffusion/models/sensenova_u1/pipeline_sensenova_u1.py；vllm_omni/diffusion/models/sensenova_u1/paged_decode.py；vllm_omni/diffusion/models/sensenova_u1/sensenova_u1_transformer.py；tests/diffusion/models/sensenova_u1/
  - PR #8260
- 置信度（confidence）：high

### Direct 代码快速入口

| 信号 | 规则 | 第一批源码 |
|---|---|---|
| component online FP8与distill LoRA startup guard | SENSENOVA-2a | pipeline → language_model quant config |
| U1.5 distilled 8-step LoRA、kohya keys、one-way fusion | SENSENOVA-1a | `pipeline_sensenova_u1.py::load_lora_weights` → loader → parameter `weight_loader` |
| `VLLM_OMNI_SENSENOVA_PAGED_DECODE`、think/text decode、capture/reuse/sleep | SENSENOVA-1b | `pipeline_sensenova_u1.py::_decode_context` → `paged_decode.py` |
| GQA K/V、three-axis RoPE、single-token mask | SENSENOVA-1c | `sensenova_u1_transformer.py` → pipeline forward |

### [SENSENOVA-1a] U1.5 distilled LoRA 是启动期单文件、单向融合

- 触发：`sensenova/SenseNova-U1.5-8B-MoT` 的 distilled 8-step adapter、kohya A/B key mapping、TP load 或融合失败处理变更。
- 强制：U1.5 共享 U1 pipeline；startup 只接受 exactly one file。以 suffix/exact first-match mapping 解析 kohya A/B，fp32 计算 delta 后一次 round；fused/packed target 依声明顺序拼接，parameter `weight_loader` 负责 TP shard。zero match fail。成功后只留 adapter-name sentinel，不留 tensors；重复 load no-op。
  - 逐 parameter progressive fuse 失败必须 abort startup、reload 才可恢复，不承诺 rollback 或 adapter switching。
- 验收：CPU 覆盖 A/B、suffix overlap、fused mapping、fp32 delta、TP loader、zero-match、retained sentinel/second load 与 partial-failure abort；真实 adapter/TP/E2E 另行证据。^[PR #6516] ^[Issue #6471]

### [SENSENOVA-1b] paged AR decode 是单序列模型本地 CUDA opt-in

- 触发：`VLLM_OMNI_SENSENOVA_PAGED_DECODE`、AR decode cache/capture、dynamic PEFT 或 level-2 sleep。
- 强制：literal env default `"1"` 才启用；仅 CUDA、eligible head dimension 与完整 varlen signature，其他情况 eager fallback。cache 是 one-sequence internal K/V、identity block table、device write position/static capture；
  - fit bucket 才 reuse，growth 必须 allocate/copy/block-table 后 atomic publish bucket+generation，并 recapture；graphs 进 global pool，sleep2 clear。dynamic PEFT wrappers 禁 cross-request capture/reuse；one-way fused distill 仍 eligible。
- 验收：覆盖 env/eligibility fallback、single sequence identity table、reuse/grow generation/recapture/failed grow、sleep clear、base→LoRA→base veto；scheduler-visible runner 或 multi-sequence forward 时删除本实现并改用 manager。^[PR #6516]

### [SENSENOVA-1c] native GQA 与三轴 RoPE 必须在模型 forward 保持

- 触发：SenseNova attention head layout、RoPE construction 或 single-token decode mask 变更。
- 强制：native GQA 不预 expand K/V；每 forward 一次构建/共享 three-axis RoPE embeddings；single-token decode 不注入 all-zero mask。
- 验收：GQA/reference、RoPE sharing 和 maskless decode 各有 model test；真实 output parity/accelerator coverage 独立取得。^[PR #6516]

### [SENSENOVA-2a] Online FP8 必须路由 language_model 并明确拒绝 distilled LoRA 冲突

- 触发：修改 SenseNova pipeline quantization config、language model构造、onlineFP8或distill LoRA启动。
- 强制：resolve_component_quant_config使用精确language_model键，再把结果传SenseNovaU1ForCausalLM；两侧understanding/generationparallel linears接受它，vision/embedding/lm_head不因此量化。仅非checkpoint-serialized fp8且lora_backend=distill并有lora_path的组合在model构造前抛明确ValueError；BF16、无LoRA及已serializedFP8不能被此guard误拒。
  - componentmatch/unmatched/default/explicitdisable各保持。
- 验收：真实ComponentQuantizationConfig四种路由、三类guardcontrol和onlineFP8+distill冲突覆盖；按实际kernel/hardware分开测加载、text/image、质量和step/E2Elatency，不能只看启动成功。 ^[PR #7955]

### [SENSENOVA-3a] TeaCache extractor 传递与原 forward 相同的三轴 RoPE

- 触发：修改 SenseNova-U1 TeaCache extractor 或 transformer layer 调用签名。
- 强制：extractor 的 run_transformer_blocks 从 indexes 的三轴分别计算 rotary_emb 与 rotary_emb_hw，给每层传入同一 position_embeddings tuple，保持 indexes、mask、past KV 与 gen/und 角色不变。
- 验收：对同一输入比较常规 forward 与 extractor 全计算路径的 RoPE/层入参和结果，覆盖三轴与角色组合；stub 签名一致性不代替真实模型 quality。 ^[PR #8260]

## 决策与踩坑

- [SENSENOVA-1a] 禁止：substring multi-match、silent no-op、保留 adapter state、将一向 fused distill 当 dynamic PEFT/unload，或外推 checkpoint/quality/perf 支持。
- [SENSENOVA-1b] 禁止：把它称为 scheduler/KV manager/prefix reuse/continuous batching；跨 request 复用 dynamic adapter graph；failed grow 后保留部分 buffers；宣称通用 paged-KV、hardware parity 或性能。
- [SENSENOVA-1c] 禁止：把此模型 exception 推广给 shared attention，或用单测外推 quality/performance。
- [SENSENOVA-2a] 禁止：用全局scalarconfig测试声称验证了component名；漏掉guard直到weight_loader裸assert；把降低显存说成所有硬件更快/qualitybitparity，或把A800/vLLM0.29的Cutlass禁用要求推广所有平台。
- [SENSENOVA-3a] 禁止：只修 pipeline forward 而让 cache miss/extractor 调用漏新参数；重排 height/width/time 轴或静默忽略 indexes。
