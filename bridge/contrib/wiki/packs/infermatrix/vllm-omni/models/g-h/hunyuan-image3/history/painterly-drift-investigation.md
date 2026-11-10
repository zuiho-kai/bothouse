---
name: painterly-drift-investigation
description: HunyuanImage3 IT2I painterly 漂移调查（cr/pr3107-fix，4 卡 L20X）：卡通输入被画成油画笔触的现象与复现配置、十余项已排除嫌疑及证据（MoE gate、FA3/SDPA、VAE 精度、SigLIP2 std=0.06 为模型设计）、仍活着的四个嫌疑、BUG-PROBE 探针 env var 与诊断套路
metadata:
  scope: 只收 painterly 漂移的现象、复现、排除证据、未决嫌疑与探针；已定位的根因与错题记录归 hunyuan-image3-incidents-overview，AR 与 HF 对齐方法归 hf-omni-alignment-method-1、hf-omni-alignment-method-2
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/painterly-drift-investigation.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### 现象

- **输入**：1024x1024 扁平卡通（彩色矩形 + 黑色锐边 + 浅蓝纸背景）+ prompt `"Add a cute orange cat sitting in the foreground."`
- **期望**（HF transformers `model.generate_image()` 跑同 prompt+seed）：保持卡通风，加进去一只扁平卡通橙猫
- **实际**（vllm-omni cr/pr3107-fix）：
  - 猫毛是 painterly 油画笔触
  - 矩形边缘水彩晕染
  - 背景变成纸纹
  - 整体像是套了一层油画滤镜
- **关键观察**：
  - 加 `"flat cartoon style, no painterly"` 到 prompt → **猫**变得明显更卡通（平涂橙色身体），但**矩形+背景** painterly 锁死
  - 这个分裂提示：**猫由 text 驱动（prompt 能影响），矩形由 cond image 驱动（不受 prompt 影响）**

### 复现配置（4 卡 L20X 单机）

- 服务器：`<REMOTE_HOST>:31469`（root），4× L20X 143GB，CUDA 13/PyTorch 2.11/vllm 0.20/transformers 5.7
- `/tmp/hunyuan_image3_it2i_4gpu.yaml`（AR=devices "0,1" TP=2 + DiT=devices "2,3" TP=2，无 KV reuse）
- `/tmp/cartoon_input.png`（test fixture：seed=42 的彩色矩形测试图，跟 `tests/e2e/accuracy/test_hunyuan_image3_it2i.py:condition_image` 同款）

```bash
export HF_HOME=/mnt/models HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
/rebase/.venv/bin/python examples/offline_inference/hunyuan_image3/end2end.py \
    --modality img2img \
    --image-path /tmp/cartoon_input.png \
    --prompts "Add a cute orange cat sitting in the foreground." \
    --stage-configs-path /tmp/hunyuan_image3_it2i_4gpu.yaml \
    --steps 30 --guidance-scale 5.0 --seed 42 \
    --enforce-eager
```

### 已排除的嫌疑（带证据）

| 嫌疑 | 怎么测的 | 结论 |
|---|---|---|
| **MoE gate routing** | 读 vllm 0.20 `MoERunner._forward_impl` 源码：`if self.gate is not None: router_logits, _ = self.gate(hidden_states)` | cr/pr3107-fix 传了 `gate=self.gate`，runner 内部强制重算，外部传 `router_logits=hidden_states` 被覆盖 → routing 正确 |
| **`WeightsMapper` 类属性** | inspect `AutoWeightsLoader.load_weights` 源码：只在显式 `mapper=` kwarg 时使用 | cr/pr3107-fix 没传 mapper，类属性是死代码，weight loading 走的是 `hunyuan_image3_transformer.py:load_weights` 显式逻辑 |
| **FA3 (`fa3_fwd 0.0.3`)** | `grep "diffusion attention backend" /tmp/it2i_run*.log` | `pipeline_hunyuan_image3.py:341` 硬编码 `os.environ["DIFFUSION_ATTENTION_BACKEND"] = "TORCH_SDPA"`，FA3 根本没被调（**注意：曾因主观对比图误判 "FA3 是 bug"，必须先 grep 实际 backend**） |
| **SDPA dispatch backend** | 用 `torch.nn.attention.sdpa_kernel([SDPBackend.MATH])` 强制 Math kernel 重跑 | 一样 painterly。Flash/MemEfficient/Math 都不是 bug 源 |
| **VAE decode 精度** | dump VAE 输入 latent，FP32 离线重解码（`probe_decode_latent_fp32.py`） | painterly 跟 BF16/FP16 路径**视觉一致**。VAE 只是忠实解码 painterly latent |
| **VAE encode 精度** | `pipeline_hunyuan_image3.py:649` 把 FP16 autocast 改 BF16 重跑 | 矩形仍 painterly。VAE encode 精度不是 bug |
| **MoE expert 权重加载** | 三方核对：HF ckpt forward `x1*silu(x2)` → x1=up（first half）/x2=gate（second half）；cr/pr3107-fix `expert_weights_remapping={"gate_proj":(...,1,2),"up_proj":(...,0,2)}`；vllm 0.20 `_load_w13` shard_id="w1"→[:half]/"w3"→[half:]。三处对得上 | 链路全对，不是错位 |
| **SigLIP2 输出"坍缩"** | 独立测 transformers 5.x `Siglip2VisionModel` vs HF snapshot bundled `Siglip2VisionTransformer`，相同输入相同权重 | 输出 std=0.06015 vs 0.06015，diff mean=0.00003 → **std=0.06 是模型设计行为不是 bug**。2 个实现数值等价 |
| **SDPA 在 PyTorch 2.11 选了不同 kernel** | 强制 MATH backend（`sdpa_kernel([SDPBackend.MATH])`） | 仍 painterly |
| **VAE 有 inf/NaN** | dump 最终 latent 测 stats：min=-7.7 max=8.6 mean=-0.33 std=1.42 | 健康，无 inf/NaN |
| **某一步 denoise 突跳** | 30 步 latent 全 dump，看 std/min/max 走势 | 单调平滑（lat_std 从 0.99 → 0.78 → 回 0.85），无突跳。painterly 不是单 step bug |

### 几个值得记住的中间数据

- **Per-step latent stats（IT2I run8）**：lat_std 单调下降（0.99 → 0.78），pred_std 稳定（1.5-1.7）。step 15（t=738）的 latent FP32 解码已能看到 painterly 猫雏形 → painterly 从 DiT 输出一开始就在轨迹里，不是末几步加进去的
- **SigLIP2 layer-wise hook**（`probe_siglip_input.py`）：

| layer | std | per-channel std mean | 注 |
|---|---|---|---|
| embeddings | 1.09 | 0.63 | 健康 |
| layer 0 | 2.07 | 0.63 | 健康 |
| layer 5 | 1.57 | 0.51 | 健康 |
| layer 10 | **90.85** | 0.64 | 残差累积，channel 间 mean 大但 channel 内 std=0.64 仍正常 |
| layer 26 | 129.72 | 0.64 | encoder 末尾 |
| **post_layernorm** | **0.06** | 0.003 | **看似坍缩**——但 HF bundled siglip2 同款行为，是模型设计 |

- LayerNorm 把 channel 间 mean 洗掉，留 channel 内 0.64 std → output overall std=0.06，1119/1152 channel 跨 token std<0.01。**这是该模型 SigLIP2 post-LayerNorm 的 vanilla 行为**，HF 参考也这么跑，不是 bug。

### 还活着的嫌疑（按可能性排序）

1. **AR 生成的 CoT 文本**：vllm-omni AR 跟 HF AR 输出可能不字节一致，AR thinking 偏向 painterly 关键词会让 DiT 跟着画。**没 dump 过实际文本对比** —— 下次先补这个
2. **PyTorch 2.11 + CUDA 13 conv kernel**：`patch_embed`（`HunyuanImage3Text2ImagePipeline.instantiate_vae_image_tokens` 用的 conv）的 kernel 选择可能改了；VAE conv 已侧面排除（FP32 重建），但 patch_embed conv 没单独测
3. **`vae.use_spatial_tiling = self.od_config.vae_use_tiling`**（`pipeline_hunyuan_image3.py:349`）：cr/pr3107-fix 新加这行，母分支 PR #2949 用 VAE 默认值。需要单独跑 `--no-vae-tiling` 对比
4. **NCCL TP=2 all-reduce 累积**：30 step × N layers × all-reduce 顺序差异；理论上 TP=1（单卡）能排除 —— 但 80B 模型单卡装不下

### 探针 patch（已就位在 `/rebase/vllm-omni/`）

- 所有 dump 都用 env var gate，不影响 baseline 行为：

| Env var | 改了哪 | 输出 |
|---|---|---|
| `VLLM_OMNI_DUMP_LATENT_DIR` | `hunyuan_image3_transformer.py:2890` 前 | `latents_pre_vae_decode.pt` + stats 打到 stdout |
| `VLLM_OMNI_DUMP_STEP_DIR` | `hunyuan_image3_transformer.py:scheduler.step` 后 | `latents_step{i:03d}.pt` + `pred_step{i:03d}.pt`（仅 rank0） |
| `VLLM_OMNI_DUMP_VIT_DIR` | `pipeline_hunyuan_image3.py:instantiate_vit_image_tokens` + `_encode_cond_image` | `vit_raw_lhs.pt` / `vit_aligned.pt` / `cond_vae_latent.pt`（仅 rank0） |
| `VLLM_OMNI_DUMP_COT` | `pipeline_hunyuan_image3.py:forward` 拿到 `cot_text_list` 后 | `/tmp/cot_text_req{i}.txt` + 前 800 字符打 stdout |

- 注意 patch 之间不冲突，但**当前残留几个改变行为的 patch 还没回退**（VAE encode/decode FP16→BF16），下次回头要先 `grep BUG-PROBE` 审计。

### 复用的诊断套路（推荐顺序）

1. **先复现 + 拿到稳定 dump pipeline**（拿 latent + cond 编码 + AR 输出）
2. **离线 FP32 重建排除精度**（`probe_decode_latent_fp32.py` 模式）—— 把 VAE 排出去前别动 DiT
3. **跨实现等价性 check**（比如 SigLIP2：transformers 5.x vs HF bundled），独立 python 脚本，1 张图、1 套 weights、几行 stat → 5 分钟搞定
4. **layer-wise hook**（`probe_siglip_input.py` 模式）+ stat 打印，让 std/mean/zero_chans 自己说话
5. **看 logger 而不是看图**：FA3/SDPA 哪个被调，先 `grep "diffusion attention backend" log`，别靠肉眼对图

### 相关 PR / commit 上下文

- 母分支 `_kc_probe/ar-dit`（PR #2949）：vllm 0.19 时代能跑出卡通
- cr 分支 `cr/pr3107-fix`：适配 vllm 0.20 + transformers 5.x，本文调研对象
- 网上同步 PR：另一位 contributor `@Bounty-hunter` 提议把 `transformers.Siglip2VisionModel` 换成本地 `vllm_omni.model_executor.models.hunyuan_image3.siglip2.Siglip2VisionTransformer` —— **数值等价**（已实测），swap 既不修复 painterly 也不引入新问题，纯风格选择
