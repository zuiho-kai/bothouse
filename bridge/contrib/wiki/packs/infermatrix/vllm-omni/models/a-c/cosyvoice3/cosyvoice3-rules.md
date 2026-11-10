---
name: cosyvoice3-rules
description: "CosyVoice3 规则：COSYVOICE3-1a TensorRT CFM 跨 stream handoff 的顺序与 allocator lifetime（PR #5673）、COSYVOICE3-1b flow-estimator TRT plan 以自有临时文件原子发布（PR #6955）、COSYVOICE3-2a deploy 显式绑定 pipeline: cosyvoice3（PR #6896）、COSYVOICE3-1c 流式 HiFT 有界 mel 窗与相位携带（PR #7521）、VLLM-OMNI-PR8730-RAS-GPU-SAMPLING、VLLM-OMNI-PR8456-MULTI-VOICE-BENCH"
metadata:
  scope: 只收 COSYVOICE3-1a / 1b / 1c / 2a 与两条 VLLM-OMNI-PR 规则；COSY-PAYLOAD、COSY-TOKEN 归 rules-conditioning-handoff，COSY-PACKED、COSY-CACHE、COSY-SAMPLE 归 rules-packed-inference，COSY-GRAPH、COSY-PROFILE 归 rules-streaming-graphs，COSY-F0 归 rules-f0-device
---
# CosyVoice3 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosyvoice3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-09-04；updated: 2026-10-25
- 来源（sources）：PR #5673；PR #6955；vllm_omni/model_executor/models/cosyvoice3/code2wav_core/cfm.py；vllm_omni/model_executor/models/cosyvoice3/flow_estimator_trt.py；tests/model_executor/models/cosyvoice3/test_cosyvoice3_components.py；benchmarks/tts/benchmark_cosyvoice3_trt_streams.py；PR #6896
  - PR #7521；PR #8730；PR #8456
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| TensorRT CFM stream handoff 或 flow-estimator plan publication | `COSYVOICE3-1a`、`COSYVOICE3-1b` |

### [COSYVOICE3-1a] TensorRT CFM 的跨 stream handoff 必须同时守住顺序和 allocator lifetime

- 触发：修改 CosyVoice3 `ConditionalCFM.forward_estimator` 的非-`torch.nn.Module` TensorRT 分支、`TrtContextWrapper` 的 context/stream pool，或 raw device-pointer 输入/输出、dtype conversion 和 CUDA stream handoff。
- 强制：pool 中保存每个 execution context 配对的原始 `torch.cuda.Stream`；在 estimator stream 上先 `wait_stream(caller_stream)`，在其 raw `cuda_stream` handle 上 enqueue TRT，然后让 caller `wait_stream(estimator_stream)` 再消费输出。
  - 对每个以 raw pointer 绑定的 CUDA input/output record estimator stream，且在返回/转换前对 output record caller stream。context 只有在地址已 enqueue 到其专属 stream 后才能归还同一个 pair。
- 验收：CPU fake-stream 回归断言零 `synchronize`、两个方向各一次 `wait_stream`、TRT 接到 estimator raw handle，且 context/stream pair 原样回池；真实 CUDA/TensorRT 覆盖 raw-pointer input/output 的 allocator-lifetime 与数值 parity。
  - 性能报告要分开写 submission、engine 和 E2E 指标：受控 handoff microbenchmark 只能证明消除了 host blocking，有限的 E2E 样本或 engine 小幅变化不能声称模型吞吐/延迟提升。^[PR #5673]

### [COSYVOICE3-1b] flow-estimator TRT plan 必须以自有临时文件原子发布

- 触发：修改 CosyVoice3 `flow_estimator_trt.py` 的 ONNX→plan 序列化、plan 缓存路径或 `_write_plan_atomically` 发布流程。
- 强制：在 destination 同目录以 `<plan>.tmp.<pid>.<uuidhex>` 独占 `xb` 创建临时文件；写完并 close 后才 `os.replace` 到 plan。并发成功者各自发布完整 artifact，最终允许 last-writer-wins。write 或 replace 失败时只清理本调用已创建的 tmp；cleanup 失败仅记录日志，必须重抛原始异常。
- 验收：`tests/model_executor/models/cosyvoice3/test_flow_estimator_trt.py` 的五项 CPU 覆盖必须分别证明 replace 失败保留旧 plan、cleanup 失败保留 replace error、partial write 清理 owned tmp、collision 保留 foreign tmp，以及两条同步 publisher 使用不同 source path 且仅留下完整 final plan。^[PR #6955]

### [COSYVOICE3-2a] deploy 必须在 name 推断失败时显式绑定 `pipeline: cosyvoice3`

- 触发：修改 `vllm_omni/deploy/cosyvoice3.yaml`、CosyVoice3 的 `StageConfigFactory` / deploy 解析，或依赖 HF cache `models--…/snapshots/<hash>` 且 root `config.json` 无识别元数据的启动路径。
- 强制：shipping deploy 必须声明 `pipeline: cosyvoice3`（或等价显式 pipeline key），使 hash-named snapshot 在 `try_infer_model_type` / name-fallback 失败时仍解析为已注册的两 LLM stage（talker + code2wav），而不是 default diffusion stage。
- 验收：以空 `config.json` 的 `snapshots/<40-hex>` 布局回归 `create_from_model` 与 legacy stage 路径，断言 `pipeline_config.model_type == "cosyvoice3"`、两 stage 均为 LLM（非 DIFFUSION）且 model 路径保留。^[PR #6896]

### [COSYVOICE3-1c] 流式 HiFT 必须在有界 mel 窗上增量计算并携带相位

- 触发：修改 CosyVoice3 `_stream_hift_from_feat`、`CausalHiFTGenerator`、`SineGen`/`SineGen2` 的 `phase_acc`，或 streaming chunk 的 noise/F0 cache。
- 强制：每个 chunk 只在有界 mel 窗上计算（末 64 帧再加上 F0 感受野历史），不得对累积全谱重跑。谐波相位用共享的边界 `phase_acc` 带入下一窗。noise 必须是固定、按位置索引的 buffer，不能用随 chunk 变化的 `torch.randn_like`。F0 predictor 的左因果卷积要吃 window 左侧的真实历史，不能零填充；这段 margin 属于 `cache_state`，在进入 SineGen/decode 前切掉，且短于感受野的 chunk 不得饿死下一次调用。
  - finalize 除 `conv_pre_look_right` 外还要释放 predictor 自己扣下的 `trim`，否则流末约 3 个 mel 帧丢失。
- 验收：相对全量重算，float64 应逐位一致；float32 用 `assert_close(atol=1e-6, rtol=1e-5)`。同时覆盖 SineGen（22050 Hz）与 SineGen2（24000 Hz）、强制 voiced，以及均匀 chunk 和单 mel 帧的小块。^[PR #7521]

### [VLLM-OMNI-PR8730-RAS-GPU-SAMPLING] V1 RAS 采样 GPU 化仅限受支持的 NVIDIA V1 runner 路径

- 触发：修改 CosyVoice3 `model_executor/models/cosyvoice3/v1_sampling.py`/`cosyvoice3.py` 的 RAS rejection/replacement、generator 生命周期或采样参数路由，或 `worker/gpu_ar_model_runner.py`、`worker/sampling_utils.py`、`core/sched/omni_ar_scheduler.py` 中采样 host 同步与非有限 logits 校验。
- 强制："初始 draw、rejection 判定与条件 replacement 在 GPU 上一次完成（含默认 async scheduling）"的保证只覆盖受支持的 NVIDIA V1 runner 路径，不得表述为对所有平台/runner 成立。模型直连 `sample()` 的 direct-call fallback（cosyvoice3.py）仍允许在 replacement 采样前以重复 `.tolist()` 读回 rejection 谓词，并保留同步有限值校验——这是合法路径，不是待修缺陷。
  - 在 V1 runner 路径上，CPU 不得在两次 draw 之间等待 rejection 谓词，且只有被拒绝的行消耗 replacement RNG。Generator 更新放在既有 token 完成边界、Generator 复用之前；deferred feedback 跨 batch 变化持有 Generator 所有权并恰好提交一次。批量采样必须保持 Torch 兼容的 Philox addressing/advancement、ATen 排序与累积概率语义。采样参数来自 request-owned CPU SamplingParams，不做 GPU 参数 readback；
  - mixed-batch compaction 之前先对齐各行 rejection history。fused replacement kernel 只能用于已验证的 vocab 区间（2048 < vocab ≤ 9216，含 CosyVoice3 的 6761），不得 materialize 中间概率张量；seed 表以 nonblocking pinned H2D 上传，seeded-row membership 由 runtime data 决定。
  - V1 runner 路径的逐行非有限 logits 不得用会作废 worker CUDA context 的 device assertion 处理：runner 在输出完成时以 `invalid_logits_req_ids` 报告，scheduler 只把受影响 request 置为 FINISHED_ERROR 并丢弃其 multimodal/inter-stage 输出与已采样 token；direct sampler 调用保留同步校验。
- 验收：以含 RNG draw 的串行 RAS oracle（pre-B1 语义）断言批量结果与逐请求 seeded 运行（含 RNG 状态）一致；覆盖 mixed batch（greedy+random 行）的 history 对齐与 `win_size=0`；
  - scheduler 侧断言 invalid logits（`invalid_logits_req_ids`）只终止受影响 request（含不请求 logprobs 的 request）：其 `multimodal_output` 为 None、`output_token_ids` 为空、finish_reason 为 ERROR，同批健康 request 的 token 与 multimodal 输出完整。^[PR #8730]

### [VLLM-OMNI-PR8456-MULTI-VOICE-BENCH] CosyVoice3 并发基准必须多 voice 轮转并按 (text, voice) 分组校验 seeded 一致性

- 触发：修改 `benchmarks/tts/bench_cosyvoice3_concurrency_matrix.py` 的 `--ref-audio`/`--ref-text` 参数解析、worker 的 per-request voice 选择、结果字段或固定 seed 的 byte-identity 校验。
- 强制：`--ref-audio`/`--ref-text` 以 `nargs="+"` 接受一个或多个值，默认单 voice 行为保持不变；两者数量不等时必须在 `parse_args` 中以 `p.error("--ref-audio and --ref-text must have the same number of values")` 拒绝。第 `i` 个请求使用 `voice = i % len(ref_audio)` 并在结果中记录 `voice`，使并发请求携带不同 reference voice——这是该基准能暴露跨请求 voice 串音（#8235 一类回归）的前提。
  - 固定 seed 的 byte-identity 校验必须以 `(text, voice)` 元组为分组键：同 text 不同 voice 产出不同 PCM 是合法结果，不得跨 voice 比较。
- 验收：`--help` 显示 `--ref-audio REF_AUDIO [REF_AUDIO ...]`；`--ref-audio a.wav b.wav --ref-text x` 报上述错误；双 voice 时请求按 A/B 交替（PR 以 stubbed request 验证）；单 voice（默认）行为与改动前一致；pre-commit 通过。^[PR #8456]

## 决策与踩坑

- [COSYVOICE3-1a] 禁止：以 host `synchronize()` 替代任一依赖；把 `torch.cuda.stream(...)` 的 context manager 当作 pool stream；只保护输出或只保护输入，使 caching allocator 能在 TRT 完成前重用 `.to(...).contiguous()` buffer；在未建立 consumer wait 前复用 CFG 的原地写入 buffer。
  - 不得把这个优化扩展为改变 `torch.nn.Module` estimator 路径，或静默改变 `COSYVOICE3_TRT` 关闭和非-CUDA fallback。
- [COSYVOICE3-1b] 禁止：使用固定共享 `.tmp` 名称；在独占创建 collision 时删除 foreign tmp；把此发布合同扩展为 `fsync`、目录持久化、锁、内容校验或事务保证，或把 CPU 文件系统测试表述为 TensorRT/GPU 行为证明。
- [COSYVOICE3-2a] 禁止：仅依赖 basename/hash 推断；让空 `config.json` snapshot 落入 Diffusers `model_index.json` 查找并在启动时报 `Diffusers pipeline index not found`。
- [COSYVOICE3-1c] 禁止：用 PCM16 逐字节相等当正确性门槛（亚 LSB 的再结合误差会翻边界样本）；只测未触发 voiced 的随机权重；把 `scipy`/`s3tokenizer` 放回 dev extra——它们是 base install 的硬依赖，scipy 下限保持 `>=1.11.0`。
- [VLLM-OMNI-PR8730-RAS-GPU-SAMPLING] 禁止：把 GPU-only 采样保证写成无条件或跨平台承诺；以"消除 host 回读"为由要求 direct-call fallback 放弃 `.tolist()` 谓词读取或同步校验；在 V1 runner 路径为 rejection 检查引入 per-step CPU 同步；让未被拒绝的行也消耗 replacement RNG；改变 Philox/ATen 语义导致 seeded 输出漂移；在 batch compaction 之后才对齐 history；
  - 用 `torch._assert_async` 之类 device assertion 处理逐行无效 logits；让失败 request 的 multimodal/inter-stage 输出继续下发，或影响同批健康请求。
- [VLLM-OMNI-PR8456-MULTI-VOICE-BENCH] 禁止：把 seeded 校验退回按 text 单键分组（多 voice 下会把合法差异误报为 byte-identity violation）；数量不匹配时静默截断、回退默认或继续运行；破坏默认单 voice 的向后兼容。
