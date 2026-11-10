---
name: rules-cache-task-2
description: MiniMax H3 缓存与任务生命周期规则（中）：MMH3-2h distilled sigma schedule 按 partition 所有且以区间计步（base_schedule、五个 boundary 四个 interval）、MMH3-2n FastH3 精确 artifact 与 VSA gate 启动期融合、MMH3-2j Turbo LoRA 精确发布 artifact 与 task/sampling/DLO 门禁
metadata:
  scope: 只收 MMH3-2h、MMH3-2n、MMH3-2j；conditioned VAE 种子、task selector、Cache-DiT quality、force-refresh、TeaCache 归 rules-cache-task-1，step execution 至 sampler 状态归 rules-cache-task-3
---
# MiniMax H3 缓存与任务生命周期规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules-cache-task.md` 的第 2/3 部分；第 1 部分 [[rules-cache-task-1]]；第 3 部分 [[rules-cache-task-3]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-cache-task.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-10-06
- [MMH3-2h] distilled sigma schedule 按 partition 所有且以区间计步
  - 触发：H3 partition `model_index.json` 的 `_minimax_h3.base_schedule`、显式 `num_inference_steps`、video/audio flow shift 或 combined FL2VA+Ref2VA。
  - 强制：缺少 metadata key 或显式 null 都表示未蒸馏，保持旧 `num_inference_steps or 50` 的 uniform-point 构造（默认 50 个点实际是 49 个 solver intervals）；explicit empty list 必须拒绝。调度至少两个有限点，严格从有限 `(0,1]` 首点递减到 0.0，并逐对验证相邻位置；FastH3 的首点是 `0.999`，不能被旧的 exact-1.0 假设拒绝。
  - 强制：5 个 sigma boundaries 只有 4 个 denoise intervals；`num_inference_steps`、Cache-DiT quality policy 和请求验证均使用 `len(base_schedule)-1`，solver 仍接收完整 boundary list。用户省略 step 时自动采用 checkpoint 步数；显式值只有精确相等才接受，否则 `OmniClientError`。
    - 同一 continuous base positions 分别应用 video/audio shift（默认 12/3），不得改用单模态 integer timesteps。
  - 强制：schedule 从各 partition metadata 分别读取；`t2va`/`fl2va` 选 FL2VA，`ref2va` 选 Ref2VA。distilled FL2VA 不得拖普通 Ref2VA 进 4-step。类级空 map 是 partially constructed pipeline 的 legacy fallback，避免 `object.__new__`/dummy fixture 读未初始化属性。
  - 边界：共享 `DMD2SigmaSchedule` 在 `diffusion/sched` 定义，但此 pin 只有 H3 消费；现有 `DMD2PipelineMixin` 仍是 scheduler-backed，用 `DMD2EulerScheduler`/integer `denoising_timesteps`，本次未接入新 utility。不得由 `[NPU]` title 推导 NPU 实机已验：无 platform/deploy/recipe 改动，PR hardware 与 branch-head 也留空；
    - 附件视频只是 smoke，无数值 teacher/student quality gate。
  - 共享 boundary/interval、metadata null/empty 与 shift 有限性合同见 [[sigma-schedules]]（DIFF-4j；源锚点 #diff-4j-continuous-sigma-boundaries-不得与-scheduler-integer-timesteps-混同）。
  - 验收：shared class 覆盖长度/端点/单调/非有限/shift≤0、缺 key 与空 key；H3 覆盖双 shift 精确值、combined partition 隔离、4-step 传入 solver/quality、matching/mismatched explicit step 和 legacy/partially-constructed fallback。仍缺真实 distilled checkpoint 的 CUDA/NPU E2E 与 teacher/student 质量阈值。^[PR #5991]
- [MMH3-2n] FastH3 只接受精确 artifact，并将 VSA gate 在启动时一次性融合
  - 触发：FastH3 `lora_path`、load-time fusion、four-step request 或 serving gate。
  - 强制：只 claim `fastvideo-lora-v2`、`finetuned_model` 位于 `fastvideo/` 且 identity 含 `fasth3` 的 exact FastH3 artifact；`base_model` 可缺省，声明时必须精确为 `MiniMaxAI/MiniMax-H3`。bundle root 与 claimed variant 都必须唯一，否则 fail closed；普通 FastVideo/PEFT/多 shard 交还 legacy dynamic LoRA，不可误认。
  - 强制：声明的 low-rank/diff/`set_weight` tensor count 必须 numeric 且与实物一致；任何 unmapped、duplicate/unpaired factor、shape mismatch、extra/incomplete block 或 fused QKV/FC1 不支持的 full-rank delta 都失败。
    - fusion 在 sharding 前完成：Diffusers Q/K/V 重排为 grouped native QKV，FC1 value-first 重排为 gate-first，再加入 low-rank `B@A` 与 full-rank `diff`/`diff_b`。成功后只保留永久 fused sentinel；不能 request-switch，dynamic manager 的 list/add/remove/pin 安全返回空/false。
  - 强制：FastH3 `vsa-datafree` artifact 的 `.set_weight` 必须精确映射到 main `transformer.` DiT 的 `blocks.{0..49}.attn.to_gate_compress.weight`：pipeline 在 streaming weights 之前只为这 50 个 main-DiT attention 创建 zero-initialized gate projection；token refiner 保持 dense，base checkpoint 没有同名 parameter collision。
    - `set_weight` 是 assign 不是 base-delta；加载后以实际 `transformer_loaded` 集合调用 `validate_fully_applied`，保证每个 injected gate 唯一且确实被 transformer 消费。
  - 强制：VSA artifact 的 main-DiT self attention resolved backend 必须为 `FASTVIDEO_VSA`（含 `self` per-role override）；dense substitute 不可运行该 sparse student。serving 只允许 `t2va`、无 per-request `lora`、exact `num_inference_steps=4`（五 boundaries/四 forwards）以及默认 video/audio shift `12/3`；
    - 拒绝 CPU/layerwise/DLO offload 与 Ref2VA。
  - 验收：synthetic artifact 覆盖 identity/base/root/variant、metadata counts、mapping/pairs、QKV/FC1 reorder、full/low-rank delta、50 个 gate 的 mapping/unique/consumption、block/shape 与 unapplied patch failures；request matrix 覆盖 backend、task、steps、shifts、request LoRA 和各 offload gate。
    - CPU tests 不替代真实 artifact/hardware 质量或性能验证。^[PR #6714] ^[PR #6909]
- [MMH3-2j] Turbo LoRA 只接受精确发布 artifact，并与 H3 task、sampling 和 offload lifecycle 共同门禁
  - 触发：MiniMax-H3 LightX2V Turbo 的 dynamic LoRA loader、artifact conversion、request task/steps/flow shift，或与 CPU、standard layerwise、distributed layerwise offload (DLO) 的组合。
  - 强制：只识别文件名可解析为 `TurboSpec` 的 LightX2V Turbo safetensors（artifact 矩阵、alpha 解析与目录选择由 MMH3-2p 定义：不再要求单一 v1.0 文件名或 `alpha==128`），metadata 必须为 `key_format=minimax-h3-diffusers`、rank `128`；任何未知 tensor、重复/不完整 A/B pair、unsupported target 或不精确的 global A/B shape 都在 binding 前失败。
    - 转换必须把 Diffusers token-refiner/main-block names 映射为 native H3 names，恢复 FC1 `[gate; up]` 行序为 model-owned packed weights，并通过 `stacked_params_mapping` 将独立 Q/K/V 接到 packed QKV。
  - 强制：Turbo 仅在非零 scale 的实际 active recognized adapter 时限制请求；
    - task、sigma points 与 video/audio flow shift 按**实际加载** artifact 的 `TurboSpec` 校验（`fl2v` 服务 FL2VA/T2VA，`ref2v` 只在 Ref2VA-only server 服务 Ref2VA，见 MMH3-2p；PR #6550 的 v1.0 4-step/768p artifact 对应五个 sigma points、`flow_shift=6`、`audio_flow_shift=3`）。
    - 每次真实 load 都替换该 client ID 的 Turbo classification，避免 eviction 后同 ID generic adapter 被误分类。
  - 强制：DLO + active Turbo 可用时，DLO 只 stream base blocks；manager 注入的 request-switchable A/B sidecars 必须留在 compute device，且任何因更大 LoRA rank 触发的 wrapper reallocation 后仍重放该 placement。固定 sidecar HBM 是此组合的预算，不得把它算作 base-block DLO lifecycle 或 collective payload。
  - 验收：覆盖 file/metadata/alpha/target/pair/shape rejection、QKV and FC1 packing、scale-zero/generic same-ID/Ref2VA lifecycle、steps/shifts errors、CPU/standard-layerwise rejection，以及 DLO admission、resident A/B device placement 和 rank-driven reallocation 后的 placement；
    - 真实 artifact evidence 必须另绑定 exact checkpoint、task、topology、sampling 和 video/audio output。DP validation 至少以同 wave 的并发 request 覆盖所声称 DP topology；DLO no-AllGather/AllGather evidence 只证明对应 base-weight transport，sidecars 不参与 collective。
    - PR #6550 报告的 0.911 GiB/TP2-rank 与 1.355 GiB/TP1-rank 只绑定 rank-128、312-target 的该 Turbo artifact，不是任意 adapter 的容量保证。转换后的 native mixed-rank PEFT artifact 不属于本 PR 的 supported contract；
    - 其 generic fallback rank/scale mismatch 是 post-merge follow-up，不可用本页的 Turbo success 证明安全。^[PR #6476] ^[PR #6550] ^[PR #7062]

## 决策与踩坑

- [MMH3-2n] 禁止：不得混同 Turbo/native dynamic adapters，支持 VSA multi-adapter、Ref2VA/offload，或声称 quality parity、平台 portability 与通用性能收益；recipe/body 的旧 steps=5 不能覆盖 source 的 4。
- [MMH3-2j] 禁止：将 exact Turbo artifact 的损坏 metadata 静默交给 generic fallback；将任意 H3 PEFT checkpoint、prefusion、multi-LoRA composition，或 combined/`transformers_ref` 拓扑下的 Ref2VA 宣称为此功能支持（Ref2VA-only server 上的 `ref2v` artifact 准入见 MMH3-2p）；在 model-level CPU 或 standard layerwise offload 下激活 Turbo。
  - 不得为动态 sidecar 重建 DLO host shards、随每个 block/denoise step stream A/B，或让 LoRA 进入 DLO AllGather；没有 active LoRA 的 DLO 不得进入此 loader path。现有 HWR eligibility 仍拒绝 `lora_path`，AllGather 也不走该 BF16 HWR path，不能将 DLO+Turbo evidence 扩展为 HWR support。
