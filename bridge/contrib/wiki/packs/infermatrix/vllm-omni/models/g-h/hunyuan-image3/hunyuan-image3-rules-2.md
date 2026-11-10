---
name: hunyuan-image3-rules-2
description: "HunyuanImage3 开发规则后半：验收矩阵 HY3-6a…6j，对齐后残余差异的升级顺序 HY3-7a…7e，ImageKVCacheManager 与 paged KV（HY3-5g、HY3-5h、HY3-5i），硬件优化层 HY3-8a，Distil CFG 与 MeanFlow HY3-8d，get_expert_mapping 返回 flat list（HY3-9a，PR #7021），文本-only chat 标为 comprehension（HY3-10a，PR #6111）"
metadata:
  scope: 只收 HY3-6*、HY3-7*、HY3-5g…5i、HY3-8a、HY3-8d、HY3-9a、HY3-10a；开发快速入口、审查触发组和 HY3-0* 至 HY3-5f 归 hunyuan-image3-rules-1
---
# HunyuanImage3 开发规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/2 部分；第 1 部分 [[hunyuan-image3-rules-1]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-13；updated: 2026-09-22

### 验收范围和完成状态

- [HY3-6a] **HY3-6a — 只验收命中维度。** 非琐碎修改只对本轮 `core` 和触发组命中的下表维度标成 `affected`、`unaffected-control` 或 `N/A-with-evidence`；`affected` 行补本次行为证据，且至少选择一个默认或相邻 topology control。未触发的维度不需要为填表而横向调查。最低验收矩阵的每一行都是独立规则，按适用性逐行报告，不能只报告已经跑通的 happy path。

| 规则 ID | 维度 | 最低用例 |
|---|---|---|
| **HY3-6b** | 入口 | offline、image endpoint、chat endpoint、内部直调中实际存在的路径 |
| **HY3-6c** | 图片数量 | T2I 0；IT2I 1、2、3、>3 |
| **HY3-6d** | 图片内容 | 异构尺寸、带 alpha 图片 |
| **HY3-6e** | 模式 | 每个受支持的 `task × bot_task` 组合及一个非法组合 |
| **HY3-6f** | Prompt | 真实 tokenizer、system prompt、阶段跳转、CoT 截断 |
| **HY3-6g** | 输出尺寸 | 显式 size、`auto`、batch 不同 ratio、缺 ratio |
| **HY3-6h** | 随机数 | online/offline 同 seed；AR、cond VAE、DiT 各阶段归属 |
| **HY3-6i** | 分层 | shared serving 没有 HunyuanImage3 状态机或模型 helper import |

- [HY3-6j] **HY3-6j — draft 只绑定受影响证据。** 受影响行所必需的正式行为测试无法运行且没有等价 CPU/CI/真实 artifact 证据时标记 `implementation draft`；不受影响或已有充分替代证据的行不阻止窄修改完成，lint、格式、编译和 mock smoke 不冒充受影响行为证据。

### 对齐后仍有差异时再升级

- [HY3-7a] **HY3-7a — 残余差异才触发精度链。** 只有真实 tokenizer、prompt tokens、stop 和 sampling 已经验证，且同一输入仍有可复现差异时，才进入 `alignment-residual`；不能在首轮为了保险遍历所有精度实现，也不能在仍有 prompt 错误时把问题归因给浮点噪声。
- [HY3-7b] **HY3-7b — 先查 processor 和版本兼容。** 对比官方与当前 processor 的返回类型、list/tensor 形状、special token 和 Transformers 主版本差异；兼容分支必须由真实返回值触发，不能凭版本号猜。
- [HY3-7c] **HY3-7c — 再查 VAE 前的 dtype 边界。** 条件图像素保持官方精度直到真实 VAE 边界；逐点比较进入 VAE 前的 tensor，不能用最终图片“看起来差不多”替代。
- [HY3-7d] **HY3-7d — 再查 router 和 top-k 精度。** 输出前缀已对齐后才核对 MoE router、top-k、softmax 和 reduction dtype；只提高某一层精度必须有 logit/token 差异证据，不能全模型盲目 fp32。
- [HY3-7e] **HY3-7e — 最后区分可修差异和架构差异。** 已关闭 processor、VAE 和 router 等可修边界后，再评估 TP、paged KV、fused kernel 和 reduction order；没有证据不得承诺 bit-exact，也不能用“架构噪声”掩盖仍可修的差异。
- [HY3-5g] **HY3-5g — ImageKVCacheManager 必须可被 paged KV discovery 注册且按最大图输入 profile**
  - 触发：修改 HunyuanImage3 的 `ImageKVCacheManager`、image attention 注册、paged KV role/dtype，或为 `paged_scheduler` 调整启动 memory profile 与参考图数量。
  - 强制：`ImageKVCacheManager` 必须是 `nn.Module` 并以 `forward` 暴露内部 attention，使其出现在 `named_modules()` 而不把 dense cache state 写入 `state_dict()`；内部 attention 必须显式设置 `paged_kv_cache_role="primary"` 与 `paged_kv_cache_dtype=torch.bfloat16`，该 KV dtype 独立于权重加载 dtype。
    - paged 启动 profile 必须经过模型 owner preprocessing，使用 1024x1024、启用 CFG 和 metadata 声明的最大参考图数量，当前 HunyuanImage3 为 3 张；普通 dense warmup 仍保持独立的 512x512、无 CFG 路径。
  - 验收：模型测试断言 manager 是 `nn.Module`、attention identity 可从 `named_modules()` 读回且 `state_dict()` 为空；spec discovery 断言 layer、role、BF16 dtype 与 layout capability；profile 后必须清除 dense `image_kv_cache_map/lens` 再 sizing/physical allocation。^[PR #6094] ^[PR #6563]
- [HY3-8a] **HY3-8a — HunyuanImage3 硬件优化层必须保持平台回退、checkpoint 与 VAE 内存边界**
  - 触发：修改 HunyuanImage3 的 `layers/`、VAE/DiT `ResnetBlock`/`ResBlock`、patch embedding 相关块、平台分派、VAE 高分辨率内存策略或 cuDNN autotune。
  - 强制：由 `current_omni_platform.is_cuda()` 选择 `nvidia` 实现，其他后端保留 `native` 实现；两套 block 必须保持相同的公开构造与 checkpoint `state_dict` key 布局，NVIDIA 版本只能通过共享融合算子获得加速；高分辨率 VAE 必须由统一 VAE tiling 管理，任何允许 tiling 关闭的入口都要显式定义容量、回退或拒绝策略；`torch.backends.cudnn` 这类进程级标志应在 worker 边界配置，若保留 block 内临时设置则必须证明 forward 不会并发。
  - 验收：分别以 native/eager 与 CUDA/NVIDIA 实现覆盖 VAE、DiT 的真实 shape、dtype 和输出误差；验证旧 checkpoint 的 `state_dict` 加载与 key parity；对启用 tiling、关闭 tiling及直接 VAE 入口执行高分辨率容量/失败行为测试，并在并发 worker 或明确串行证明下验证 cuDNN 配置与恢复；性能数字只在固定模型、硬件、并行拓扑和 workload 下复测。^[PR #6306]
- [HY3-8d] **HY3-8d — Distil CFG 与 MeanFlow 是独立的 HunyuanImage3 diffusion 合同**
  - 触发：修改 `cfg_distilled`、`use_meanflow`、Hunyuan image layout/tokenizer、denoise/step execution、CFG、AR KV reuse，或相关 checkpoint loader。
  - 强制：两个 flag 独立决定 `<guidance>`、`<timestep_r>` placeholder 和对应 embedding；layout 的序列化、tokenizer output、prepared/step kwargs、CFG-parallel split 与 AR-KV truncate 必须完整携带并重基 scatter index。special-prefix 数量由 `num_special_tokens` 统一计算，decode final layer 从该数量之后取 latent，不能假定只有 timestep token。
    - `guidance_emb` 与 `timestep_r_emb` 由外层 `HunyuanImage3Pipeline` 创建、放到 execution device 并加载权重，不由 transformer-core loader 静默跳过。
  - 强制：`cfg_distilled=True` 时 `cfg_factor=1`，guidance 以 `guidance_scale * 1000` 写入 embedding；不得构造 negative prompt/prefill、外部 CFG combine 或 CFG parallel。`use_meanflow=True` 时每个 denoise step 注入 scheduler 的下一 timestep `r`；最后一个 step 的 `r` 必须为零。两项 flag 可以单独开启，不能把 MeanFlow-only 路径误当成 CFG-distil。
  - 验收：CPU 测试覆盖 guidance/timestep-r 四个 kwargs、1/2/3 special-prefix decode、AR-KV rebasing、MeanFlow-only CFG-parallel split，以及 step execution 的 single-row CFG-distil 和每-step `r`。准确性证据固定模型 artifact、BF16/硬件拓扑、seed、steps、guidance、prompt/reference 和各项 threshold；
    - 只报告实际运行的 online/offline/quant case，未运行的 quant 不得外推为通过。^[PR #4048]
- [HY3-5h] **HY3-5h — paged GQA 必须保留压缩 K/V，dense 路径保持扩展**
  - 触发：修改 HunyuanImage3 的 `ImageKVCacheManager`、Q/K/V head layout，或在 dense 与 Scheduler-managed paged attention 之间切换 GQA 处理。
  - 强制：HunyuanImage3 的 dense 路径继续把 K/V 从 8 个 KV heads 扩展到 32 个 Q heads；paged KV active 时必须保留原生压缩的 32Q/8KV 形状，由 native adapter/backend 消费 `num_heads=32` 与 `num_kv_heads=8`。
  - 验收：以实际 32Q/8KV geometry 覆盖 dense 与 paged 两条路径，断言 attention consumer 的 K/V shape 分别为 32 和 8，并覆盖 adapter 的 packed Q/K/V 与 native backend 调用；paged strict-Ulysses 还验证 padding restore 和 required `query_lens/image_mask/position_ids`。^[PR #6102] ^[PR #6563]
- [HY3-5i] **HY3-5i — paged Hunyuan 只描述模型 layout，runner 驱动请求级 execution**
  - 触发：修改 HunyuanImage3 `ImageKVCacheManager`、`full_attn_spans`、Scheduler-paged prefill/denoise 或 model/runner ownership。
  - 强制：model 仅提供 32Q/8KV Q/K/V layout 与每 sequence 的 `full_attn_spans`；runner 从 Scheduler snapshot 激活 rows。first prefill 写整个 allocated sequence，后续 denoise 只从 prefix offset 写 target；paged forward 前清除 model-owned dense prompt state。
  - 验收：覆盖 full-allocation prefill、prefix-offset target update、32Q/8KV、full-attention spans 与 dense prompt-state clear；正式证据限 GPU/NPU request execution，其他 execution/parallel contracts另测。^[PR #6563]

### [HY3-9a] `get_expert_mapping` 只返回上游 flat list，本地 remapping 必须分方法

- 触发：修改 HunyuanImage3 AR 或 DiT loader 的 `get_expert_mapping`、MoE expert params mapping、checkpoint `gate_proj`/`up_proj` remapping，或与 vLLM fused-MoE loader 的对接。
- 强制：公开 `get_expert_mapping()` 必须返回 flat `list[tuple[str, str, int, str]]`（非 MoE 返回 `[]`），供上游 loader 消费；Hunyuan checkpoint 的 `gate_proj`/`up_proj` → `gate_and_up_proj` 分片 remapping 只能放在独立的 `_get_expert_weights_remapping()`，由 `load_weights` 显式取用。AR 与 diffusion transformer 两侧同一合同。
- 验收：对 `HunyuanModel` 与 `HunyuanImage3Model` 断言 public mapping 为 flat list、local remapping 字典独立，并覆盖非 MoE 空返回。^[PR #7021]

### [HY3-10a] 文本-only chat 必须按请求标为 comprehension，不得走图像 stage 强制

- 触发：修改 HunyuanImage3 AR `sample()`、`engine_output_type="latent"` 的 generation 部署上的 chat completions、`SamplingParams.extra_args["ar_task_mode"]`，或 AR runner 向 custom sampler 转发 `extra_args`。
- 强制：任务模式是 per-request 属性。serving 对 modalities 仅为 text 的 chat 在普通 `SamplingParams` 上 `setdefault("ar_task_mode", "comprehension")`，不覆盖调用方显式值，也不标记 image/audio/video 输出请求。声明 `model_sampler_wants_extra_args` 的模型必须经共享 dispatcher 按 `req_ids` 顺序收到每行 `extra_args`。
  - comprehension 行只做无状态图像脚手架 token 屏蔽（含 `<cfg>`/`<img>`/`<timestep>`/`<joint_img_sep>` 等），禁止 `</think>→<recaption>` 等 generation stage 强制。
- 验收：混合 comprehension/generation batch、生产 chat 入口的 text-only 路由、GPU/NPU 转发与未标记行的 generation 行为保持不变。^[PR #6111]

## 决策与踩坑

- [HY3-5g] 禁止：保持 cache manager 为普通对象而期待 Worker spec discovery 找到嵌套 attention；把 paged KV 标记省略为默认 dense；只用一张参考图或关闭 CFG 生成 profile 后宣称容量覆盖最大请求；把 Scheduler-only `DiffusionKVRequest` 状态发送到 profile Worker execution。
- [HY3-8a] 禁止：在非 CUDA 平台导入或强制执行 NVIDIA block；把 Triton 可导入等同于所有平台支持；改变 `in_layers`/`out_layers` 等 checkpoint-facing module key；移除逐卷积内存保护后仍让 tiling-disabled 的高分辨率请求无条件执行；或在可能重叠的 forward 中修改进程级 cuDNN 标志。
- [HY3-8d] 禁止：用 `x[:, 1:, :]` 或固定 special-token 个数切 latent；只在 normal loop 而漏掉 step execution；AR prefix 截断后保留绝对 guidance/timestep-r index；漏传任一 embedding/scatter field；把 transformer 的 non-model skip list 当作外层 embedding 的加载路径。
- [HY3-5h] 禁止：在 paged adapter 中把已经压缩的 K/V 再扩成 Q heads，或为兼容 generic shape 在 adapter 内猜测并折叠重复 head；也不得让 paged 分支改变既有 dense 路径的输出布局。
- [HY3-5i] 禁止：model 分配 Scheduler blocks、激活 Worker runtime、复用 cross-request prefix，或在 paged path 接受 imported AR KV/negative CFG；不得把 request-mode 覆盖外推为 `denoise_step`、Ring 或 AllGather。
- [HY3-9a] 禁止：让 `get_expert_mapping()` 再返回 `(mapping, remapping)` 二元组，或把 Omni-local remapping 塞进上游期望的 public API。
- [HY3-10a] 禁止：仅凭引擎级 `engine_output_type` 让文本答案走图像 stage 转移；把 DiT scaffold token 漏进文本答案；破坏既有两参数 custom sampler 合同。
