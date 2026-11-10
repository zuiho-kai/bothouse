---
name: rules-cache-task-3
description: MiniMax H3 缓存与任务生命周期规则（下）：MMH3-2k step execution 的请求状态、attention 文档与 rank-0 prepare 隔离、MMH3-2m FlashGen native LoRA 边界、MMH3-2o modular alias metadata 与 canonical 全字段同构、MMH3-2p Turbo 文件名编码 sampler 合同、MMH3-2r2 长视频 continuation 窗口、MMH3-2v sampler 状态隔离
metadata:
  scope: 只收 MMH3-2k、2m、2o、2p、2r2、2v 与页尾两条跨页指路；MMH3-2c 至 2g 归 rules-cache-task-1，MMH3-2h、2n、2j 归 rules-cache-task-2；部署与容量证据归 rules-deployment-1
---
# MiniMax H3 缓存与任务生命周期规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules-cache-task.md` 的第 3/3 部分；第 1 部分 [[rules-cache-task-1]]；第 2 部分 [[rules-cache-task-2]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-cache-task.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-10-06
- [MMH3-2k] H3 step execution 必须保持请求状态、attention 文档和 rank-0 prepare 隔离
  - 触发：MiniMax H3 实现或修改 `prepare_encode`、`denoise_step`、`step_scheduler`、`post_decode`、`batched_packing.py`、step-mode attention metadata，或改变与 DLO、Cache-DiT、TeaCache、task-specific DiT 的组合。
  - 强制：request 与 step path 复用 request-input、denoise-row prepare 与 unpack helper；每个 `StepRequestState` 保持一份 video rows、audio rows、audio sigma schedule、anchors、shape 和 output，只有同宽 video rows 交给 runner split。
    - 可融合时每个 request 向 `cu_seqlens` 贡献一个 real-row document 和一个独立的 64-row alignment-tail document，单 DiT forward 后按原 request rows 回拆；不同 task DiT、Ring 或任一 resolved backend 不支持 multi-document packed varlen 时逐 request forward。
    - rank-0-only reference preparation 的异常必须在任何后续 broadcast 前由 H3-local helper 同步为同一异常。step mode 必须明确拒绝 `num_outputs_per_prompt>1`、distributed layerwise offload 和 `quality=high` request-scoped Cache-DiT；这些状态不能安全跨交错 step 或 packed forward 共享。
  - 验收：CPU contract 覆盖 request/step helper parity、two-request packed document boundaries、video/audio split/reassembly、mixed-DiT/Ring/unsupported-backend fallback、abort-after-inflight-step，及三个明确 rejection；TeaCache extractor 继续以 omitted `num_requests=1` 走 request-mode path。
    - 真实权重只可在固定 checkpoint、seed、task、backend、topology 下比较 single vs packed outputs；并发 step run 的 packing composition 会随 arrival timing 改变，PR 的 4×H100 结果已显示 step rerun 和 request-vs-step 都非 bitwise 等价。
    - 有限 CPU、H100/B300 observations 和 workload-specific throughput 都不是所有 backend、small request、确定性或 multi-rank failure synchronization 的证明。^[PR #5810]
- [MMH3-2m] FlashGen native LoRA 必须保持 artifact、schedule 与 legacy-manager 边界
  - 触发：FlashGen native artifact loading、H3 dynamic LoRA classification/binding、adapter schedule、packed QKV/FC1，或与 task、step execution、CPU/layerwise/DLO/HWR offload 的组合。
  - 强制：只接受 exact v1.0 safetensors file；metadata 必须为 `key_format=minimax-h3-native`、`qkv_layout=grouped`、rank/alpha `64/64`、`tasks=t2va` 和五个 boundary 的四-interval `base_schedule`；target set 必须完整且精确（259 个），A/B pair、matrix shape、文件名或 metadata 任一不符均 fail closed。按 native module name 映射；
    - grouped `qkv_proj` 先复用 H3 base-loader reorder 再拆 Q/K/V，`fc1` 拆 gate/up，二者复用 full-input A、以 slice-local B 绑定 packed layers。
  - 强制：artifact format 而非 running platform 选择 native loader；loader 读取 CPU safetensors、无 `torch_npu` dispatch，但最终 binding/execution 仍由 selected runtime platform 负责。adapter 仅在 nonzero-scale active request 时覆盖 checkpoint schedule；
    - T2VA request mode 可省略 steps 并从 adapter 取 4 intervals，explicit step 必须为 4；step execution 必须显式给 4，因为 admission 早于 adapter schedule。native adapter 不得与 checkpoint-pinned `base_schedule` 或 Ref2VA 组合；真实 reload/eviction 必须清掉 reused client ID 的 native classification/schedule。
  - 强制：保持既有 legacy `DiffusionLoRAManager`，不引入 native-only manager、prefusion 或 multi-active composition。动态 A/B tensors 不参与 model-level CPU 或 standard layerwise weight lifecycle，因此二者拒绝；request-mode DLO 仅 stream base blocks、A/B 留 compute device。step execution 仍拒绝 DLO；
    - HWR 的 `lora_path` eligibility 与 AllGather transport 未被本 PR 改变，不能据此宣称 HWR 或 LoRA-AllGather support。
  - 验收：mock/synthetic artifact 覆盖 metadata/file/target/pair/shape/schedule rejection、grouped QKV 与 FC1 packing、legacy manager complete binding、active vs scale-zero、same ID reload/eviction、T2VA/Ref2VA、request/step count、offload gates 与 TP slice divisibility。
    - PR 新增 native-LoRA unit contracts，未提交真实 release artifact 的 GPU/NPU E2E 或 independent quality/performance gate。^[PR #6666]
- 共享 component quantization、checkpoint mapping 与 quality evidence 见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。
- 部署与容量证据见 [[rules-deployment-1]]、[[rules-deployment-2]]（部署与证据规则）；共享 diffusion 缓存机制见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（diffusion 规则）。
- [MMH3-2o] modular alias metadata 必须与 canonical H3 implementation 全字段同构
  - 触发：新增或修改 MiniMax-H3 的 alias class、`model_index.json` root routing、`DiffusionModelMetadata` 能力字段，或 recipe 依赖 repo-id 与 partition path 等价。
  - 强制：凡是解析到同一 `MiniMaxH3Pipeline` 实现的 alias，都必须与 canonical entry 保持所有 runtime-selected capability 字段同构，不只 admission 上限，还包括 backend default gate 会读取的字段（如 `attention_mask_free`）以及 packed-sequence / mixed-reference 相关能力。
    - repo root index 若解析到 alias，则 reviewer/debugger 必须先按 alias metadata 检查默认 backend 与 request contract，而不能假设它自动继承 canonical row。
  - 验收：对 root repo id、partition subdir 和 modular alias 分别断言 metadata parity、默认 attention backend resolution 与 supported task/admission contract 一致；任一字段 drift 都应在 contract test 中直接暴露。^[PR #7162]
- [MMH3-2p] Turbo filename 编码 sampler 合同，目录不得静默挑文件
  - 触发：修改 MiniMax-H3 LightX2V Turbo LoRA loader、artifact 选择、`TurboSpec`、request task/steps/`flow_shift`/`audio_flow_shift`、alpha 解析，或 Ref2VA/combined topology 下的 Turbo 准入。
  - 强制：只服务 Diffusers-PEFT 布局；从文件名解析 `TurboSpec`（`fl2v`/`ref2v`、denoise steps、768p 与否决定 video shift 6.0/12.0、audio shift 3.0、rank 128）。`num_inference_steps`、`flow_shift`、`audio_flow_shift` 与 `_resolve_task` 必须按**实际加载**的 artifact 校验：`fl2v` 只服务 `t2va`/`fl2va`，`ref2v` 只服务 `ref2va`；
    - `sigma_points = denoise_steps + 1`。alpha 以 safetensors metadata 为准；缺省时用 LightX2V 参考默认 `8` 并 warning，不得硬钉 `128`。
  - 强制：`--lora-path` 指向单文件，或只含一个可解析 Turbo artifact 的目录；多候选必须 fail closed。`ref2v` 只能挂在 Ref2VA-only server；combined/`transformers_ref` 拓扑不得绑定只注入 `transformer` 的 Turbo adapter。ComfyUI 融合 QKV/SwiGLU 导出按名拒绝。
  - 验收：覆盖多 artifact 文件名矩阵、缺/错 alpha、多文件目录拒绝、task/steps/shift 负向门禁、Ref2VA-only vs combined 拒绝，以及 Diffusers-layout packing；不得把单一 artifact 通过外推为全矩阵质量证据。^[PR #7062]
- [MMH3-2r2] 长视频 continuation 必须按全局时间线切窗并同步 AV 边界
  - 触发：修改 MiniMax-H3 `long_video`/`continuation_*`、`audio_mode=lock_source`、窗口 RoPE `temporal_offset`、`continuation_prompts`，或 fused QK-norm 的 token 索引宽度。
  - 强制：默认 latent-tail continuation 只在 Ref2VA request execution（非 step）下启用；window/overlap 必须落在 `17n+5` 网格且 window∈[107,345]、overlap<window。每窗 denoise 新鲜目标，用上一窗 AV latent 尾作 guide 条件行（共享新目标时间原点），丢弃新采样 overlap，只追加后缀。媒体时间按全局帧起点偏移（保留小数），文本/静图/空间位不变；多窗 prompt 独立编码，媒体原点锚定最长 text 前缀之后。
    - 音频边界用累积帧时间线的 `_audio_t`，避免逐窗取整漂移。长序列 QK-norm 扁平偏移使用 int64。
  - 验收：窗口规划、overlap discard/append、全局 temporal offset、多 prompt 同源媒体时钟、lock_source 与 int64 QK 偏移。^[PR #7838]
- [MMH3-2v] sampler 状态必须隔离到请求与 AV stream
  - 触发：修改 H3 sampler 参数、request/step denoise loop 或多请求合批。
  - 强制：省略 sampler 保持 `euler`；`res_multistep` 经统一名称校验，在每个请求内为 video/audio 的各自sigma schedule创建独立 solver。step模式把solver保存在该 `StepRequestState`；每步只按递增index消费一次。固定 distilled `base_schedule` 仅允许Euler，其他选择以说明验证限制的 `ValueError` 拒绝。
  - 验收：默认Euler跨dtype保持bit-parity；RES系数与固定参考fixture对应；覆盖request/step一致性、mixed-sampler batch、locked audio、latent edit、首次/末次Euler更新、非法schedule及重复/乱序step拒绝。验收必须有实际solver测试，PR文字列出的实验不能替代可复现测试证据。^[PR #8378]

## 决策与踩坑

- [MMH3-2k] 禁止：因 backend 名称为 `FLASH_ATTN`、平台默认或容量大于 1 就假设可合批；在多 document `cu_seqlens` 不被 backend 消费时去掉 mask；将不同宽度的 audio rows 混入 video batch；让 request-scoped Cache-DiT hooks、DLO resident window 或多输出 latent 跨 state 复用。
  - 不得把 H3-local broadcast 夸大为通用 runner 防护：target 的 `_dit_any_rank_failed()` 无法取得 DiT group 而退回 local flag，且 group-device 选择仍有 backend mismatch 风险。
- [MMH3-2m] 禁止：把 NPU directory/训练来源解释为 NPU-only 或已验证跨平台性能；把 request-mode omission 扩展到 step execution；把 on-disk adapter size 作为 rank-local HBM bound；或以 unit/mocked binding、作者的单一硬件报告声称真实 artifact E2E、quality、throughput 或 other topology evidence。
- [MMH3-2o] 禁止：只复制 review 点名的单个字段；把“同一 Python pipeline class”当成 metadata 自动等价；或用 partition-specific smoke 证明 repo-root serving 行为。
- [MMH3-2p] 禁止：继续要求单一 `4step_v1.0_768p` 文件名或 `alpha==128`；在目录里静默挑选；把未声明 alpha 当 rank；或让 Ref2VA 请求跑到未蒸馏 DiT 的 few-step schedule。
- [MMH3-2r2] 禁止：在 step execution 上开 continuation；用 per-window 舍入累积 A/V 漂移；让 prompt 长度推动 AV 时间轴；把 guide 写成 masked target 前缀；把全局偏移承诺为精确镜头切换。
- [MMH3-2v] 禁止：跨请求或AV stream共享denoised history；对固定蒸馏schedule静默启用RES；重复或乱序推进solver；为支持新sampler改变默认Euler的浮点运算顺序。
