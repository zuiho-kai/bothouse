---
name: it2i-gap-1
description: "HunyuanImage-3.0-Instruct IT2I Gap 风险报告（2026-04-20）前半：vLLM-Omni DiT pipeline 丢弃 pil_image 的数据流、5 层代码缺口表（forward 第 1003 行、prepare_model_inputs 无 image 参数、batch_cond_image_info = None 等）、与 GLM-Image / BAGEL 的对比、PR #2949 不解决 IT2I 的依据"
metadata:
  scope: "只收 IT2I gap 报告的 TL;DR、问题定位、业界对比和 PR #2949 分析（源页一至三节）；修复方案 A / B / C、推荐、决策请求和附录归 it2i-gap-2"
---
# HunyuanImage3 IT2I gap 调查（1/2）

## 关键事实

- 拆分说明：本页是源页 `it2i-gap.md` 的第 1/2 部分；第 2 部分 [[it2i-gap-2]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/it2i-gap.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16
- ﻿# HunyuanImage-3.0-Instruct IT2I Gap 风险报告
- **版本**：2026-04-20
- **作者**：CI/精度评测工作组
- **状态**：待领导决策（方案 A / B / C）

---

### TL;DR

- **vLLM-Omni 的 HunyuanImage-3.0-Instruct 目前不支持 IT2I（图文转图片）场景**——DiT pipeline 的代码路径上有 3 层缺失，从桥接传来的 PIL 图片一路被丢弃，永远到不了 DiT 的 condition image encoding。
- **影响**：所有依赖 IT2I 能力的下游任务（图片编辑 API、gbench 精度评测、业务图编辑功能）都跑不通。
- **修复路径**：照 GLM-Image / BAGEL 先例在 DiT 侧加 image 处理，~195-215 行代码，1.5-3 人天。有开源官方代码可复制，**非创新**。

---

### 一、精确问题定位（代码级证据）

#### 1.1 IT2I 的数据流现状

- 走 `hunyuan_image3_it2i.yaml` 部署，完整数据路径：

```
[用户请求] prompt + PIL 图片
     ↓
[AR Stage 0] HunyuanImage3ForConditionalGeneration 生成 latent tokens
     ↓
[桥接 ar2diffusion] 塞进 OmniDiffusionRequest，pil_image 被成功转发 ✓
     ↓ pil_image 在 req.prompts[i]["pil_image"] 字段里
[DiT Stage 1] pipeline_hunyuan_image3.py::forward()
     ↓
[第 1003 行] prompt = [p.get("prompt") or "" for p in req.prompts]
     ↓ ❌ 只抽 "prompt" 字段，pil_image 被丢弃
[第 1013-1022 行] prepare_model_inputs(prompt=..., cot_text=None, mode="gen_image", ...)
     ↓ ❌ 没传 image 参数
[prepare_model_inputs else 分支 第 515 行]
     ↓ batch_message_list 为 None，走 else
[第 494 行] batch_cond_image_info = None   ❌ 硬编码 + TODO 注释
     ↓
[apply_chat_template(batch_cond_image_info=None)]
     ↓
DiT 拿到的 sequence 里没有任何 cond_image 信息
     ↓
出图等同于纯文生图（图片被完全忽略）
```

#### 1.2 5 层代码缺口（都是事实，非推测）

| # | 缺口位置 | 代码行 | 问题 |
|---|---|---|---|
| 1 | `pipeline_hunyuan_image3.py::forward()` 第 1003 行 | `prompt = [p if isinstance(p, str) else (p.get("prompt") or "") for p in req.prompts]` | 只抽 `prompt` 字段，`pil_image` / `multi_modal_data` 被丢弃 |
| 2 | `pipeline_hunyuan_image3.py::prepare_model_inputs()` 签名 第 469-481 行 | 参数表：`prompt, mode, system_prompt, cot_text, num_inference_steps, guidance_scale, image_size, message_list, device, max_new_tokens` | **没有 `image` 参数** |
| 3 | `pipeline_hunyuan_image3.py::prepare_model_inputs()` else 分支 第 493-494 行 | `# TODO: construct with user input images`<br>`batch_cond_image_info = None` | 作者留的明文 TODO，未实现 |
| 4 | `hunyuan_image3_transformer.py::HunyuanImage3ImageProcessor` 第 1353 行 | 只有 `build_image_info(image_size)`（用于生成图 target 尺寸） | 缺 `build_cond_images` / `vae_process_image` / `vit_process_image` / `as_image_tensor` 等把 PIL 转成 JointImageInfo 的方法 |
| 5 | `model_executor/models/hunyuan_image3/hunyuan_image3.py`（AR 模型） | 未实现 `OmniOutput(multimodal_outputs=...)` 输出 | 桥接尝试读 `ar_output.multimodal_output`（`stage_input_processors/hunyuan_image3.py:111`），但 AR 侧没写入，永远为空 |

- **5 个缺口并存，补任何一个都不够，必须一起补**。

---

### 二、业界对比：别人都已经做了

| 模型 | image 输入实现方式 | 代码位置 | 状态 |
|---|---|---|---|
| **GLM-Image** | `_prepare_condition_image_kv_cache(condition_images, prior_token_image_ids, ...)` —— DiT 侧自己调 `vae.encode(...)` 编码 condition image | `vllm_omni/diffusion/models/glm_image/pipeline_glm_image.py:602` | ✅ 已实现 |
| **BAGEL** | `prepare_vae_images` / `prepare_vit_images` —— DiT 侧自己编码；通过 `past_key_values` + `kv_transfer_manager` 从 AR 传 | `vllm_omni/diffusion/models/bagel/` | ✅ 已实现 |
| **HunyuanImage-3.0** | 桥接传 `pil_image`，但 DiT 不读；`batch_cond_image_info = None` 硬编码 | — | ❌ **未实现** |

- **结论**：这不是设计差异，是实现缺陷。原作者只实现了 T2I 路径，IT2I 的代码留空。

---

### 三、同事 PR #2949 不解决 IT2I 问题

- PR 标题：`[Feature] Add KV Cache Reuse between AR-DiT in Hunyuan-Image3`
- PR 做的事：T2I 场景下 AR 把 **text prompt 的 KV cache**（含 CFG negative prompt KV）传给 DiT 复用，跳过 DiT 的文字 encode
- PR **新增的唯一函数**：`_forward_with_kv_reuse`（`pipeline_hunyuan_image3.py` 第 1041-1238 行）
- 这个新函数**内部所有 cond image 相关字段硬编码 None**（第 1128-1131 行）：

  ```python
  "cond_vae_images": None,
  "cond_vit_images": None,
  "cond_vit_image_mask": None,
  ```

- `_forward_with_kv_reuse` 只在 `req.sampling_params.past_key_values` 非 None 时触发（第 1014 行），**这个条件在 IT2I 路径下不成立**（IT2I yaml 的 DiT stage 走的是普通 `forward()`，桥接 `ar2diffusion` 没塞 `past_key_values`）
- **验证**：PR 里 IT2I 相关改动只在 `end2end.py`（example 脚本）和 README，**生产代码对 IT2I 路径 0 改动**。

---
