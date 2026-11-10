---
name: 2026-05-08-painterly-plan-size-misjudge-01
description: 2026-05-08 multi-image PR 的 plan 阶段把 IT2I 输出尺寸逻辑整反：提议用 reso_group.get_target_size 改 pipeline_hunyuan_image3.py:287-291 的 image_list[0] fallback，漏看 postprocess_outputs 的 output_image 已是生成尺寸与 SliceVocabLogitsProcessor，正确流是 AR 选桶、DiT 按桶 denoise、postprocess 微调
metadata:
  scope: 只收 plan 阶段输出尺寸方向判断错误这一条；同会话第二次踩「input1 驱动下游」（process_image 的 shared bucket）归 2026-05-08-painterly-plan-size-misjudge-02
---
# 2026-05-08 — Plan 阶段把 IT2I 输出尺寸逻辑整反了，靠用户截图被打脸

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-08-painterly-plan-size-misjudge-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-08-painterly-plan-size-misjudge-01`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：Plan 阶段把 IT2I 输出尺寸逻辑整反了，靠用户截图被打脸
- 影响范围：repos/vllm-omni/models/hunyuan-image3

### 原文件说明

### Painterly bug — multi-image PR 上的 plan/size 判断错误

- painterly fix 之后做 multi-image input PR 时，同会话**两次**踩"input1 驱动下游"——03:45 plan 阶段 IT2I 输出尺寸方向反了，14:30 写 process_image 时 shared-bucket 又来一次。**判断模式相同**：看到下游约束 → 改输入凑合，没问"约束本身 sane 吗"。根因和总览见 [[painterly-overview]]（Painterly 错题索引）。

---

- **症状**：写 multi-image input PR 的 plan 时，提议把 `pipeline_hunyuan_image3.py:287-291` 的 `image_list[0]` 裸像素 fallback 改成 `image_processor.reso_group.get_target_size(...)` 桶量化，理由是"对齐官方 `image_size='auto'` + `infer_align_image_size=True`"。用户贴 `postprocess_outputs` 截图反问"是不是先推理出输出 ratio，再匹配输入"——一句话把方向反掉了。
- **根因**：读 `hunyuan3.0_ins/image_processor.py:postprocess_outputs` 时只扫到多图分支 "iterate cond images, find ratio match"（line 451-459）就以为"输出尺寸由输入图驱动"，**漏了三处证据**：
  1. `output_image_ratio_index = ...get_base_size_and_ratio_index(width=output_image.width, height=output_image.height)`——`output_image.width/height` **已经是 DiT 生成完的尺寸**，说明输出 ratio 在 postprocess 之前就定下来了
  2. 没看 `SliceVocabLogitsProcessor`（line 32-58 + `build_img_ratio_slice_logits_processor` line 412-421）——AR 阶段在 ratio token 位置把 vocab 限制成"只能从 ratio tokens 里选"，`image_size="auto"` 的真正含义是**让 AR 自己采样输出桶**，输入图根本不参与
  3. 漏看 postprocess 的真实意图——它不是"挑桶"，是"找 ratio 同桶的输入图借 original aspect 做最后精度微调（保持 area ≈ base_size²）"，AR 已经选完桶了
- 正确数据流：**AR 选桶 → DiT 按桶 denoise → postprocess 用 cond image 的 original aspect 微调**。我把第二步当成了第一步。
- **解法**：revert plan §3 的尺寸改动，pre-existing `image_list[0]` 裸像素 fallback 留下不动（pre-existing bug，单独 PR 修，需要把 AR 输出里的 `<img_ratio_X>` token 抽出来塞 ar2diffusion）。最终 PR 只动 AR prompt 多图占位符，责任单一。
- **对未来的提醒**：
  - 给"size 政策""dispatch 政策""routing 政策"这种需要看完整生命周期的方案前，必须 grep 全调用链：`grep -E "image_size|infer_align|postprocess|ratio_index|<img_ratio_|SliceVocabLogitsProcessor"` 一次性把 AR / DiT / postprocess 所有相关点拉出来对照。**只看一处**就拍方案 = 用半截证据建模
  - 看 postprocess 函数时**特别关注 input 参数是哪一阶段产出的**。`output_image.width` 这种字段一看就是上游传进来的，意味着尺寸在更早的阶段就 frozen 了。"看到差异 → 假设差异是 root cause"违反 B16，"看到一处行为 → 反推整个流程意图"是同一类错
  - 用户用一句话+截图就把方向纠了——这不是用户特别厉害，是我证据链不完整就 commit 了 plan。下次给 plan 的"决策依据"小节必须列**全部读过的代码点 file:line**，强迫自己把证据链摆出来
  - 涉及多 stage 数据流时，画一张 stage A → stage B → stage C 的箭头图（哪怕注释里 ASCII），数据来源能可视化纠错

---
