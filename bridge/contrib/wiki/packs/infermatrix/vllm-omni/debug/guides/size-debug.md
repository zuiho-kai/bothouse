---
name: size-debug
description: 背景生图 / 多图 IT2I 尺寸或比例异常的排查顺序：prompt（num_images 与 <img> 数量）→ AR（<img_ratio_*> 是否留在 output.text）→ bridge（cot_text 截断、ratio_idx 映射）→ DiT（ResolutionGroup / extra_resolutions）→ token / attention → preprocess，及核心经验和适用场景
metadata:
  scope: 只收图像尺寸 / 比例异常的 end-to-end trace 顺序；风格偏差的静态 diff 流程归 style-bias-debug
---
# 背景生图尺寸异常，不要先盯单个函数

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/guides/size-debug.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10

### 背景生图尺寸异常，不要先盯单个函数

- 这类 bug 很容易看起来像 `pre_process_func`、首图兜底、或者某个 resize 分支的问题，但真正根因通常分布在多层链路里。

#### 这次最有效的排查顺序

1. prompt：`num_images` 和 `<img>` 占位符数量是否一致。
2. AR：`<img_ratio_*>` 是否真的保留在 `output.text`，有没有被 `skip_special_tokens` 吃掉。
3. bridge：`cot_text` 是否截断干净，`ratio_idx` 是否正确映射回 `(height, width)`.
4. DiT：`ResolutionGroup` / `extra_resolutions` 是否齐全，避免又被 re-bucket。
5. token / attention：`<timestep>`、`<joint_img_sep>`、MM 区域边界是否和训练时一致。
6. preprocess：`resize-stretch` / `image_list[0]` fallback 有没有覆盖真实比例。

#### 核心经验

- 尺寸 / 比例 bug 默认做 end-to-end trace，不要从最显眼的函数开始猜。
- 先问“哪一层决定了尺寸”，再问“哪一层只是消费尺寸”。
- 只看到输出错了，不等于输出层就是 root cause。

#### 适用场景

- 背景生图尺寸异常
- 多图 IT2I 输出比例不对
- AR 预测对了但最终 PNG 尺寸错了
- 局部函数看起来正常，整体结果却歪掉
- **How to apply:** 先把 `prompt -> AR -> bridge -> DiT -> config/token` 这条链路按顺序走完，再动手改代码。单点猜测很容易把锅扣错层。
