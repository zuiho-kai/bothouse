---
name: 2026-05-08-painterly-plan-size-misjudge-02
description: 2026-05-08 同会话第二次踩「input1 驱动下游」：process_image 的多图 stack fix 把 image2/3 都压成 image1 的 VAE shared bucket（1920x1080 被压成 1024x1024 方桶，静默丢侧边内容），真正约束是 MultiModalFieldConfig.batched("image") 选错、应走 ragged；本 PR 选 hack 加 warning，schema 改动列为 follow-up
metadata:
  scope: 只收 shared-bucket 凑齐尺寸的第二次同款错误与处置；plan 阶段输出尺寸方向反了的第一次归 2026-05-08-painterly-plan-size-misjudge-01
---
# 2026-05-08 — 同会话第二次踩"input1 驱动下游"，shared-bucket 又来一次

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-08-painterly-plan-size-misjudge-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-08-painterly-plan-size-misjudge-02`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：同会话第二次踩"input1 驱动下游"，shared-bucket 又来一次
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：上面 03:45 那条刚 revert 完，两小时后写 `process_image` 的 multi-image stack fix 时，再次让 image1 的 VAE 桶强制驱动 image2/3——`shared_vae_w, shared_vae_h = self.reso_group.get_target_size(images[0].width, images[0].height)` 然后所有图都 resize 到这个 shared bucket。
  - code review 抓出来：image2 1920×1080 被压成 image1 的 1024×1024 方桶，**侧边内容静默丢失**，注释只说"为了让 stack 不炸"，没提画质损失。用户一句"这个问题之前不是出过两次了么"打脸。
- **根因（同款）**：碰到 `torch.stack expects equal size` 报错时大脑直接跳"凑成同尺寸最容易让它过"，绕过了"为什么 vllm-omni 这里非要 stack"的根本问题。**真正的约束是 `MultiModalFieldConfig.batched("image")` 选错了**——官方走 ragged（`flat_from_sizes` 等价物，不 stack），vllm-omni 这个 schema 选择是错的，不是输入数据的错。
- 跟 03:45 那条**完全同款**判断错误：**看到下游报错 → 假设下游是对的 → 改输入数据来满足下游**。正确链：**下游报错 → 问下游为什么这样要求 → 发现 schema 选错 → 改 schema 不改输入**。违反 CLAUDE.md F5（第一性原理：先问根本约束）。
- **解法**：本 PR 选 hack 路线（保留 shared bucket + 加 warning），把"改 `MultiModalFieldConfig.batched` → ragged schema"列为 follow-up PR。不是不能修，是 PR 范围控制；但 commit message **必须**列 known limitation，不能说"已支持多图"了事。
- **对未来的提醒**：
  - 同会话犯同款错两次 ≠ 偶然，是底层模式没改过来。**碰到"下游对输入形状有约束"类报错，第一反应必须是"这个约束 sane 吗、是不是 schema/接口选错了"**，而不是"输入怎么改才能满足下游"
  - shared-bucket / forced-equal-shape / pad-to-max 这种"凑齐让它过"的 hack，**永远会丢用户感知不到的画质/语义信息**——必须 commit message 明写、必须 logger.warning，否则就是埋雷
  - error book 里的"对未来的提醒"不是写完就完事——下次写代码前必须 `grep` error book 找 keyword（"size"/"input drives"/"ragged"/"shared bucket"）核对，强迫自己跟过往判断对话。这条没跑这个流程是直接原因
  - code review subagent 抓得出这种重复错（"P0-1 静默裁切"那条），说明用 subagent 做 review 是必要工序，不是 nice-to-have——本 PR 没让 subagent review 的话三个洞会全部进 prod
