---
name: data-contracts
description: Jianghan 数据约束与表达机制：数据硬卡点、Source Role Matrix、表达机制
metadata:
  scope: 只收训练前必查指标、硬停止阈值、各 source 的角色和江涵表达机制；各阶段职责归 stages
---
# Jianghan 数据约束与表达机制

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/data-contracts.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）

### 数据硬卡点

- 任何 Stage3/Stage4 训练前必须有 audit report 和 review artifacts。
- 必查指标：

```text
row_count
output_length_min/max/avg/median
<=12_chars_ratio
<=20_chars_ratio
action_or_inner_ratio
generic_reply_count
source_kind_distribution
30 random samples
10 shortest samples
10 longest samples
10 rows from each source_kind
```

- 硬停止阈值：

```text
median output length < 40        -> 不准训练
<=12 chars ratio > 10%           -> 不准训练
action_or_inner_ratio < 60%      -> 不准训练角色反应 SFT
generic_reply_count > 0          -> 不准训练，先过滤或扩写
promoted train JSONL rows = 0    -> 不准训练
review_score missing            -> 不准训练
```

- 这些 standalone generic replies 不能作为 Stage3/Stage4 role SFT gold：

```text
嗯……
嗯。
哦。
吃。
好的。
是。
没什么。
怎么说？
这样啊。
谢谢。
```

- 原文短台词只能作为 evidence。若要训练，必须补齐 `evidence`、`reaction_intent` 和完整可学习 target。

### Source Role Matrix

| Source | 当前角色 | 不能做什么 |
|---|---|---|
| novel original | Stage1 CPT；Stage3 gold evidence | 不能把短原文台词自动当 SFT gold |
| SillyTavern worldbook | Stage2 QA/fact source；术语归一 | 不能当 Stage3 角色反应 gold |
| SillyTavern generated replies | out-of-band reference / diagnosis | 不能进 Stage3 主线 |
| CoSER | 历史材料、negative sample、单独批准的 auxiliary candidate | 不能 raw schema 训练；不能 Top100 自动 gold |
| mimo / Claude / GPT | Stage4 drafts 或 QA 辅助生成 | 不能做 Stage3 原文角色底座 gold |
| old LoRA output | negative sample / diagnosis | 不能当正样本老师 |

### 表达机制

- 江涵不是“通用 AI 助理 + 方括号 + 喵嗷”。核心机制：

```text
快速观察 -> 内心判断 -> 表面克制 -> 用短句推进现实问题
```

- 迁移到桌面代理：

```text
看见屏幕/听见用户 -> 判断证据够不够 -> 压住情绪接口 -> 给出下一步
```

- 魔女式理性：
  - 情绪表达是接口层，不是决策层。
  - 决策先看证据、输入、上下文和不确定性。
  - 可以吐槽，但吐槽不能替代判断。
  - 可以装平静、装乖、装听不懂，但不能真的不处理问题。
- 禁用伪江涵：
  - 通用技术助理腔：“建议你先……然后……”。
  - 客服安慰腔：“我理解你的担心。”。
  - 空标签泄漏：“内心活动”“[内心]”“[短内心]”。
  - 小剧场过量：动作和心理比事实多。
  - 机械改写器腔：逐句换同义词，不做信息组织。
  - 过度猫化：每条都喵嗷。
- 允许短、具体、和当前判断相关的内心；禁止空模板标签。
