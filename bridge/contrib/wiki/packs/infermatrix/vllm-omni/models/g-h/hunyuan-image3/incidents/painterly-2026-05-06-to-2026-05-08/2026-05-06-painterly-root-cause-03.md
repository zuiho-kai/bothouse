---
name: 2026-05-06-painterly-root-cause-03
description: 2026-05-06 对 painterly 根因的事实更正（同事 review）：真正修复是把 HunyuanFusedMoE swap 成 SharedFusedMoE 时间接删掉 hunyuan_fused_moe.py:32 的 _initialize_kernel_hook forward pre-hook，该 hook 让 process_weights_after_loading 被 loader 之后再调一次而破坏 weight；最小修复为删一行，以及多处同改不能归因的教训
metadata:
  scope: 只收被更正后的真正机制、最小修复与归因教训；被推翻的 FP32 routing 第一版结论归 2026-05-06-painterly-root-cause-01，调查路径元复盘归 2026-05-06-painterly-root-cause-02
---
# 2026-05-06 — 我的 FP32 routing 根因解释**也是错的**：真正的 bug 是 `process_weights_after_loading` 双调用

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-root-cause-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-root-cause-03`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：我的 FP32 routing 根因解释**也是错的**：真正的 bug 是 `process_weights_after_loading` 双调用
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **事实更正**（同事 review 后指出）：painterly 的真正修复不是"FP32 routing 对齐 HF"，而是 patch 副作用 —— 把 `HunyuanFusedMoE` swap 成 `SharedFusedMoE` 时**间接删除了 `_initialize_kernel_hook` forward pre-hook**。
- **真正的 bug 机制**：
- `vllm_omni/diffusion/models/hunyuan_image3/hunyuan_fused_moe.py:32`:

```python
self._init_hook_handle = self.register_forward_pre_hook(self._initialize_kernel_hook, with_kwargs=True)
```

- 这个 hook 在第一次 forward 时跑 `self.quant_method.process_weights_after_loading(self)`。
- 但 vllm 0.20 standard model loader (`base_loader.py:80`) 在加载完 weights 后**已经**调过一次 `process_weights_after_loading`。vllm 内部用 `_already_called_process_weights_after_loading` flag 防双调，但**`HunyuanFusedMoE` hook 直接调 `quant_method.process_weights_after_loading(self)` 绕过了 layer-level flag** → 双调用。
- `process_weights_after_loading` 不是 idempotent —— 第二次基于已 packing/quantize 过的 weight 状态再 process，破坏 weight layout / scale / 分块 → expert MLP forward 用错 weight → 32 层逐 token 累积 → painterly bias。
- **为什么我的 30+ 行 patch 修了**：里面**唯一起作用**的是 class swap `HunyuanFusedMoE` → `SharedFusedMoE`（= 原 `FusedMoE`，没有 wrapper 子类的 hook） → 没有重复 hook → weight 没被双重 process → painterly 消失。
- **我归因错的过程**：
  - 我同时改了 5 处：(1) gate `params_dtype=fp32` (2) `quant_config=None` (3) class swap (4) `custom_routing_function` (5) external fp32 forward 重写
  - 跑出来 cartoon → 我**理所当然**把功劳给了"看起来 cartoon-related 的 FP32 routing"路径
  - 实际起作用的是 (3) class swap 的**副作用**（删了 hook），(1)(2)(4)(5) 都是不必要的
  - model_executor 版（HunyuanImage3SparseMoeBlock）跑得对**不是因为 FP32 routing**，是因为它**没用 `HunyuanFusedMoE` wrapper**（直接用 `SharedFusedMoE`），同样避开了 hook bug
- **最小修复版本**（同事确认）：
  - 在 `hunyuan_fused_moe.py:32` **注释掉 / 删除** `register_forward_pre_hook(...)` 这一行
  - 整个 patch 缩到 **1 行删除**
- **深层教训**：
  1. **多变量同时改 → 不能独立归因**。我同时改了 5 处，cartoon 出来时我把功劳给了 (1)(2)(4)(5) 那些"语义上跟 cartoon 强相关"的改动，但真正的修复是 (3) 这个看起来"只是接口切换"的改动的副作用。**应该先做最小消除实验**（每个改动单独 toggle）来归因，不能跑通就声称"找到根因"
  2. **静态 diff 看代码 ≠ 看清因果**。我对比 model_executor vs diffusion 看出 FP32 routing 差异，但**没注意到** model_executor 没用 `HunyuanFusedMoE` wrapper 这个**更基本的差异**。"看到差异" 跟 "差异就是 root cause" 之间还有一步因果验证我没做
  3. **之前写进旧错题本的 meta reflection 也是错的**。我落盘“5h 错路径 + hint 后 30min 找到 FP32 routing”作为成功故事——实际 30min 找到的是**正确的代码区域**（MoE block diff），但**错误的具体机制**（FP32 routing 而不是 hook 双调用）。同事二次 review 才把机制指对。**找到正确的代码区域 ≠ 找到 root cause**
- **对未来的提醒**（已加 CLAUDE.md B15 + style_bias_debug_methodology.md）：
  - 多处改动一起跑通 → 必须做**最小消除实验**（一处一处 revert，看哪一处真正起作用）才能归因
  - 找到代码差异不等于找到 bug 机制 —— 差异 → 假设 → **隔离实验** → 才确认机制
  - "成功修复"的反思也可能是错的：成功是结果，机制要单独验证
