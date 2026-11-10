---
name: hf-baseline-runbook-1
description: HunyuanImage3 HF baseline runbook 前半：环境要求（transformers==4.57.1、torch==2.8.0+cu128、config.json 补 model_version instruct），必修的两个模型代码 bug（RoPE 广播导致 key/value size 不匹配、CFG 2D attention_mask 传给 SDPA）的症状、根因、fix 与自动 patch 脚本，generate_image 的参数陷阱（diff_infer_steps 要改 generation_config、cot_text 跳过 AR、guidance_scale kwarg 泄漏）
metadata:
  scope: 只收 HF baseline 的环境要求、两个必修 bug 的 patch 和 generate_image 参数陷阱；torch.profiler 只包 denoising loop 的做法、vllm-omni profiler 注意事项、device_map 说明和完整运行顺序归 hf-baseline-runbook-2
---
# HunyuanImage3 HF baseline runbook（1/2）

## 关键事实

- 拆分说明：本页是源页 `hf-baseline-runbook.md` 的第 1/2 部分；第 2 部分 [[hf-baseline-runbook-2]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/hf-baseline-runbook.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### 环境要求

- transformers==4.57.1（官方 requirements.txt 指定版本）
- torch==2.8.0+cu128, torchvision==0.23.0（必须一起 pin，不能单独装 torchvision）
- einops, diffusers==0.35.2
- `config.json` 里必须有 `"model_version": "instruct"`（原始 config 缺这个字段，需手动补）

### 必修 Bug Fix（不修就崩）

- 模型代码有两个 bug，必须 patch **snapshot + cache 两个文件**：
- **文件位置**（以实际 traceback 为准）：
  - Snapshot: `$HF_HOME/hub/models--tencent--HunyuanImage-3.0-Instruct/snapshots/<hash>/modeling_hunyuan_image_3.py`
  - Cache: `~/.cache/huggingface/modules/transformers_modules/_<hash>/modeling_hunyuan_image_3.py`

> 注意：`HF_HOME` 不同时 cache 路径也不同。先跑一次看 traceback 确认实际路径再 patch。

#### Bug 1: RoPE 广播导致 key/value size 不匹配

- **症状**: `RuntimeError: Expected key.size(1) == value.size(1) to be true, but got false`
- **根因**: CFG unconditional 路径 `position_ids=None`，cos/sin `[1, max_pos_emb, head_dim]` 广播把 key 从 `[...,1,...]` 扩到全长，value 不过 RoPE 保持 1。
- **Fix**: `apply_rotary_pos_emb` 函数（约 line 547），在 `position_ids is not None` 分支后加 else：

```python
    if position_ids is not None:
        cos = cos[position_ids]
        sin = sin[position_ids]
    else:
        seq_len = q.size(-2)
        cos = cos[..., :seq_len, :]
        sin = sin[..., :seq_len, :]
```

#### Bug 2: CFG 2D attention_mask 传给 SDPA

- **症状**: `The expanded size of the tensor (1) must match the existing size (2) at non-singleton dimension 3`
- **根因**: transformers 4.57.1 的 `UnbatchedClassifierFreeGuidanceLogitsProcessor` 传 2D `[1, N]` padding mask，SDPA 期望 4D。
- **Fix**: `HunyuanImage3SDPAAttention.forward`（约 line 1362），在 SDPA 调用前加：

```python
        if attention_mask is not None and attention_mask.ndim == 2:
            attention_mask = None
```

#### 自动 Patch 脚本

```python
#!/usr/bin/env python3
"""Patch HunyuanImage3 model bugs. Run ONCE after model download."""
import sys

SNAP = "<snapshot_path>/modeling_hunyuan_image_3.py"  # 填实际路径
CACHE = "<cache_path>/modeling_hunyuan_image_3.py"    # 填实际路径

# Bug 1: RoPE broadcast
ROPE_OLD = """    if position_ids is not None:
        cos = cos[position_ids]
        sin = sin[position_ids]

    cos = cos.unsqueeze(unsqueeze_dim)"""
ROPE_NEW = """    if position_ids is not None:
        cos = cos[position_ids]
        sin = sin[position_ids]
    else:
        seq_len = q.size(-2)
        cos = cos[..., :seq_len, :]
        sin = sin[..., :seq_len, :]

    cos = cos.unsqueeze(unsqueeze_dim)"""

# Bug 2: 2D attention_mask
MASK_OLD = """        if attention_mask is not None and not attention_mask.is_floating_point() and attention_mask.dtype != torch.bool:
            attention_mask = attention_mask.to(query_states.dtype)
        attn_output = torch.nn.functional.scaled_dot_product_attention("""
MASK_NEW = """        if attention_mask is not None and attention_mask.ndim == 2:
            attention_mask = None
        if attention_mask is not None and not attention_mask.is_floating_point() and attention_mask.dtype != torch.bool:
            attention_mask = attention_mask.to(query_states.dtype)
        attn_output = torch.nn.functional.scaled_dot_product_attention("""

for path in [SNAP, CACHE]:
    with open(path) as f:
        code = f.read()
    patched = False
    if ROPE_OLD in code:
        code = code.replace(ROPE_OLD, ROPE_NEW); patched = True
    if MASK_OLD in code:
        code = code.replace(MASK_OLD, MASK_NEW); patched = True
    if patched:
        with open(path, 'w') as f: f.write(code)
        print(f"Patched: {path}")
    else:
        print(f"Already patched or pattern mismatch: {path}")
```

## 决策与踩坑

### 关键参数陷阱

#### diff_infer_steps 不是 generate_image 的 kwarg

```python
# ❌ 错误：不生效，模型用默认 50 步
model.generate_image(prompt=..., diff_infer_steps=10)

# ✅ 正确：改 generation_config
model.generation_config.diff_infer_steps = 10
model.generate_image(prompt=...)
```

#### cot_text 跳过 AR 阶段

- `generate_image` 接受 `cot_text` 参数（list of str），传入后跳过 AR thinking/recaption 生成，直接进 diffusion。

```python
# 第一次跑拿 cot_text
cot_text, samples = model.generate_image(prompt=..., verbose=0)
# 后续跑直接传 cot_text，跳过 AR（省 5-7 分钟）
_, samples = model.generate_image(prompt=..., cot_text=cot_text)
```

> 注意：即使传了 cot_text，模型仍需做 AR prefill（处理 system prompt + cot_text），只是不再生成 thinking 文本。

#### guidance_scale 的 kwarg 泄漏

- `generate_image(guidance_scale=5.0)` 会通过 `**kwargs` 泄漏到 gen_text 阶段的 `super().generate()`，触发 transformers 的 `UnbatchedClassifierFreeGuidanceLogitsProcessor`。这是模型代码的 bug，上面两个 fix 已经兜住了。
