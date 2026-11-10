---
name: pipeline-architecture
description: Jianghan Roleplay 数据管线总览：开工先读、当前唯一主线、已作废结论和下钻入口
metadata:
  scope: 只收江涵项目入口页的当前路线、开工先读清单和已作废结论；阶段职责归 stages，数据约束归 data-contracts，交接归 handoff
---
# Jianghan Roleplay 数据管线总览

## 现状

- 目标目录：`D:\jianghan-roleplay-data-pipeline`
- 本页是 workflow-starter 侧的江涵项目入口。详细执行命令仍以目标目录内的 `CLAUDE.md`、`PLAN.md` 和 `docs/` 为准；本页吸收当前路线、硬卡点、错题本和交接状态，避免下一轮又回到已否决的路径。

### 当前唯一主线

```text
Qwen/Qwen3.5-4B
-> full novel CPT
-> Stage2 world QA / worldbook QA guardrails
-> Stage3 original-novel-only Jianghan narrative role base
-> Stage4 desktop assistant / secretary distillation
```

- 当前最重要的纠偏：

```text
Stage3 = original novel only.
```

- Stage3 不是桌面聊天，也不是短台词补全。它训练“江涵在小说场景里如何观察、建模、行动、短句回应、轻叙事推进”。Stage4 才把这个角色底座压缩到读屏、聊天、工具汇报和任务下发。

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/architecture.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）

### 开工先读

- 在 `D:\jianghan-roleplay-data-pipeline` 做任何数据、脚本、配置、训练或文档改动前，先读：

```text
CLAUDE.md
PLAN.md
docs/stage_execution_guide.md
docs/training_data_hard_rules.md
docs/lastword_unfinished_items_2026-05-22.md
```

- 如果碰到具体阶段，还要读对应复盘：

```text
docs/training_reset_2026-05-22.md
docs/stage3_v1_failure_retrospective.md
docs/context_retrospective_2026-05-22.md
docs/stage3_source_routing.md
docs/stage2_worldbook_qa_mix_plan.md
```

### 下钻入口

- [[stages]]（各阶段职责）
- [[data-contracts]]（数据约束与表达机制）
- [[handoff]]（当前交接与远端卫生）
- [[pipeline-incidents-overview]]（历史错题）

## 决策与踩坑

- 禁止用这些路径下结论：

```text
runs/qwen25_7b_*
diagnostics/qwen25_7b_*
data/train/jianghan_roleplay_seed_top100.jsonl
data/processed/coser_clean/roleplay_selected.top100.jsonl
runs/qwen35_4b_jianghan_role_sft_v1_scene
data/train/jianghan_scene_sft_v1.chat.jsonl
```

## 历史

### 已作废结论

- 上一轮远端 smoke 不能作为目标 LoRA 质量证据。
- 作废原因：
  - 目标基座是 `Qwen/Qwen3.5-4B`，但远端当时没有完整 snapshot/权重。
  - 实际训练临时用了 `Qwen2.5-7B-Instruct`，模型族、尺寸和 instruct 惯性都不一致。
  - 训练混入了用户已否决的 CoSER Top100 / `roleplay_seed_top100`。
  - 因此结果只能保留为脚本、远端、token chunking、device 等工程记录，不能判断江涵人格或世界观是否学会。
