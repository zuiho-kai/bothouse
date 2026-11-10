---
name: rules-cache-task-1
description: MiniMax H3 缓存与任务生命周期规则（上）：MMH3-2c conditioned VAE 固定种子按实际设备 fork_rng 并恢复、MMH3-2d modular H3 task selector 与双 DiT lifecycle、MMH3-2e quality 映射只决定 request 的 Cache-DiT 目标、MMH3-2f force-refresh hint 属 profile identity、MMH3-2g TeaCache 只绑定 FL2VA 校准
metadata:
  scope: 只收 MMH3-2c 至 MMH3-2g；distilled sigma schedule、FastH3 与 Turbo LoRA 归 rules-cache-task-2，step execution、FlashGen native LoRA、alias metadata、Turbo filename、长视频 continuation、sampler 状态归 rules-cache-task-3
---
# MiniMax H3 缓存与任务生命周期规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules-cache-task.md` 的第 1/3 部分；第 2 部分 [[rules-cache-task-2]]；第 3 部分 [[rules-cache-task-3]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-cache-task.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #5703；PR #5720；PR #5810；PR #5837；PR #5840；PR #5853；PR #5991；PR #6476；PR #6550；PR #6666；PR #6714；PR #6909；vllm_omni/diffusion/models/minimax_h3/batched_packing.py；vllm_omni/diffusion/models/minimax_h3/fasth3.py；vllm_omni/diffusion/models/minimax_h3/lora.py
  - vllm_omni/diffusion/models/minimax_h3/minimax_h3_transformer.py；vllm_omni/diffusion/models/minimax_h3/npu/lora.py；vllm_omni/diffusion/models/minimax_h3/pipeline_minimax_h3.py；vllm_omni/diffusion/models/minimax_h3/quality_policy.py；vllm_omni/diffusion/models/minimax_h3/vae.py
  - vllm_omni/diffusion/cache/cachedit/runtime.py；vllm_omni/diffusion/sched/sigma_schedule.py；vllm_omni/diffusion/worker/diffusion_worker.py；vllm_omni/entrypoints/openai/video_api_utils.py；tests/diffusion/models/minimax_h3/test_minimax_h3_contract.py
  - tests/diffusion/models/minimax_h3/test_minimax_h3_fasth3.py；tests/diffusion/models/minimax_h3/test_minimax_h3_lora.py；tests/diffusion/models/minimax_h3/test_minimax_h3_native_lora.py；tests/diffusion/models/minimax_h3/test_minimax_h3_parallel.py
  - tests/diffusion/models/minimax_h3/test_minimax_h3_step_execution.py；tests/entrypoints/openai_api/test_video_api_utils.py；PR #7162；PR #7062；PR #7838；PR #8378
- 置信度（confidence）：high
- `MMH3-2c`–`MMH3-2k`：conditioned VAE 的确定性、modular task 选择，以及 request 级 Cache-DiT、TeaCache、distilled sigma schedule 与 Turbo LoRA 的生命周期。触发信号见 [[minimax-h3-rules-1]]、[[minimax-h3-rules-2]]、[[minimax-h3-rules-3]]（MiniMax H3 规则） 的 Direct 代码快速入口；
  - 加载合同见 [[rules-loading]]（加载规则），媒体输入见 [[rules-media-1]]、[[rules-media-2]]（媒体规则）。
- [MMH3-2c] conditioned VAE 的固定种子必须按实际设备隔离并恢复
  - 触发：修改 H3 image/video reference 的 VAE encode、固定 keyframe seed、`fork_rng`、设备 generator 或 accelerator backend 支持。
  - 强制：`encode_image()`/`encode_video()` 在采样前暂时把 VAE 转成 FP32，在 `torch.random.fork_rng` 同时传 `devices=...` 与 `device_type=parameter.device.type`，并在 context 内播种 CPU default generator 与 active-device generator；退出时恢复 RNG state，在 `finally` 恢复原 dtype，image path 还必须恢复 `parallel_tiling`。
    - 这个 seed 是 conditioned VAE 的固定内部 seed，不能描述成 request seed。
  - 强制：`devices` 只决定保存/恢复哪些 device index，不能代替 `device_type` 选择 RNG module；目标 torch 版本省略后者会默认进入 CUDA。NPU 依赖 `torch_npu` 先注册 `torch.npu`，encode 内的 `self.device_module` 则在同一 active device 上执行 `device(...)` 与 `manual_seed(...)`。
  - 验收：同 seed 的 image/video condition latent 可重复，正常和 encode 异常后 CPU、目标设备 RNG state、dtype 及 image tiling state 都恢复；CPU 与每个声称支持的 accelerator 分支分别覆盖，并加入重叠调用 fence。PR 中拟议的专用 VAE 单测按 review 被删除，目标 commit 没有新增测试；
    - PR #5837 也只改两处参数，未提交 CPU/NPU 回归测试，其 NPU smoke、serving 结果与 CUDA 不变性说明只能作为外部证据，不能冒充持续回归覆盖。^[PR #5703] ^[PR #5837]
- [MMH3-2d] modular H3 的 task selector 必须同步权重、能力与所有 DiT lifecycle
  - 触发：修改 `modular_model_index.json`、`MiniMaxH3ModularPipeline`、`--task-type`、combined FL2VA/Ref2VA 服务、`_dit_modules` 或 shared text/VAE components。
  - 强制：模型发现同时识别 `model_index.json` 与 `modular_model_index.json`，registry alias 与 postprocess 都映射到同一 H3 pipeline。`auto/combined` 从 root 加载 FL2VA `transformer` 与 Ref2VA `transformers_ref`，但共享 text encoder、video/audio VAE；单 task 只加载所需 DiT。request task 必须属于启动时 `supported_tasks`；
    - combined 省略 task 时按无媒体→t2va、image-only →fl2va、video/audio→ref2va 推断，因此 image-only Ref2VA 必须显式给 task；Ref2VA-only 省略 task 时保留 implicit ref2va。
  - 强制：modular alias 复制 9-image/mixed-reference admission capability；所有基于 `_dit_modules` 的 consumer（loader strictness、Cache-DiT enable/refresh/summary、LoRA/offload）遍历实际 DiT，不硬编码 `transformer`/`transformer_2`。共享 `--task-type` 放宽后，非 H3 owner 仍 model-aware 校验；Qwen3-TTS 只接受既有三值。
  - 缺口：目标 pin 的 modular metadata 虽修复 admission 字段，仍遗漏 canonical H3 的 `attention_mask_free=True`。HF root 的两个 index 都解析成 modular alias，因此默认 combined 服务在 Blackwell 不会自动选 TRTLLM，与 recipe 声明冲突；alias 必须校验全部能力字段 parity，不能只复制 review 点名的字段。
  - 验收：覆盖 local/Hub index discovery、snapshot allow-pattern、combined/单分区初始化、缺 partition、task default/membership、modular admission、两 DiT cache lifecycle 与非法 TTS selector。PR body 的顺序 T2VA→Ref2VA 视频使用 `duration=2.0`，低于目标 pin 已生效的 4 秒下限，因此不能证明 final merge 的 combined 路径；
    - 148.27/158.67 GiB combined 与 86.27 GiB single-load 等数字来自缺硬件/协议/重复次数的 issue comment，不能作为容量保证。^[PR #5720]
- [MMH3-2e] quality 映射只决定 request 的 Cache-DiT 目标
  - 触发：修改公共 `quality` 值、H3 quality policy、startup cache adoption 或 denoise 前 prepare。
  - 强制：公共层只接受 `None`、`lossless`、`high`，并保留 omitted 与 explicit lossless 的区别。对 request-scoped Cache-DiT，`lossless` 产生空 target；`high` 总是选择 model-owned conservative profile，即使启动时没有 cache backend；omitted 仅在启动配置为 Cache-DiT 时恢复 server generic profile，否则不安装 Cache-DiT。
    - pipeline 必须在参数/任务/step 解析完成后、真实 denoise 紧邻之前 apply plan。
  - 验收：offline、chat、sync video、streaming video 都覆盖 omitted/lossless/high/非法值及显式字段传播；startup cache on/off × 三种 intent 验证 exact installation key，并断言 prepare 先于 diffuse。当前测试广泛覆盖 validation/routing/policy 和 mock 顺序，但真实 Cache-DiT transition 的并发、取消、failure rollback 仍缺证据；
    - 独立 reviewer 的单卡 B300 观察也显示 `high` 的质量/延迟与四卡表明显不同，只能支持 topology-dependent 边界。共享状态机与 batch 合同见 [[rules-component-lifecycle]]（DIFF-2i–2j）。^[PR #5853]
- [MMH3-2f] force-refresh hint 属于 active profile identity
  - 触发：H3 request `extra_args` 使用 `force_refresh_step_hint` 或 `force_refresh_step_policy`。
  - 强制：hint 是 1-based positive integer 且不超过 `num_inference_steps`，policy 只接受 once/repeat，省略 policy 默认 once；没有 active cache target 时两者都拒绝。用 dataclass replace 生成 request-local config，不修改 startup generic config；
    - installation key 必须包含 hint+policy，因为 Cache-DiT 的 incremental refresh 把 `None` 解释为保留旧 hint，变更或移除 hint 必须 reinstall hooks。
  - 验收：边界 1/steps、0/越界/bool/非法 policy、无 target、hint add/change/remove、once/repeat 和 repeated same-key request；断言每次 refresh 重建 hint context、generic config 不变，key 变化发生 disable→enable。当前覆盖为 mock/config 合同，未证明不同 topology 下 hint 对质量/命中率的效果。^[PR #5853]
- [MMH3-2g] H3 TeaCache 只绑定 FL2VA 校准与 request state
  - 触发：H3 选择 `tea_cache`、修改 extractor、polynomial coefficients、threshold 或 partition。
  - 强制：只允许 `fl2va`/`combined`，Ref2VA-only fail fast；combined 只 hook FL2VA `transformer` 并告警 Ref2VA 不缓存。extractor 必须复刻 `_embed`、packed/SP block kwargs、final row selection 与 video/audio update masks；缺/多 kwargs、空 blocks、shape/length 不闭合立即失败。runner 在每次 generation 前 reset module-resident hook state；
    - first step 强制计算，后续按累积距离计算或复用 residual，目标 hook 没有 last-step 强制计算分支。
  - 强制：H3 coefficients 只由 70 prompts、seed 42–111、256×448、107 frames、50 steps 的 3360 adjacent pairs 校准；`TeaCacheConfig` 收到 `None` 时模型默认 0.17，自定义 coefficients/正 threshold 可覆盖。但 public `AsyncOmniEngine._normalize_cache_config` 在省略 cache config 时仍先注入 0.2，因此 CLI/public omitted 路径没有获得 0.17；
    - recipe 显式 0.17 不受影响。
  - 验收：CPU extractor tests 覆盖 native parity、packed kwargs、mask/SP 与错误路径；backend tests 覆盖 partition/default/override。模型 E2E 仅两 steps 并检查输出 shape，未断言真实 cache hit；还必须从 public omitted config 断言最终 H3 threshold，不能只直接构造 backend；覆盖 TeaCache × omitted/lossless/high，断言只存在一个 hook/backend 或明确拒绝。
    - module state 若可交错还需并发隔离证明。单 H100 online/offline、Cache-DiT default/conservative 数据无多 prompt/repeats，不能升级为 gate。

## 决策与踩坑

- [MMH3-2c] 禁止：把 PR 文本中的 CUDA+MUSA allowlist 当成目标实现。目标代码实际以 `parameter.device.type != "cpu"` 接纳已注册的 accelerator device module，并把真实 type 交给 `fork_rng`；CPU 的 `devices=[]` 仍保存/恢复 CPU RNG。实机证据覆盖 CUDA/MUSA，以及 PR #5837 报告的 Ascend NPU direct fork smoke 与一次双参考图 FL2VA serving 成功，不能外推 XPU 或 ROCm。
  - 也不能因 `fork_rng` 最终恢复 state 就宣称并发安全：context 内仍会暂时改写 process-global CPU/device generator，重叠调用需要序列化或独立并发证明。
- [MMH3-2d] 禁止：从 combined 注册推断双 DiT 性能已验证；recipe 最终只描述配置，没有 combined warm latency/throughput/output-parity qualification。也不能用单 DiT Cache-DiT 测试证明 `transformers_ref` lifecycle。
- [MMH3-2e] 禁止：沿用 PR 早期描述，把无 startup cache 的 `high` 拒绝；让 unsupported quality 静默落入 lossless；在 request 未显式提供 quality 时由 sync/streaming serving 覆盖 model default。recipe 把同一组 quality 数字标为 4×H200，而 PR evidence 把它归于 4×L20X SP4；hardware provenance 未统一前不得引用该表作为任一硬件的可靠 benchmark，更不能外推通用 speedup/quality。
- [MMH3-2f] 禁止：接受 bool 作为整数；只给 policy；跨 request 原地修改共享 config；same-key repeated request 忘记重置 once hint，导致它只在首个 request 生效。
- [MMH3-2g] 禁止：把 FL2VA coefficients 用于 Ref2VA，或宣称 selector 已在 request 层强制互斥。目标 pin 中 TeaCache 由 runner 持有；`quality=lossless` 只清除 Cache-DiT target、不会卸载 TeaCache，`quality=high` 还会尝试在同一 transformer 安装 Cache-DiT。修复或拒绝该组合前，TeaCache server 不得用 request `quality` 承诺 lossless 或双 backend 安全。
  - 0.2 单 H100 A/B 虽约 1.20×，LPIPS 0.3162 是显著视觉差异；0.17 在同 prompt 仅约 3% wall reduction、LPIPS 0.0134，均非通用保证。^[PR #5840]
