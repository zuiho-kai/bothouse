---
name: alignment-debug
description: "vllm-omni 对齐 HF baseline / greedy 输出不一致的调试坑合集（HunyuanImage3 实证）：先 grep randn / .sample( / Generator / manual_seed 等显式随机源（_vae_encode 未传 generator 的案例）、改 <img> / <timestep> placeholder 前读完 embedding routing、input_ids 文本对齐不等于输出对齐、中-高风险改动先深 dive、差异源 6 行拆账表（PR #2713 把全部归为 BF16 噪声的教训）"
metadata:
  scope: 只收输出对齐与 greedy 不一致两类 bug 的排查顺序和踩坑；风格 bias 类的静态 diff 流程归 style-bias-debug，同 seed 仍漂移的审计归 seed-determinism-audit，跨路径系统性偏差的分类归 systematic-vs-stochastic
---
# 对齐调试：先 grep 显式随机源，不是直奔 MoE/attention

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/guides/alignment-debug.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-16
- 调"vllm-omni 输出与 HF baseline 对齐"或"greedy 每次跑结果不一致"两类 bug 时反复踩的坑合集。`style_bias_debug_methodology.md` 是更深一层的"风格 bias 类"专题，先看完这里再过去。

### 1. 第一步：grep 显式随机源，不是直奔 MoE/attention

- 调 vllm-omni 对齐 HF / greedy 输出每次跑结果不一致这两类 bug 时，**第一步必须先全量 grep 显式随机源**，不要直奔 MoE / attention / RoPE 这些"传统嫌疑链"。
- **How to apply**：
  1. 拿到"对齐"或"greedy 不一致"问题，**第一个动作**是：

     ```
     Grep "randn|\.sample\(|torch\.Generator|manual_seed|dropout|noise" 在模型实现 + multimodal preprocessing 路径
     ```

  2. 找到的每个调用点跟 HF 对照：HF 是否传了 generator / 是否在 eval 模式下被 gate / 是否用 deterministic=True 旁路
  3. 只有这一遍扫干净没有遗漏，再去看 MoE routing dtype、attention backend、TP allreduce 顺序、bf16 atomic 这些"二阶"嫌疑
  4. **带图 vs 纯文本路径要分开判断**：纯 T2T 不走 vae_encode，看到"AR greedy 不稳定"先问清楚是带图（I2T/IT2I）还是纯文本（T2T），结论完全不同
  5. 让用户帮忙复现时要求记录 **第一个分歧的 token 之前的 prefix 长度**——分歧出现在图像 token 紧后，是 VAE/multimodal embedding 这条；几十 token 之后才漂，才是 TP/atomic/kernel 这类二阶因素

### 2. 改 multimodal placeholder token 前必须先读完整条 embedding routing

- **症状**：看到 vllm-omni 用 `<img>` (128006)、HF 用 `<timestep>` (128017) 在同一个 slot，**很自然地想"换一下 token id 就对齐了"**。
- **实测**：会话里两次单点改都崩坏（模型幻觉 image_2..9）：
  - 第一次：line 1066 直接 `<img> → <timestep>` → 崩
  - 第二次："Plan A"换了 token + 同时删掉 `combined_embeddings` 里的 timestep_emb，让 `<timestep>` 走 wte lookup → 还是崩
- **How to apply:** 改 placeholder token id 前，**沿着 forward 链路读完**：tokenize → input_processor → `_get_prompt_updates` → `_merge_multimodal_embeddings` → 模型 forward。任何一处对原 token id 有依赖都要联动改。读不完就别改。

### 3. "input_ids 文本部分 byte-identical" ≠ "输出对齐"

- **症状**：BPE fix 后验证前 1227 个文本 token 与 HF byte-identical → 满怀期待跑模型 → greedy 输出仍在第 6 字分叉、sampling 输出仍 2x HF 长度。
- **How to apply:** 对齐 input 之后还要分别审计：(a) image segment token 结构、(b) image embedding 数值、(c) sampler 实现差异。任何一项不对齐都吃掉前面 input 对齐的成果。要 byte-identical output 必须三者全对，缺一不可。

### 4. plan 里标"中-高风险"的改动应该先做深 dive，不是先改后撤

- **症状**：本会话做的 step 2（`<timestep>`）和 step 3（dtype cast）**都改了又撤**——最终 commit 是 docs-only。
- **How to apply:** plan 里任何标"中-高风险"的改动，在 Phase 1 探索阶段就要把目标 forward path 完整读到末端（而不是只读改动点附近 50 行）。读完写"实际改法"不一定和 plan 里预想的一样——很可能发现"现状已经等价 HF"或"必须深做才能改"，两种情况都比"先改后撤"省时。

### 5. 遇到"难修的差异"先拆账目，不要笼统归因到 BF16/noise

- **症状**：会话早期把所有 vllm-omni vs HF 输出差异都说成"BF16 数值噪声"。直到深挖才发现 BF16 只占很小一部分。
- **实际差异源拆账**（HunyuanImage3 IT2I 实证）：

| 差异源 | 是 BF16 噪声吗 | 量级 | 会不会自动消失 |
|---|---|---|---|
| prompt 格式 bug（trigger 位置错） | ❌ | 100% 错对话角色 | 不会，必须修 prompt 模板 |
| BPE 跨段 merge | ❌ | 1-2 token 偏移 | 不会，必须分段 tokenize |
| image placeholder routing | ❌ | embedding 层错 | 不会，必须审计 routing |
| Siglip2 normalize（transformers 版本差） | 部分 | 1e-3 ULP 数值差 | 不会，受版本约束 |
| vllm sampler ≠ transformers sampler | ❌（是实现差） | 同 seed 不同 RNG 流 | 不会，受架构约束 |
| TP 多卡 BF16 reduction order | ✅ 真 BF16 | 1 ULP | 不会，但只在平局影响 |

- PR #2713 当时把这 6 项**全归为"BF16 multi-GPU non-determinism"**，用一句"first 30 token matched"做合格线，结果死循环 garbage 这种**100% 错的代码 bug** 也被一起糊弄过去了。
- **How to apply:** 任何"omni vs HF 输出差异"的归因开始**必须按上面的 6 行表逐项排除**：先改 prompt 格式 → 再改 BPE → 再审 image routing → 数值差异和 sampler 差异留到最后再说。归因到"BF16/noise"前先证明**不是确定性 bug**。

## 决策与踩坑

### 1. 第一步：grep 显式随机源，不是直奔 MoE/attention

- **Why**：HunyuanImage3 AR 带图 greedy 不一致的实际 root cause 是 `_vae_encode` 在 `latent_dist.sample()` 没传 `generator`（`hunyuan_image3.py:1719`），HF 对应位置传了 `manual_seed(seed)` 构造的 generator（`modeling_hunyuan_image_3.py:2437`）。VAE latent 每次 prefill 重抽 → 图像 embedding 漂移 → 下游 greedy argmax 在边界 token 翻位。
  - 第一轮 Explore agent 走的是 MoE FP32 routing / sampler / attention backend 嫌疑链，但 MoE 早已修过，绕一圈才回到 VAE。如果开头先 grep `randn|\.sample\(|Generator|manual_seed|dropout` 一秒锁定。

### 2. 改 multimodal placeholder token 前必须先读完整条 embedding routing

- **根因**：HF 在 `<timestep>` 位置用 `instantiate_continuous_tokens` **scatter 替换** embedding 为 `timestep_emb(0)`（`hunyuan3.0_ins/modeling_hunyuan_image_3.py:1964`），不是简单走 wte。vllm-omni 在 `<img>` 位置用 `_merge_multimodal_embeddings` 注入 timestep_emb，**embedding 层等价 HF**——只是 dump 出来的 token id 不同。
- **Why:** 哪怕看似"换个数字"的改动，在多模态 routing 里都可能联动 N 处（embed_token_id selector / scatter 索引 / position id 分配 / attention mask）。

### 3. "input_ids 文本部分 byte-identical" ≠ "输出对齐"

- **根因**：因果注意力让**任何中间位置的 1 个 token 差 + 1 个 BF16 ULP embedding 差**都通过 KV cache 传播到所有下游位置。文本前缀对齐只解决了"序列开头几位"，模型实际看到的"输入"还有 5000+ image tokens 段（vllm-omni 与 HF 在 token 类型 + 数值上都不完全等价）。

### 4. plan 里标"中-高风险"的改动应该先做深 dive，不是先改后撤

- **根因**：写 plan 时知道这两步"风险中-高"，但还是按 plan 顺序"先改一下试试"。结果：
  - step 2 改了 → 跑 → 崩 → 看 HF 代码 → 发现误解 → 撤
  - step 3 改了 → 跑 → conv3d 报错 → 想起 vllm-omni `_vae_encode` 不 auto-cast → 撤

### 5. 遇到"难修的差异"先拆账目，不要笼统归因到 BF16/noise

- **Why:** "BF16 不可对齐"是真命题，但用它当所有问题的兜底借口 = 永远查不到根因。本会话的 prompt 格式 bug、BPE 边界 merge、image routing 都是确定性的代码问题，不是数值噪声，全可修。
