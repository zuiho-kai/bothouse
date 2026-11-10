---
name: execution-validation
description: LingBot World 运行入口与验证：请求与配置速查表、offline trajectory replay、单 request stepwise serving 与 WS /v1/realtime/video、SE3 camera 与 WASD script、纯 Ulysses 与在线 FP8、各层测试入口及证明边界、realtime benchmark 的 ttfc/RTF/steady interval 口径
metadata:
  scope: 只收运行命令、请求配置、验证入口与 benchmark 指标口径；模型数据流归 lingbot-world-architecture，开发审查必须遵守的 LBW-* 约束归 lingbot-world-rules
---
# LingBot World 运行入口、配置与验证

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/lingbot-world/execution-validation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, diffusion, benchmark；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:vllm_omni/diffusion/models/lingbot_world/pipeline.py；vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:recipes/Robbyant/LingBot-World-2.0.md
  - vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:vllm_omni/deploy/lingbot_world_v2_stepwise.yaml；vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:benchmarks/lingbot_world/README.md
  - vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:benchmarks/lingbot_world/workload.py
- 置信度（confidence）：high
- 源码核对版本：`9cf443a7bb24d6b8007981311466d769ec13b3d8`。模型数据流见 [[lingbot-world-architecture]]（架构），开发/审查必须执行的模型约束见 [[lingbot-world-rules]]（规则）。以下命令是该版本的上游运行入口；本次知识补充没有启动模型或测量 GPU 性能。

### 请求与配置速查

| 字段或入口 | 当前行为 |
|---|---|
| checkpoint | `robbyant/lingbot-world-v2-14b-causal-fast-diffusers`，固定 causal-fast 14B 配置 |
| prompt/image | 非空文本、恰好一张图；路径图像先由 preprocess materialize；tensor 为 `[3,H,W]` 或 `[1,3,H,W]` |
| outputs / RNG | 一次请求、一个输出；使用 runner 提供的单个 `torch.Generator`；不接收 caller-provided latents |
| width/height | 同时给出或同时省略；输出正整数且按 VAE×patch 的 16 对齐，面积不超过 `480×832`；省略时由图像比例推导 |
| frames / steps | `num_frames = 9 + 12k`，每 block 3 latent frames；`num_inference_steps=4`；文本 max sequence length 固定 512 |
| flow shift | 正有限值；模型配置决定 scheduler 默认，请求 `extra_args.flow_shift` 可覆盖 |
| stepwise cache geometry | 请求 H/W 与加载时 `model_config.ar_diffusion_height/width` 一致；默认 480/832 |
| camera_action_script | stepwise 专用，每 chunk 恰好三项 latent-frame action；与 `action_path` 互斥 |
| action_path | 服务端轨迹文件需配置 trusted root：`model_config.lingbot_action_root` 或 `VLLM_OMNI_LINGBOT_ACTION_ROOT` |
| KV reuse | `model_config.lingbot_reuse_last_step_kv`，严格 boolean，默认 false，实例构造时固定；旧环境变量已不读取 |
| VAE width sharding | `model_config.lingbot_vae_spatial_sharding`，boolean，默认 true；多 Ulysses rank 生效 |
| online FP8 | `quantization_config={"method":"fp8"}`；可用完整 layer prefix 配置 `ignored_layers` |

- 来源：[request parser](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L898)、
  - [stepwise deploy](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/deploy/lingbot_world_v2_stepwise.yaml)。

### 离线 trajectory replay

- 运行上游 example；首图与动作目录使用已验证的本地文件：

```bash
python examples/offline_inference/diffusion/lingbot_world_v2.py \
  --prompt "The camera moves slowly forward through the scene." \
  --image first_frame.png --action-dir actions/forward \
  --num-frames 81 --output lingbot_world_v2.mp4
```

- 目录内 `poses.npy` 是 `[frames,4,4]`，`intrinsics.npy` 是 `[frames,4]`；两者长度一致且有限，覆盖请求所需帧数，source trajectory 上限为 4096 帧。runtime 只消费请求前缀。request-mode 不接受 stepwise `camera_action_script`；固定轨迹与 deprecated tick controls 也有不同边界。

### 单 request stepwise serving

```bash
vllm serve robbyant/lingbot-world-v2-14b-causal-fast-diffusers \
  --omni --deploy-config vllm_omni/deploy/lingbot_world_v2_stepwise.yaml \
  --port 8000
```

- deploy 明确设置 `ARDiffusionEngine`、`step_execution: true`、`streaming_output: true` 与 `max_num_seqs: 1`。这是单 GPU eager smoke 入口；单凭启动或输出成功不能说明达到 realtime。客户端用 `WS /v1/realtime/video` 的 `session.start` 开始整个 rollout；首图通过 `image_reference.image_url` 的 `http(s)` 或 `data:` URL 传入。
  - 完整公共 envelope 见固定版本 [streaming API](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/docs/serving/streaming_video_output_api.md)。
- `extra_params.camera_action_script` 是 request-scoped WASD script。mid-session camera 更新则通过 `session.interaction.interaction.event.multi_modal_data.camera` 提交结构化 SE3，Unity 坐标为 `+X` 右、`+Y` 上、`+Z` 前；velocity 示例：

```json
{"mode":"velocity","data":{"translation":[0.0,0.0,0.05],"rotation":[0.0,0.0,0.0,1.0]}}
```

- 这只是 camera 对象，不是完整 WebSocket message。key tokens 由客户端转为 SE3，不能直接塞进公共 interaction。上游客户端提供转换入口：

```bash
python examples/online_serving/streaming_video_generation/streaming_video_client.py \
  --model robbyant/lingbot-world-v2-14b-causal-fast-diffusers \
  --prompt "The camera moves slowly forward through the scene." \
  --image-reference first_frame.png --width 832 --height 480 \
  --num-frames 33 --fps 16 --seed 42 \
  --camera-updates '[{"at":1.0,"actions":["w"]}]' \
  --output lingbot_world_v2_stream.mp4
```

- 单次 stepwise request 的 `session_id == request_id`，`chunk_index` 从零连续增长。deprecated tick example 每次 `generate()` 只有一个 chunk，具有独立 event/request identity；其生命周期合同见 [[rules-bridge-batch-2]]（EXEC-1l；源锚点 #exec-1l-typed-ar-diffusion-tick-必须隔离协议身份并以完整-metadata-提交），不要把两种控制面混用。

### 并行、量化与质量开关

- 当前 pipeline 校验纯 Ulysses：`sequence_parallel_size == ulysses_degree`，`ring_degree == allgather_degree == 1`，strict mode，禁用 `ulysses_a2a_permute`。PP/CFG/VAE-patch parallel size 大于 1、HSDP 和 expert parallel 均拒绝；不能把同 group 的 VAE width sharding 描述成支持 `vae_patch_parallel_size`。
  - 四 GPU compiled 示例在 `benchmarks/lingbot_world/configs/usp4_compiled.yaml`；其 TP=1 是该配置的选择，不是 pipeline validator 对所有 TP 的限制。
- 在线 FP8 通过通用 quantization 配置传到 transformer 的 vLLM parallel linears，可按完整 prefix 保留敏感层为 BF16。camera/C2WS exclusion 是质量实验的配置选择，不是所有场景默认正确的策略。KV reuse 省去一次 writeback，VAE width sharding 改变边界数值顺序；每个开关都应与匹配的 BF16/默认 commit/full-frame decode 对照，不能从单个 kernel speedup 推断 E2E 或长 session 质量。

### 验证入口与证明边界

| 检查层 | 固定版本的测试入口 | 能证明的范围 |
|---|---|---|
| 模型合同 | `tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py`、`test_lingbot_world_transformer.py` | request 几何、checkpoint fixture、DMD/quantization 传播、decode 生命周期与并行拒绝等定向合同 |
| camera/action | 同目录 `test_lingbot_world_camera.py`、`test_lingbot_world_actions.py` | trajectory、ray/control 形状与数值约束；不能代替可视运动质量 |
| 流式状态/内存 | `tests/diffusion/ar_diffusion/test_streaming_decode.py` 与 pipeline session tests | session 隔离、frame timeline、cleanup、预算公式；不能单独证明真实峰值显存 |
| benchmark client | `tests/benchmarks/test_lingbot_world_realtime.py` | scripted WebSocket、chunk arithmetic、RTF/SLO 指标；不能证明真实服务延迟 |
| 真实 checkpoint | `tests/e2e/offline_inference/test_lingbot_world_v2.py`、`test_lingbot_world_v2_stepwise.py` 与 `tests/e2e/online_serving/test_lingbot_world_v2_stepwise.py` | 需要相匹配的权重、GPU、依赖与拓扑；应另外记录 head、revision、实际命令、视频/latent 与指标 |

- 这些是可用验证入口，未声称本次已执行 upstream 测试。先做当前环境的 import/version preflight，再选择对应测试；真实精度还需固定 seed、首图、prompt、camera trajectory、尺寸、帧数、dtype 和 attention backend，对照官方/既有 BF16 输出，覆盖跨窗口、prompt/control 切换、失败、reset/close 和长 session。

### Realtime benchmark 的指标口径

- 上游 [benchmark](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/benchmarks/lingbot_world/README.md) 连接已经启动的服务，测量单 session 的持续输出 cadence；先启动匹配 topology，再运行：

```bash
python benchmarks/lingbot_world/benchmark_lingbot_world_realtime.py \
  --port 8000 --num-chunks 40 --warmup-sessions 1 --sessions 3 \
  --target-fps 12 --output-json lingbot_world_repeated.json
```

- `ttfc_ms` 包含首次 prepare/encode 及可能的 compile/capture；后续 inter-arrival 衡量持续 cadence，不等于每个组件的执行时间。
- 流式 decoder 正常工作时，首 chunk 9 帧，后续 12 帧；N chunks 总帧数为 `12N-3`。`video_rtf = wall_seconds / (frames / target_fps)`，小于 1 才达到该播放帧率的 realtime；`video_rtfx` 是倒数。
- `--fps` 标记 mux，`--target-fps` 决定播放期限与 RTF。checkpoint 未声明原生 fps；报告两者，不能换 fps 后仍宣称同一性能结论。
- session warmup 支付编译成本；默认 6 个 chunk warmup 排除 attention window ramp，二者不同。terminal chunk 不再准备下一 block，排除于 steady metrics，但保留于整体 RTF、all intervals 和 playback simulation。
- 40 chunks 在默认 warmup 下每 session 33 个 steady intervals，三次合计 99；插值 p99 仍是稀疏样本摘要。报告每 session 的 spread、SLO attainment、模拟 playback stalls，不用短 rollout 均值代替持续性能。
- 客户端没有 server-side timestamps 或显存指标；组件归因需服务端 profiler，真实显存需服务端测量。client/server inter-arrival 接近不能分离固定编码/传输延迟。
- 通用性能证据合同见 [[benchmark-scope-1]]、[[benchmark-scope-2]]（benchmark scope）；本页只解释 LingBot 的 chunk 与播放时间口径，不保存一次性跑分。
