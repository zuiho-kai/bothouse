---
name: multi-image-input-plumbing
description: HunyuanImage3 IT2I 多图输入（最多 3 张参考图）的链路盘点：OpenAI 入口、AR processor、ar2diffusion、DiT 编码等六层已支持 list 输入，e2e 抓出的三处 surgery（prompt_utils 的 N 个 <img>、process_image 多分辨率 VAE stack、instantiate_timestep_tokens 的 list 分支），以及不要顺手修的 image_list[0] 尺寸兜底遗留 bug
metadata:
  scope: 只收多图输入的已支持层、三处实际改动、plan 阶段静态扫描的教训与遗留的尺寸兜底问题；AR→DiT 桥接的早期断点分析归 ar-dit-bridge，官方 prompt 格式归 official-prompt-format
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/multi-image-input-plumbing.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
- 接 HunyuanImage-3.0-Instruct IT2I 多图输入（"Multi-Image Fusion"，最多 3 张参考图，hunyuan3.0_ins/README.md §200-216, §500）时，**绝大部分链路已经支持 list-shaped 输入，唯一缺的是 AR prompt 模板的 N 个 `<img>` 占位符**。盘点见下，避免再下场前以为得改一堆地方。

### 已支持（不要再改）

| 层 | 文件 | 行号 | 行为 |
|----|------|------|------|
| OpenAI 入口 | `vllm_omni/entrypoints/openai/serving_chat.py` | 2703-2770 | `_extract_diffusion_prompt_and_media` 已能从 OpenAI content array 解出多张 `image_url` |
| 请求 schema | 同上 | 2309-2325 | `multi_modal_data` 接受 `{"image": [PIL, PIL, ...]}` 或单 PIL |
| AR processor | `vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py` | 855-923 | `process_image()` 已对 list 逐张 VAE/ViT 编码并 `torch.stack` 出 batch 维 |
| AR↔DiT 桥接 | `vllm_omni/model_executor/stage_input_processors/hunyuan_image3.py` | 93-102 | `ar2diffusion` 透传 `multi_modal_data["image"]`，list/单 PIL 都接 |
| DiT pre_process | `vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py` | 283-285 | `image_list = raw_images if list else [raw_images]`，N 张 → N 个 `JointImageInfo` |
| DiT 编码 | 同上 | 657-673 | `_encode_cond_image` 已逐张 VAE/ViT 编码并按 batch 拼 ragged tensor |

### 实际 surgery 点（plan 阶段以为只有 1 个，e2e smoke 抓出 3 个）

- **Plan 阶段以为唯一 surgery 是 prompt_utils 的 `<img>` 占位符**——这条本身没错（确实必须改），但 e2e 真跑后还有两条 DiT-side hidden bug，单独靠静态 explore + pytest 都抓不到，必须真模型 + 多图请求才会触发：
  1. **`vllm_omni/diffusion/models/hunyuan_image3/prompt_utils.py`**（plan 看到了）
     - `build_prompt:87-88` / `build_prompt_tokens:143-144` 不管输入几张图都只追加一个 `<img>`
     - 多图请求 → placeholder 数量 ≠ multimodal expansion 期望的图数 → vLLM 占位符替换错位
     - 修法：加 `num_images: int = 1` 参数 + N≤3 校验 + 追加 N 个 `<img>`，对齐官方 `tokenization_hunyuan_image_3.py:1499-1515` 每张图一条 user message + 1399-1400 successive user messages 共享一个 prefix/suffix wrap
  2. **`vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:917`**（e2e 抓到）
     - `process_image()` 给每张图按 `reso_group.get_target_size` 量化到独立 VAE 桶，再 `torch.stack`——多图差分辨率必炸：`RuntimeError: stack expects each tensor to be equal size, got [3, 1024, 1024] vs [3, 768, 1280]`
     - `vit` 走 Siglip2 naflex 自动 pad 到 max_num_patches，stack 不受影响；只有 VAE 是问题
     - 修法：所有图共享首图的 VAE 桶（与 `pipeline_hunyuan_image3.py:287-291` fallback 同语义）。注意 vLLM `MultiModalBudget` warmup 会传 `images=[]` 进来，必须 guard `if images:` 否则 IndexError
     - 官方 `_encode_cond_image` 走 ragged 双层 for 不 stack，vllm-omni 的 `MultiModalFieldConfig.batched("image")` 必须 stack——架构差异
  3. **`vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py:554` `instantiate_timestep_tokens`**（e2e 抓到，B13 同款）
     - `_encode_cond_image` 多图分支返回 `cond_t = list[Tensor]`（每个 batch 一个 tensor，里面 N 个 timesteps），`instantiate_vae_image_tokens:484` 已经有 `isinstance(images, list)` 分支处理这种 ragged 输入——但 `instantiate_timestep_tokens` 漏改，直接 `t.reshape(-1)` 抛 `AttributeError: 'list' object has no attribute 'reshape'`
     - 经典 B13："repo 同时有 AR 版 + DiT 版" 的镜像 bug，但这次是同一文件内"另一个 instantiate 函数漏改"——同模块同模式漏改也算
     - 修法：函数入口 `if isinstance(t, list): t = torch.cat([ti.reshape(-1) for ti in t], dim=0)`
- PR 参考：TaffyOfficial/vllm-omni `wt-hunyuan3-it2i-multi-image` (commit 22b532f6)。e2e smoke 验证：2 张 demo 图融合 → 20 step DiT denoise 25.6s / Peak 96.6 GB 跑通。

### 已知遗留 bug（不要顺手在多图 PR 里修）

- `pipeline_hunyuan_image3.py:287-291` 用 `image_list[0]` 的**裸像素 W/H** 给 `sampling_params.width/height` 兜底，**绕过了 AR 选桶**：
  - 官方 `image_size="auto"` 真实流程是 AR 阶段通过 `SliceVocabLogitsProcessor`（`hunyuan3.0_ins/image_processor.py:32-58, 412-421`）自己采样一个 `<img_ratio_X>` token 决定输出桶
  - DiT 应该按 AR 选的桶 denoise，不是按输入图驱动
  - `infer_align_image_size=True` 的 `postprocess_outputs` 只是后处理微调（拿生成图 ratio 同桶的 cond 借 original aspect rescale）
  - 单图凑巧 work 是因为 AR 训练目标本来就是输出 ratio 跟唯一那张输入图同桶
  - 多图 mixed-resolution 时这个 fallback 强制走第一张图的尺寸，实际错位
- 修这个需要把 AR 输出里的 `<img_ratio_X>` token 抽出来塞给 `ar2diffusion` 的 width/height 翻译——独立 refactor，不要在多图 input PR 里捎带。

## 决策与踩坑

### 经验：plan 阶段静态扫描看不出来的多图坑

- 每条 surgery 都是"plan 阶段写的'已就位'子系统"自己又踩出来的——意味着 plan 的 explore agent 报告"DiT 侧已支持 list" 不等于"真喂多图能跑"。**任何"声称已支持多模态 ragged 输入" 的代码声明，没有 e2e 真跑就是 plumbing claim 不是 working claim**。下次接多模态新形态：plan + e2e 必须并跑，不要拿 plan 阶段的静态盘点结论替代 runtime 验证。
