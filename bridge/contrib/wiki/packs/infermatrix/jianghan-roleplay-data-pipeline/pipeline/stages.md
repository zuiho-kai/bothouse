---
name: stages
description: Jianghan 各阶段职责：Stage 1 全本小说 CPT、Stage 2 World QA、Stage 3 叙事角色底座、Stage 4 桌面助手蒸馏
metadata:
  scope: 只收四个 Stage 的目标、数据形态、允许与禁止来源；数据硬卡点和表达机制归 data-contracts
---
# Jianghan 各阶段职责

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/stages.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）

### 阶段职责

#### Stage 1: 全本小说 CPT

- 目标：让模型吸收《全民魔女1994》的世界观、长期名词关系、叙事语感和世界质地。
- 数据形态：

```json
{"id": "novel_cpt_000001", "text": "第xxx章 ... 正文 ..."}
```

- 规则：
  - 使用全本小说 raw text chunks，不改成问答。
  - 保留章节标题和正文顺序。
  - 正式训练用 `Qwen/Qwen3.5-4B` tokenizer 重新切 chunk。
  - CPT 后先做世界观 / 小说续写 eval，不急着看桌面助手行为。

#### Stage 2: World QA / Worldbook Guardrails

- 目标：世界事实、术语、组织、反幻觉护栏。
- 允许来源：
  - 原文证据整理出的 reviewed novel QA。
  - 用户批准的 SillyTavern worldbook fact QA。
  - anti-hallucination QA。
- 禁止：
  - Tavern chat logs。
  - status blocks / writing prompts / visible reasoning traces。
  - 把 worldbook 当 Stage3 人格反应 gold。
- Stage2 v4 worldbook QA mix 约束：worldbook rows 不超过 selected source mix 的 40%，每条保留 `source_kind`、`source_id`、`evidence`、`must_not`、`review_status`。

#### Stage 3: 江涵叙事角色底座

- 当前主线：原文-only。
- 输入：

```text
observed scene / latest event
```

- 输出：

```text
江涵中心的小说式反应：
观察 -> 内心建模 -> 动作 -> 短台词 -> 轻叙事推进
```

- 每条候选建议字段：

```json
{
  "id": "...",
  "mode": "stage3_narrative_role_base",
  "source_kind": "original_novel_evidence_*",
  "chapter_index": 1,
  "chapter_title": "...",
  "observed_context": "...",
  "latest_event": "...",
  "evidence_summary": "...",
  "narrative_mechanism": ["..."],
  "proposed_output": "...",
  "must_keep": ["..."],
  "must_not": ["..."],
  "review_score": null,
  "review_notes": ""
}
```

- 禁止作为 Stage3 主线来源：
  - SillyTavern generated replies。
  - CoSER transformed rows / raw ShareGPT CoSER rows。
  - `mimo` / Claude / GPT 生成回复。
  - old LoRA outputs。
  - desktop assistant / task_report rows。

#### Stage 4: 桌面助手 / 秘书蒸馏

- Stage4 在 Stage3 角色底座稳定之后再做。它输出更短、更 TTS 友好、更实用。
- 覆盖 mode：

```text
screen_chat
screen_observe
user_chat
task_report
delegate_task
```

- `task_report` 是秘书汇报，不是改写器：
  - 必须保留输入事实、否定、承诺、数字、参数名、文件名和不确定性。
  - 不能把 smoke 写成性能结论。
  - 不能把 Claude/Codex/tool 结果改成自己做的，除非输入明确如此。
  - 默认不能无依据塞入原著人物、组织、事件或设定。
