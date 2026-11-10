---
name: style-bias-debug
description: 风格偏差（painterly / blur / 过饱和）类 bug 的调试流程：数值幅度漂移 vs 方向性 bias 两类及各自工具、四步标准流程（先静态 diff AR 版 vs DiT 版与 HF snapshot）、高 yield diff 区域（MoE routing 精度、Norm / RoPE dtype、attention mask、activation 顺序）、跨实现 PSNR 对比的显式对齐清单（必须 greedy）、反模式、painterly 二次踩坑（真因是 HunyuanFusedMoE 的 forward pre-hook 双调 process_weights_after_loading，最小修复 1 行）
metadata:
  scope: 只收 bias 类 bug 的方法、PSNR 对比口径和 HunyuanImage3 painterly 的归因教训；对齐 HF / greedy 不一致的前置排查归 alignment-debug，尺寸异常归 size-debug
---
# 风格偏差（style bias）调试标准流程

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/guides/style-bias-debug.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-16
- 调试模型输出 bias 类问题（painterly drift / blur / over-saturation / artistic style shift / quality regression）必须区分两类 bug，工具栈完全不同：

| 类型 | 表现 | 正确工具 |
|---|---|---|
| **数值幅度漂移** | 输出 inf/nan、tensor 全黑、saturation、梯度爆炸 | dump mean/std/min/max、看 forward 数值轨迹 |
| **方向性 bias** | 风格漂移、生成质量降低、视觉 painterly/blurry/over-cartoon、Top-k decision 偏 | **代码 diff vs known-good reference** —— mean/std 看不出来 |

- bias 类 bug 的指纹**不在 hidden_states 统计里**。MoE 的 expert dispatch / RoPE phase shift / activation 翻号这种偏差，每层数值都健康，但 expert 选错 / phase 错位 / 激活方向反，逐层累积成 attractor。
- **How to apply:**

### 标准流程

1. **第一步**：静态 diff vs HF reference / 自家 repo 的"known-good 副本"
   - repo 同时有 AR 版 + DiT 版模型 → **先 diff 这两个**（vllm-omni `model_executor/models/<model>/` vs `diffusion/models/<model>/`）。AR 那边修过的 bug 高概率 DiT 这边也有。
   - 然后 diff 自家 repo vs HF snapshot（`/mnt/models/.../snapshots/...`）的 modeling 文件
   - 任何字节级差异都列出来标注「数值等价 / 可能不等价 / 明显不等价」
2. **第二步**：「明显不等价」直接做最小消除实验 —— 改一处对齐 reference，跑一次 e2e
3. **第三步**：「可能不等价」做 tensor-level diff（同输入跑两边，逐 op 比 cosine/L∞）
4. **第四步**（兜底）：dump probe，主要排除「数值幅度爆炸」类 bug

### 高 yield 的 diff 区域（按优先级）

- 按"现实中踩过最多次"排序：
  1. **MoE routing 精度** —— 所有"训练时 fp32 routing"的 MoE（HunyuanImage3 / DeepSeek-V2/V3 / Qwen-MoE / Mixtral / Hunyuan-A52B）都吃这个坑
     - gate `params_dtype` 是不是 `torch.float32`
     - softmax + topk 是不是在 fp32 显式跑（不是默认 dtype 跟随 input）
     - 是不是有 `custom_routing_function` 绕开 vllm 的 BF16 `topk_softmax` CUDA op
     - gate 的 `quant_config` 是不是 None（量化模式下 gate 不能量化，否则 fp32 dtype 形同虚设）
  2. **Norm dtype** —— RMSNorm/LayerNorm 是不是 fused、是不是走 vllm IR 重写、reduction 是不是 fp32
  3. **RoPE freq dtype** —— freq 计算是不是 fp32、是不是在 model dtype 下应用、interleave 顺序
  4. **Attention mask 语义** —— transformers 4.x → 5.x 大版本里 mask kwarg 名（`attention_mask` vs `pixel_attention_mask`）/ dtype / 语义都改了
  5. **Activation 顺序** —— SwiGLU 的 silu(gate) * up vs silu(up) * gate，stacked_params_mapping 里的 0/1 顺序，HF concat 顺序

### 跨实现 PSNR 对比 fair-comparison checklist

- 跨实现（vllm-omni vs HF reference / 老 baseline / 不同 vllm 版本）跑 PSNR 前必须**显式对齐**这 9 项，不能依赖"默认值会一致"——HF model defaults 跟 vllm-omni stage_config defaults 各管各的，几乎从不一致：

| 参数 | 必须显式对齐 |
|---|---|
| prompt 字符串 | 字节级 |
| 输入 image bytes | 同一文件 |
| seed | 显式数字（=42） |
| **temperature** | **必须 0（greedy mode）** ← 消除 sampling RNG 差异 |
| **top_k** | **必须 1（greedy mode）** |
| top_p | 1.0 |
| **guidance_scale** | **显式传，不要靠 default**（HF default=2.5，vllm-omni stage_config 可能=5.0）|
| bot_task | think / think_recaption 一致（影响 chat template）|
| diff_infer_steps / num_inference_steps | 一致（=50）|
| output 分辨率 | 一致 / 一致 align 模式 |

### Painterly bug 实测案例

- vllm-omni HunyuanImage3 cr/pr3107-fix（vllm 0.20.0 + torch 2.11.0+cu130）：
  - 错的路径（5h GPU 时间烧完）：rebase + 6 个数值 dump probe + 3 个 cond ablation + cuDNN stability flag
  - 对的路径（30min）：单 Explore agent 静态 diff `vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py:HunYuanSparseMoeBlock` vs `vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:HunyuanImage3SparseMoeBlock` —— 当场看到 `params_dtype=torch.float32` 在 model_executor 有、
    - diffusion 没
- 详情见 [[painterly-overview]]（HunyuanImage3 Painterly 错题）。

## 决策与踩坑

- **Why:** painterly bug 实测：vllm-omni HunyuanImage3 cr/pr3107-fix 上跑 6 个 BUG-PROBE dump（VAE encode / instantiate / patch_embed），**每个数值都健康**——mean/std/min/max 全部 reasonable。但最终输出 painterly。dump 工具栈在这类 bug 上**信息量为零**。

### 跨实现 PSNR 对比 fair-comparison checklist

- **为什么必须 greedy mode**：sampling-mode 下 vllm-omni（多进程 NCCL RNG）跟 HF（单进程 CPU/GPU RNG）的 RNG state 推进**根本不一样**，相同 seed 在两侧 sample 出**不同 token sequence**。32 层 DiT × top-k=8 expert dispatch + AR 上千 token 的 sampling 累积 → 出图布局完全不同（看起来像"DiT 有问题"，其实是 AR sampling 漂移）。
  - Greedy mode 让 AR token byte-deterministic，剩下只有 DiT cross-impl drift（25-35 dB PSNR floor）。
- **Sampling mode 跨实现的 PSNR floor 是 5-15 dB**（lastwords 多次实测）。看到这个数字**不要声称"DiT 有问题"或"painterly 没修干净"** —— sampling 模式就这水平。要想验证 DiT 修复必须切 greedy。

### 反模式

- ❌ 视觉症状导向假设 → 只走那一条路。"rectangle painterly 肯定是 cond image 通路" → 沉到 conditioning 调研。但 layer-wise routing bias 也能产生同样症状。
- ❌ "shared infra 回归"框架 → 把所有时间花在 cuDNN flag / SDPA backend / autocast dtype 这些 stability 旋钮上。**这些对 bias 类 bug 通常无效**。
- ❌ Prior session "已证伪"标签 → 当成组件清白。**只对具体 hypothesis 成立**，不代表整个组件没 bug。dtype bug 跟 routing 传参 bug 是不同 bug。
- ❌ "Several teams 都遇到这个 bug" → 推断"共享底层 infra 问题"。**可能只是几个团队都漏了同款 fix**。
- ❌ 数值 dump 显示健康 → 误以为这层没问题。bias bug 不写在统计里。

### 找到代码差异 ≠ 找到 bug 机制（painterly 二次踩坑）

- painterly 调试中我做对的：通过 model_executor vs diffusion 静态 diff 找到了**正确的代码区域**（MoE block）。我做错的：把 diff 出的所有差异（FP32 gate dtype / SharedFusedMoE class swap / custom_routing_function / external fp32 forward / quant=None）一次性 patch 上去，跑出 cartoon 后**理所当然**把功劳给了"语义上跟 cartoon 强相关"的 FP32 routing 路径。
- **实际真正起作用的是 class swap 副作用** —— 删掉了 `HunyuanFusedMoE` wrapper 里的 `register_forward_pre_hook(_initialize_kernel_hook, ...)`。这个 hook 在第一次 forward 调 `quant_method.process_weights_after_loading(self)`，但 vllm 0.20 standard model loader 在 init 时**已经**调过一次（base_loader.py:80）。
  - `process_weights_after_loading` 不是 idempotent，双调用破坏 weight layout → painterly。
- 模型 model_executor 那版跑得对**也不是因为它写了 FP32 routing**，而是因为它没用 `HunyuanFusedMoE` wrapper（直接用 `SharedFusedMoE`），同样避开了 hook bug。
- **最小修复 = 1 行**（注释掉 `hunyuan_fused_moe.py:32`）。我的 30+ 行 patch 是过度归因 + cargo culting model_executor 那版 FP32 pipeline。

#### 教训

1. **多变量同时改 → 不能独立归因**。跑通了别立刻声称"找到根因"。先做最小消除实验（每处改动单独 revert，看哪处真正起作用）。
2. **找到代码差异 ≠ 找到 bug 机制**。差异 → 假设 → **隔离实验** → 才确认机制。这一步我跳了。
3. **"成功修复"的反思也可能是错的**。成功是结果，机制要单独验证。我之前落盘"FP32 routing fix"作为成功故事，结果机制都解释错。
4. **先看接口/继承结构差异，再看实现差异**。我对比了实现细节（dtype / softmax 精度），但没对比**继承自哪个 class** —— 一个用 `HunyuanFusedMoE`（带 hook 子类），一个用 `SharedFusedMoE`（裸基类），这是最基本的差异，我没看到。
