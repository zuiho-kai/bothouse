---
name: cosmos3-rules-2
description: "Cosmos3 规则第 2 部分：COSMOS-6a final prompt 仅 rank zero 以 DEBUG 记录、COSMOS-6b multi-chunk transfer 同步分布式 VAE overlap（PR #6920）、COSMOS-1c Distilled 加载前拒绝 CFG parallel、COSMOS-7a 共享 HF metadata 的拓扑只经 deploy pipeline 选择、COSMOS-8a 采样状态 FP32 与 transformer dtype 分开、VLLM-OMNI-PR5712-COSMOS3-VIDEO-TRANSPORT uint8 视频直通、VLLM-OMNI-PR9304-EDGE-PP-OWNERSHIP Edge 权重校验的 PP 归属"
metadata:
  scope: 收 COSMOS-6a 起的后半规则，另含 COSMOS-1c；Direct 代码入口表与 COSMOS-1a 至 COSMOS-5b（COSMOS-1c 除外）归 cosmos3-rules-1
---
# Cosmos3 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/2 部分；第 1 部分 [[cosmos3-rules-1]]
- 源页：`knowledge/repos/vllm-omni/models/cosmos3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-10-23
- [COSMOS-6a] final prompt 仅在 rank zero 以 DEBUG 留存
  - 触发：修改 Cosmos3 JSON/metadata prompt formatting、可选 `prompt_suffix`，或该 pipeline 的 final-prompt observability。
  - 强制：formatting 与可选 suffix 完成后，rank zero 使用同一最终 prompt 和 generation 路径，但只以 `logger.debug("Final prompt: '%s'", prompt)` 记录；非 rank zero 不发出该 message。
  - 验收：rank-zero test 用含 sentinel 与 suffix 的 prompt 断言最终字符串和 generation 输入不变，且 DEBUG 才有该条记录；non-rank control 无此 emission。target 未新增 log-level test，证据仅为作者报告的 CPU unit/manual check，不能外推为其它模型、日志配置或生产运行结论。^[PR #6913]
- [COSMOS-6b] multi-chunk transfer 必须同步分布式 VAE overlap
  - 触发：修改 Cosmos3 transfer 的 chunk 边界、`previous_output` 条件帧、VAE decode，或 distributed VAE 的 rank 输出/collective 路径。
  - 强制：只有 `vae.distributed_executor` 存在且 `vae.is_distributed_enabled` 可调用并返回 true 时才启用 distributed VAE 路径。每个非最终 chunk 的 overlap 必须是 `min(num_conditional_frames, chunk_frames)`；overlap 小于等于零时返回 `None`，且不调用 broadcast。
    - active executor 下所有 rank 都对每个需要同步的 overlap 调用 `broadcast_tensor`：rank 0 从已 decode output 尾部 slice 并 `contiguous()`，其他 rank 分配与 reference video 同 batch/channel/height/width、但 frame 维为 overlap 的 receive tensor，且使用 `self.device` 和 `vae.dtype`。仅 rank 0 拼接完整 video/control output；
    - 其他 rank 在 collective 完成后返回本地最终 decoded output 与 metadata。
  - 验收：mock executor 覆盖 enabled/callable gate、rank-zero tail slice、nonzero-rank receive shape/dtype/device、每个 non-final chunk 的 collective 以及 nonpositive-overlap 的 no-broadcast；
    - 仅有界的真实回归是一次 4×GB300 multi-chunk transfer（Ulysses 4、VAE patch parallelism 4、tiling，1280×720、101 frames、24 FPS、53-frame chunks、5 conditional frames、2 steps），确认完成且 metadata/video 为 101 frames at 24 FPS。该证据不构成广泛 parity、质量或性能声明。^[PR #6920]
- [COSMOS-1c] Distilled Cosmos3 必须在加载前拒绝 CFG parallel
  - 触发：scheduler `_class_name` 判定 distilled Cosmos3、修改 `cfg_parallel_size` admission，或 distilled 路径的 `guidance_scale` / `negative_prompt` 语义。
  - 强制：在加载 tokenizer/组件之前，若 distilled 且 `cfg_parallel_size > 1`，立即 `ValueError`，并指引 `--cfg-parallel-size 1` 与 `--ulysses-degree` 做多卡。distilled 路径强制 `guidance_scale=1.0`；调用方显式请求其他值时 `warning_once`，并说明 `negative_prompt` 不影响生成。
  - 验收：参数化覆盖 distilled/non-distilled × `cfg_parallel_size`/`ulysses_degree`，断言 distilled+CFGP>1 在组件加载前失败；guidance resolver 覆盖显式非 1.0 的 warning 与强制 1.0。^[PR #7427]
- [COSMOS-7a] 共享 HF metadata 的 Cosmos3 拓扑只能经 deploy `pipeline:` 选择
  - 触发：注册 Cosmos3 pipeline、写 `cosmos3_*.yaml`，或让 `--deploy-config` 的 stage/`model_config` 进入 Cosmos3 T2I/video/policy 启动。
  - 强制：T2I、video 与 policy checkpoint 共享 `model_type=cosmos3_omni` 和同一 `model_index.json` `_class_name`。`OMNI_PIPELINES` 不得注册可被该 metadata 自动命中的 `cosmos3_omni`。policy 用 `cosmos3_policy`，omni overlay 用 `cosmos3_omni_deploy`，两者都不声明 `hf_architectures` / `diffusers_class_name`，只经 YAML `pipeline:` 选中。
    - 单 stage overlay 必须 `async_chunk: false`；`guardrails: false` 等 stage extras 只有选中该 key 后才会合并。无 `--deploy-config` 时 T2I/video 仍走 CLI 单 stage fallback；`--no-guardrails` 仍是 CLI-only 路径。
  - 验收：断言 `cosmos3_omni` 不在 registry、opt-in key 无 auto-capture 字段；`cosmos3_omni.yaml` 经 `merge_pipeline_deploy` 得到 `guardrails is False` 与 `final_output_type="video"`。^[PR #7971]
- [COSMOS-8a] 采样状态与 transformer forward 必须分开控制 dtype
  - 触发：修改 Cosmos3 noise、scheduler/CFG state、conditioning mask 或 transformer 输入/输出 cast。
  - 强制：默认 sampling_dtype 为 FP32；初始 latent、条件图像/控制 mask、action/sound 和 scheduler 更新沿该 dtype 保持。仅在 predict_noise 的指定模型输入边界递归转 model dtype，transformer tensor/tuple 输出再转 sampling dtype。
  - 验收：断言默认 FP32 state、BF16 model boundary 和 FP32 prediction return；覆盖 tensor/tuple、nested media、action/sound、transfer 以及显式同 model dtype 的 control。改变默认精度还须固定输入与 seed 比较输出质量，shape smoke 不能替代。^[PR #7592]
- [VLLM-OMNI-PR5712-COSMOS3-VIDEO-TRANSPORT] uint8 视频直通必须逐字节保持历史呈现，guardrail 与非 np 输出留在浮点通道
  - 触发：修改 `vllm_omni/diffusion/models/cosmos3/pipeline_cosmos3.py` 的 `_cosmos3_media_output`、Cosmos3 guardrail adapter，或共享 `postprocess/device_reduction.py` / `media.py` / `ipc.py` 中 `enable_device_postprocess`、`preserve_input_dtype`、uint8 frames 编码与 Cosmos3 视频输出传输路径。
  - 强制：device-side reduction 默认关闭，只能经 `--video-output-transport` 的 `enable_device_postprocess` 显式开启。
    - `_cosmos3_media_output` 仅在 output rank、纯五维 `[B,C,T,H,W]` 视频、无图像/audio/action 等辅助输出、未启用 CPU/layerwise/distributed-layerwise offload、无 guardrails 且 `output_type` 未设置或为 `"np"` 时才创建 `DiffusionMediaOutput`；该判定与开关状态无关，开关只决定 transport 准备后是否出现 `VideoTensorEncoding.UINT8_FRAMES`（关闭时仍为浮点传输）。
    - uint8 直通要求 worker 在 D2H/IPC 前把 `[B,C,T,H,W]` 转为 contiguous `[B,T,H,W,C]` uint8 frames，在 decode dtype 内反归一后再做 float32 缩放与取整（`preserve_input_dtype=True`），按 64 MiB 时间块预算分块且不得改动输入张量；转换 OOM 必须回退浮点传输，插值等 float consumer 约束由共享 transport 裁决。
  - 强制：guardrail 视频保留原浮点路径与 float32 guardrail 算术：分类器收到 uint8 display 字节，adapter 返回 float32 归一浮点（[-1,1] 往返，测试容差 atol=1/127.5），未加载 guardrail 时原对象直通。
    - 其余一律走 legacy 路径：非 output rank、含辅助输出、非五维视频、offload、`"pil"`/`"pt"`/`"latent"` 时返回 legacy `DiffusionOutput`（`media` 为 None），不得改变返回类型或把 decoded pixels 当 latents 暴露。
  - 验收：参数化覆盖 fp16/bf16/fp32 × CPU/CUDA display-byte parity（含 bf16 舍入边界与饱和值）、chunk 边界（1 字节与 64 MiB）、guardrail 输入与修改输出的全字节、`output_type` 全集、aux payload IPC round-trip、offload gate、插值与初期/后期 OOM 回退。
    - 对完全合规的输入（output rank、纯五维视频、无辅助输出、无 offload、无 guardrails、`output_type` 为 None/`"np"`）断言无论开关状态 `media` 均存在且初始 `prepared_for_transport` 为假，开关只决定 transport 准备后编码是否为 `UINT8_FRAMES`；对 guardrail、非 np output_type、offload、含辅助输出或非 output rank 的路径断言 `media` 为 None 并走 legacy 后处理。
    - `check_video_safety` 无 guardrail 时返回原对象、有 guardrail 时保持输入/输出的 dtype/device 合同。^[PR #5712]
- [VLLM-OMNI-PR9304-EDGE-PP-OWNERSHIP] Edge 权重校验必须从活模块读取 PP 归属
  - 触发：修改 `vllm_omni/diffusion/models/cosmos3/transformer_cosmos3_edge.py` 的 `validate_loaded_weights` 或 `_weight_marker_is_pp_missing`，或在仓库模型代码中引入上游 `is_pp_missing_parameter` 的权重归属判定。
  - 强制：marker 是否被跳过必须由本 rank 的活模块决定：`language_model.*` 直接 `isinstance(self.language_model, PPMissingLayer)`；`gen_layers.{i}.*` 检查对应 GEN slot 模块本身（UND backbone 是单一模块、只在第一个 PP stage；每个 GEN slot 是独立模块）；其余 marker 不跳过，本 rank 拥有的 marker 缺失仍必须报错。
    - 机制事实：上游 `is_pp_missing_parameter` 把缺失层名缓存在按 `id(model)` 键控且从不清理的 `_model_to_pp_missing_layer_names`，对象 id 复用会让陈旧空缓存把活 `PPMissingLayer` 报为已加载（AMD CI build 14498 即因此漏报 `gen_layers.1`）。上游 vLLM 保持不动，也不得 vendoring 该 helper。
  - 验收：测试以 `monkeypatch.setattr(model_utils, "get_pp_missing_layer_names", lambda _model: [])` 模拟陈旧缓存查找，断言 PP-missing marker 被跳过、`relu2` 等必需 marker 缺失时 `validate_loaded_weights` 仍 fail，且未污染全局缓存；PR 的通过证据是本地 CPU 运行（需预载 cosmos3 包命名空间绕过 API server import），AMD CI 未复跑，不得据此声称真实多 stage PP parity。^[PR #9304]

## 决策与踩坑

- [COSMOS-6a] 禁止：恢复 INFO emission；把此处调级称为全局 prompt redaction/privacy guarantee；忘记 DEBUG 仍会以 plaintext 输出，或借此推断其他 trace、error 或 logger 已修改。
- [COSMOS-6b] 禁止：仅因 executor 属性存在就进入分布式路径；让任一 rank 跳过应参与的 broadcast；broadcast 整段 output、从非 rank-zero 的空 output slice overlap，或在非 rank-zero 拼接 full/control output。该同步不得放宽 `COSMOS-2c` 的 session-state guard：flag 开启时 `diffuse_transfer()` 仍须 fail closed，即使 `_bde_kv_state` 非空。
- [COSMOS-1c] 禁止：静默忽略 CFGP 导致无收益的重复实例；先加载权重再报并行非法；把 distilled 的 guidance override 写成仍消费 negative branch。
- [COSMOS-7a] 禁止：为了让 `--deploy-config` 生效而把 `cosmos3_omni` 做成 auto-detect（会吞掉 policy/video）；静默丢弃 deploy YAML 却宣称 guardrails/stage extras 已生效。
- [COSMOS-8a] 禁止：把默认 sampling state 随 BF16 权重整体降精度；遗漏 nested list/tuple 的输入 cast，或让 transformer 输出 dtype 反向决定 scheduler dtype。代码允许显式 sampling_dtype override，不能把默认策略写成禁止任何 override。
- [VLLM-OMNI-PR5712-COSMOS3-VIDEO-TRANSPORT] 禁止：把 uint8 传输做成默认行为或新增采样 flag、私有 output type、auxiliary-media contract、engine postprocessing hook；为 guardrail、pil/pt/latent、offload、非 output rank 或含辅助输出的路径启用直通；在 decode dtype 之外反归一造成 display 字节漂移；OOM 时静默改变输出契约；
  - 把 byte parity 宣称成量化后浮点值不变——它只指最终 display/encoding 字节；也不得据此改动 Wan 的默认 reduction 算术。
- [VLLM-OMNI-PR9304-EDGE-PP-OWNERSHIP] 禁止：以该 id 键控缓存的返回值决定 marker 归属；在测试中真实写入该进程级全局缓存来构造失败（同一失败会泄漏进后续测试）；借修复放宽本 rank 拥有 layer 的必需 marker。
