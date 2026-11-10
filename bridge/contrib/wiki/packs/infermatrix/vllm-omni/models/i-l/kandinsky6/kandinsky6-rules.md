---
name: kandinsky6-rules
description: "Kandinsky 6 规则 K6-1a 至 K6-2c（PR #8537）：Hub 组件目录与 _adapt_k6_weight_name 权重映射、音频采样率穿过 post-process 与 formatter、参考图作被剔除的条件尾帧与 4k+1 帧数、文本投影缓存与 Mag/Tea 跳步缓存的真实首步、VAE patch parallel 的 tile 网格、HSDP / SP / TP 的视频音频文本边界"
metadata:
  scope: 只收 K6-1a、K6-1b、K6-1c、K6-2a、K6-2b、K6-2c 的触发、强制、禁止与验收及 Direct 代码快速入口；owner 范围与路由归 kandinsky6-overview
---
# Kandinsky 6 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/kandinsky6/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8537
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| Kandinsky 6、TI2VA、checkpoint、Hub folder | K6-1a | `diffusion/models/kandinsky6/pipeline_kandinsky6.py::_WEIGHT_SUBFOLDERS`、`_adapt_k6_weight_name` |
| 音视频输出、sample rate、video-only | K6-1b | `get_kandinsky6_post_process_func`、`postprocess_audio` → `output_formatter.py::normalize_diffusion_postprocess_output` |
| 参考图、tail conditioning、视频 defaults | K6-1c | `prepare_encode`、`forward`、`append_i2va_tail_condition`；`model_extras/kandinsky6.py` → `entrypoints/openai/serving_video.py` |
| text projection cache、MagCache、TeaCache | K6-2a | `Kandinsky6Transformer3DModel.clear_text_proj_cache`、`K6StepCache`、`Kandinsky6TI2VAPipeline.forward` |
| patch parallel、VAE tiling | K6-2b | `modeling_kandinsky6_vae.py` 的 tile split/exec/merge → `tests/diffusion/models/kandinsky6/test_vae_patch_parallel.py` |
| HSDP、SP、TP 权重 shard | K6-2c | `kandinsky6_transformer.py` 的 `_sp_plan`、`_is_transformer_block`、`_shard_loaded_weight` |

### [K6-1a] Hub 组件目录与权重名称映射必须分别闭环

- 触发：修改 Kandinsky 6 checkpoint discovery、空模块构造或权重 loader。
- 强制：保持 `transformer/`、`vae/`、`text_encoder/`、`text_encoder_2/`、`audio_vae/` 到各模块的独立加载；`videoT` / `audioT` 映射到 `video_dec_block` / `audio_dec_block`，Qwen language/visual 与 audio VAE/vocoder 按 `_adapt_k6_weight_name` 的各自前缀映射。tokenizer 从独立 `tokenizer/` 目录取。模块初始 device 必须服从共享 resolved offload policy。
- 验收：`test_hub_component_keys_map_onto_pipeline_modules` 覆盖视频、音频、Qwen language/visual 与无需改名的权重；共享 legacy-flag-reader 检查保持通过，真正的 checkpoint 加载另核对 missing/unexpected keys。^[PR #8537]

### [K6-1b] 音频采样率必须穿过 post-process 与 formatter

- 触发：修改 Kandinsky 6 `DiffusionOutput`、post-process、video/audio formatter 或 mux。
- 强制：post-process 返回平铺的 `video`、`audio`、`audio_sample_rate`、`fps`；int16 PCM 转为 mux 使用的 float32 波形，44.1 kHz 采样率进入 formatter 的 audio metadata。无音频时同时省略 audio 与 sample-rate；解包单请求产生的 batched audio list。
- 验收：覆盖 PCM 范围转换、flat payload 的 metadata、无音频与单元素 list；真实 mux 另核对容器的音频采样率、视频 fps 和解码结果。^[PR #8537]

### [K6-1c] 参考图是被剔除的条件尾帧，公开 defaults 不固定视频长度

- 触发：修改 Kandinsky 6 T2VA/I2VA 请求解析、reference image、latent packing 或视频 defaults。
- 强制：非空 prompt、每请求一条 prompt、最多一张 reference image；图片从 `multi_modal_data.image` 进入，保持 `tail_cond_first_frame` 的追加、条件 mask 和 `generated_visual_mask` 在 decode 前排除条件尾帧。公开 recipe 的 `4k+1` 帧数与 16 整除分辨率必须与 latent 时空布局一致；`duration_seconds=None` 的 serving defaults 允许显式帧数，固定时长模型继续执行自己的帧数约束。
- 验收：分别检查无图/单图/多图拒绝与条件尾帧剔除；video-server 测试区分 defaults-only 与 fixed-duration 模型；真实 I2VA 另验证帧数和参考图条件效果。不把配置默认值或 tensor shape 测试当作生成质量已验收。^[PR #8537]

### [K6-2a] 文本投影缓存只属于当前 generation，跳步缓存必须有真实首步

- 触发：修改 Kandinsky 6 text projection、请求复用或 denoise step cache。
- 强制：每次新 generation 清除 transformer 的 text projection cache；step execution 的 prepare 路径与 monolithic `forward` 都要保持此边界。Mag/Tea step cache 先完成并保存真实 denoise 输出，之后才能在阈值与 skip budget 内复用。
- 验收：连续两个不同 prompt 的请求与 warmup→首请求检查不会命中旧文本投影；`test_step_cache_skips_only_after_a_real_step` 验证首步不跳、store 后才允许跳；缓存质量与分布式收益分别以真实模型结果核验。^[PR #8537]

### [K6-2b] VAE patch parallel 必须保持单卡 tile 网格及合并语义

- 触发：修改 Kandinsky 6 VAE decode 的 tile split、rank 分发或 merge。
- 强制：保持单卡 optimal tiling 的 shape/stride 与 tile grid，分布式 split/exec/merge 按 grid coordinates 重组同一 decode；每个 rank 执行 tile，而不是重复 decode 全图。
- 验收：`test_distributed_decode_tiles_match_local_tiled_decode`、optimal-tiling 回归和两 rank CPU/gloo tile 分发测试各自通过；stub decode 的一致性不外推为真实 Hunyuan VAE 的 GPU 数值 parity 或性能收益。^[PR #8537]

### [K6-2c] 模型并行计划必须保持视频、音频与文本的各自边界

- 触发：修改 Kandinsky 6 transformer 的 HSDP block selection、SP plan 或 TP 权重加载。
- 强制：HSDP predicate 保持 indexed `visual_transformer_blocks`、`text_transformer_blocks`、`video_text_transformer_blocks` 与 `audio_text_transformer_blocks` 的明确匹配，不能把 embeddings 误当 transformer block。SP 对 visual tokens 与其 RoPE 使用对应 shard，并在 visual head 前沿 token 维 gather；
  - TP loader 依各参数的 loader contract 取 shard，形状已经匹配的 replicated bias 保持完整。
- 验收：`test_hsdp_predicate_matches_visual_blocks_only_when_indexed`、SP plan、column-parallel weight 与 replicated row-bias 单测分别覆盖边界；真实多 rank 运行另比较输出 shape、video/audio 条件与单卡结果。^[PR #8537]
- 共享输出与进程协议见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（Diffusion 输出规则）；真实模型能力的证据边界见 [[model-validation]]（模型验证）。

## 决策与踩坑

- [K6-1a] 禁止：把 Hub bundle 当作单一 transformer checkpoint；对所有组件套同一个前缀替换；读取已退役 offload flags 来覆盖 resolved policy。
- [K6-1b] 禁止：额外包一层 envelope 导致 formatter 丢失 sample-rate，或把 video-only 请求补成静音音轨；不得把纯函数格式测试当作真实 AAC/MP4 音视频对齐已验收。
- [K6-1c] 禁止：把参考图当成额外生成帧或无 mask 的首帧；把 Kandinsky 的默认 125 帧误判为所有请求的固定长度，或据此解除固定时长模型的约束。
- [K6-2a] 禁止：把 tensor `data_ptr()` 当作跨请求内容 identity，因 CUDA 地址复用而继承上一 prompt 的 embedding；跳过尚无缓存的首步；把已注册 TeaCache 或配置为 uncalibrated 当作已完成真实模型质量校准。
- [K6-2b] 禁止：打开 patch parallel 后绕过 optimal tiling，或用真实 transformer 的单卡 smoke 证明 VAE 多 rank tile 重组正确。
- [K6-2c] 禁止：按模块名字含 `visual` 就扩大 HSDP 范围；漏掉 gather 而把局部视频作为完整结果；对已匹配 bias 二次切片；将 plan/predicate 单测外推为全部多卡音视频数值已验证。
