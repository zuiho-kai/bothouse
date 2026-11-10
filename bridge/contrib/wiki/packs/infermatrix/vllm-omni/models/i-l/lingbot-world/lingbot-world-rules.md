---
name: lingbot-world-rules
description: "LingBot World 模型规则 LBW-1a 至 LBW-2f：流式 VAE decode 按 session 持有与 admission（PR #6533）、条件编码历史双份计入（PR #6838）、KV 写回策略固定（PR #7816）、pure Ulysses 并行校验、online FP8 完整层名（PR #7549）、camera 条件 latent 对齐、VAE width sharding 与 padded shard 估算（PR #7651）"
metadata:
  scope: 只收 LingBot World 的 LBW-* 规则与代码快速入口表；请求字段与运行验证归 execution-validation，数据流与配置边界归 lingbot-world-architecture
---
# LingBot World 模型规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/lingbot-world/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-22；updated: 2026-10-09
- 来源（sources）：PR #6533；PR #6838；vllm_omni/diffusion/models/lingbot_world/pipeline.py；PR #7816；PR #7651；PR #7549；https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py
  - https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/dmd_block.py
  - https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/transformer.py
  - https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py
  - https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_lingbot_world_transformer.py

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批 live 源码 |
|---|---|---|
| streaming VAE、session reset/close、admission bytes | `session-decode`：`LBW-1a` | `lingbot_world/pipeline.py` session hooks → `experimental/ar_diffusion/streaming_decode.py` |
| condition block、encoder history、temporal RoPE | `condition-history`：`LBW-1b` | `lingbot_world/pipeline.py` condition state → `lingbot_world/transformer.py` RoPE → model admission |
| 四步 DMD、clean KV、last-step reuse | `kv-writeback`：`LBW-2a` | `pipeline.py` model config → `dmd_block.py` probe / transition / commit |
| Ulysses、VAE width shard、每 rank admission | `vae-sharding`：`LBW-2b`、`LBW-2e`、`LBW-2f` | `pipeline.py` parallel validation → `_install_sharded_vae_decode` → `_streaming_decode_bytes_per_session` |
| online FP8、ignored_layers、projection prefix | `quantization`：`LBW-2c` | `pipeline.py` transformer factory → `transformer.py` parallel linears / prefixes |
| 在线 SE(3)、WASD script、camera pose 对齐 | `camera-input`：`LBW-2d` | `pipeline.py` `_prepare_next_chunk` → `_prepare_camera`；共享 camera interaction handler |

### [LBW-1a] AR 流式 VAE decode 状态必须按 session 持有并计入 admission

- 触发：修改 LingBot/Wan 系 AR-Diffusion `post_decode`、streaming VAE decode、`SupportsStreamingDecode`，或 `model_owned_state_bytes_per_session`。
- 强制：每个 `session_id` 持有独立 `StreamingDecodeState`；stepwise 中 `session_id == request_id`，不能把此等式推广到具有独立 chunk request identity 的 deprecated tick。chunk 间复用同一 temporal cache；`reset_ar_diffusion_session`/`close_ar_diffusion_session` 一并释放。
  - `model_owned_state_bytes_per_session` 必须计入 decoder 按分辨率声明的常驻字节，不能只算 image condition。会走 VAE tiled decode 的 shape 不得冒充可跨 chunk 线程 cache。
- 验收：覆盖跨 chunk 连续性、session 隔离、release、非流式/tiling fallback，以及 admission 字节随 H×W 缩放不随 session 长度增长。^[PR #6533]

### [LBW-1b] AR 条件编码历史必须会话持有、双份计入并在终止边界释放

- 触发：修改 AR-Diffusion realtime/stepwise 条件编码、Wan VAE encoder cache、session admission 字节预算，或 temporal RoPE 超出预计算表。
- 强制：跨 block 推进时保留 causal encoder history（committed + in-flight），每 session 只驻留当前 condition block 与有界 cache；admission 必须计入两份 encoder history 与 streaming-decode 字节。reset/close 必须释放 encoder cache。超出预计算 RoPE 表的 temporal 位置按绝对位置即时算 cos/sin，不得扩张常驻表。条件编码要求 unpatched、非 tiled Wan encoder。
- 验收：因果条件递进、session 隔离/清理、失败不提交、内存会计、tick/stepwise 一致，以及 RoPE 越界且 cache 尺寸固定。^[PR #6838]

### [LBW-2a] KV 写回策略必须由实例配置固定并在所有 DMD 入口保持一致

- 触发：修改四步 causal DMD、KV 写回、`lingbot_reuse_last_step_kv`，或拆分 request / stepwise 执行路径。
- 强制：`model_config.lingbot_reuse_last_step_kv` 只接受布尔值，加载组件前验证并固定到 pipeline 实例，默认 `False`。默认模式四次 denoise probe 不提交 KV，再用最终 clean `x0`、`t=0` 做一次写回；显式启用 reuse 时只在第四次 probe 写入其 noisy 输入的 KV，并省去 clean forward。两种模式都必须完成 paged context finalization；
  - request 与 stepwise 共用 `LingBotDMDBlockRunner` 的 transition / commit 合同。
- 验收：非法配置拒绝、默认值与实例隔离；两种模式逐次核对 timestep、`update_cache`、实际写回 latent、`start_frame` 和每块一次 paged commit；request / stepwise 的四次或五次 transformer 调用与输出一致性分别验证。
  - [配置与调用轨迹测试](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py#L1456)、
  - [stepwise 提交测试](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py#L2515)。^[PR #7816]

### [LBW-2b] 并行配置必须在组件加载前满足 pure Ulysses 合同

- 触发：修改 LingBot parallel config 或并行能力验证。
- 强制：sequence parallel 仅接受 `sequence_parallel_size == ulysses_degree` 的 pure strict Ulysses，`ring_degree == allgather_degree == 1` 且禁用 `ulysses_a2a_permute`；在加载组件前拒绝不支持的模式。
- 验收：合法 pure Ulysses 通过；非法并行组合在 tokenizer、encoder、VAE 加载前失败。实际 process group 的检查属于 `LBW-2e`。[并行验证源码](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L249)。

### [LBW-2c] Online FP8 配置必须贯通 eligible linears 与稳定的完整层名

- 触发：修改 LingBot transformer 构造、parallel linear、权重前缀，或 `quantization_config` / `ignored_layers`。
- 强制：沿 pipeline factory、transformer、block 到每个 eligible vLLM parallel linear 传递同一 `quant_config` 与完整 prefix；覆盖 self/cross attention、FFN、camera injectors 和 C2WS。以 `transformer.blocks.<i>...` 等完整层名匹配 exclusions；fused `self_attn.qkv` 按一个投影排除。
  - 默认保留 BF16，online FP8 使用现有 `quantization_config={"method": "fp8"}` 入口，不内置模型专属 exclusion 策略。
- 验收：factory 接收原 quant config；有/无 quant、空/完整 prefix 的构造测试逐层核对 config 对象与层名，保留 checkpoint loader 测试。需要选择 exclusion 策略时核实真实加载后的 FP8/BF16 层分布，并按目标场景、seed、camera 和 session 长度对照 BF16。
  - [构造与 prefix 测试](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_lingbot_world_transformer.py#L492)、
  - [量化边界与 exclusions](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/recipes/Robbyant/LingBot-World-2.0.md#L218)。^[PR #7549]

### [LBW-2d] 每个 block 的 camera condition 必须来自唯一且 latent 对齐的输入

- 触发：修改 LingBot 在线 camera interaction、request-scoped camera script / trajectory，或 Plücker camera embedding。
- 强制：在线入口使用共享 camera handler 的结构化 SE(3) `translation` / `rotation`，先完成 chunk-boundary apply，再消费 session 的 `last_absolute_poses`；每块必须恰好有一个 pose 对应一个 latent frame（当前为三帧）。调用 `_prepare_camera(..., latent_aligned=True)`，保持前一块尾 pose（首块 identity）的 anchor，按 controller translation unit 归一化在线运动。
  - `camera_action_script` 是 step execution 的 request-scoped WASD 输入；预设 script / cached trajectory 与已收到的在线 camera event 必须互斥，不能静默忽略后者。兼容 typed tick 时仍验证唯一 camera control 及其 trajectory / 三帧 action schema。
- 验收：覆盖无输入时 identity/hold、边界 apply 缺失、pose 数量错误、首动作 anchor、跨块连续动作和非匀速 trajectory；script / trajectory 收到在线事件必须报错。模型侧核对 folded camera 与 condition 的 frame / height / width 一致；共享事件排序与 target/velocity 时间线由共享 handler 测试负责。
  - [模型 camera 分支与对齐](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L1959)、
  - [输入互斥测试](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py#L2734)、
  - [共享 SE(3) handler](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/interaction/modality_handlers/camera.py#L104)。

### [LBW-2e] VAE width sharding 必须匹配实际 Ulysses group 并向每 rank 返回完整帧

- 触发：修改 LingBot VAE shard 安装、输出 gather 或 `lingbot_vae_spatial_sharding`。
- 强制：多 Ulysses rank 默认沿 width 安装 Wan spatial shard decode；安装前核对实际 group 大小与配置一致，用 `dst=None` 让每 rank 获得组装帧。开关只接受布尔值；显式 `False` 保留整帧 decode 与原 DiT SP。
- 验收：单 rank 不安装、多 rank 默认安装、显式关闭不访问 group、非法开关与 group mismatch 拒绝；保留 `LBW-1a` 的 session 隔离、连续 decode 和释放测试。[分片安装测试](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py#L760)。^[PR #7651]

### [LBW-2f] Streaming VAE admission 必须按实际 padded shard 尺寸估算

- 触发：修改 sharded decoder 每 session 常驻字节估算或 latent/pixel width 换算。
- 强制：先将像素 width 向上换算为 latent extent，再按实际 rank 数向上分片，最后乘 VAE spatial scale，以此 local width 预算 temporal cache；未分片时仍报整帧。
- 验收：覆盖不能整除的宽度和开关两种状态；例如 SP4 的 840 像素 width 应按 216 像素 local width 预算，关闭 sharding 则按完整 840。[预算测试](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/tests/diffusion/models/lingbot_world/test_pipeline_lingbot_world.py#L783)。^[PR #7651]

## 决策与踩坑

- [LBW-1a] 禁止：把 temporal cache 留在共享 VAE 模块上跨 session 覆写；块级独立 decode 却声称 timeline 连续；漏报 decode state 导致 admission 低估显存。
- [LBW-1b] 禁止：用固定像素/latent 帧上限冒充无界 realtime；只预算 self-KV 而漏算 encoder cache；在失败 block 后提交 pending history；把本变更写成已解决共享 paged-KV 长度上限。
- [LBW-2a] 禁止：重新读取旧环境开关或逐请求改策略；把 reuse 写成数值等价优化；把 clean-KV forward 算成第五次 denoise；省去 clean forward 时同时漏掉 pages 提交。
- [LBW-2b] 禁止：设置 `pipeline_parallel_size > 1`、`cfg_parallel_size > 1` 或 `vae_patch_parallel_size > 1`，或启用 HSDP / expert parallel；不能把 VAE width sharding 解释为支持 tiled VAE executor。
- [LBW-2c] 禁止：声称此选项同时量化普通 `nn.Linear`（含 output/time/text embedding）、norm、convolution、text encoder、VAE 或 AR KV cache；改变 prefix 导致调用者的 `ignored_layers` 静默失效；把某个 camera/C2WS exclusion 示例当成普遍质量保证，或将 FP8 plumbing 推广成已验证其他量化方法。
- [LBW-2d] 禁止：把 WASD `data.actions` 作为在线 engine SE(3) payload；在 model prepare 中再次 apply 事件；用 media-frame 数替代 latent-frame 数；对已对齐的在线 poses 再做整段轨迹重采样；复用当前块首 pose 代替 pre-action anchor 而丢掉第一步动作。
- [LBW-2e] 禁止：group 不匹配时继续安装/使用分片；只让一个 rank 获得下游每 rank 都要消费的帧；关闭时仍访问 shard group。
- [LBW-2f] 禁止：用未取整的 `width / ranks` 低报 cache；把 halo 接收 buffer 重复计作每 session temporal state。
