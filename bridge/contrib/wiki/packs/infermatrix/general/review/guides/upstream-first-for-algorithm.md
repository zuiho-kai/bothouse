---
name: upstream-first-for-algorithm
description: Algorithm-level 决策前先 grep upstream：stop token、special token、scheduler、KV cache、prompt 模板等决策先读上游函数体；仓库内同模型工具类也算 upstream；shape-compatible 语义 bug 也是 algorithm bug
metadata:
  scope: 只收 algorithm 决策前先读 upstream 的触发清单、强制步骤、PR 3444 / 3626 / 3474 教训与反模式；framework 补丁与 algorithm 修复的取舍归 algorithm-vs-framework-fix
---
# Algorithm-level 决策前先 grep upstream

## 现状

- PR #3444 review iteration 复盘抽出。
- `hunyuan3.0_ins/modeling_hunyuan_image_3.py` 就在 `D:\vllm-omni\hunyuan3.0_ins\` 下，**距离一次 grep 的距离**，我没读，靠 trace 现场反推方案，结果跟 upstream 设计哲学背道而驰。
- reviewer 一句 "ref upstream line 3290" 把方案打回原形。
- 派生自 `P1 证据先行`。是 [B7] 的精神扩展——B7 字面只管"测 baseline 前 grep README"，这条把它扩到所有 algorithm 决策。

## 关键事实

- 源页：`knowledge/general/review/guides/upstream-first-for-algorithm.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 规则

- **触发器**：准备做以下任一类决策
  - AR stop token / EOS / sampling 策略选择
  - 特殊 token（control token / placeholder / trigger tag）处理
  - generate loop 行为（forced emission / logits processor / stage transition）
  - scheduler / denoising loop / noise prediction type
  - embedding basis 顺序（`cos/sin`）、activation function、token / joint order
  - attention mask / pad-eos / special-token 语义
  - preprocess / resize / mask / coordinate transform 语义
  - KV cache 切片 / snapshot 触发点 / reuse 长度
  - prompt 模板 / chat_template / system prompt 注入位置
- **强制**：
  1. `find $UPSTREAM_REPO -name "modeling_*.py" -o -name "generation_*.py" -o -name "tokenization_*.py"` 找主入口文件
  2. grep 关键概念名（`final_stop_tokens` / `EOS_TOKEN_ID` / `_stage_transitions` / `apply_chat_template` 等）
  3. **读完相关函数体**才动手设计
- **禁止**：
  - 靠"观察 token 序列 + 反推" 自己造 algorithm 方案
  - 把 upstream 当"备查参考"而不是"先验证设计"
  - 已经 clone 的 upstream repo 当透明（README 提过的、CLAUDE.md 提过的 reference repo）

### How to apply

- **会话开头**：列项目 reference repo 路径（`hunyuan3.0_ins/`、HF transformers 等），算作"可直接 grep 的 source of truth"。
- **改 prompt_utils / sampling / stop tokens 前**：

```bash
grep -rn "final_stop_tokens\|stop_token\|EOS\|eos_token_id" $UPSTREAM_REPO/modeling_*.py | head
```

- **改 KV cache 切片 / snapshot 前**：

```bash
grep -rn "kv_cache\|snapshot\|reuse_len" $UPSTREAM_REPO/modeling_*.py | head
```

- 找不到 / 不存在 → 才推理。能 grep 出来 → **必读再动**。

### "Upstream" 包含本仓库内的同模型工具类（PR #3626 教训）

- **触发**：加 utility / helper / 纯 Python 复刻**前**。
- **强制 grep**：`grep -rn "<同名函数或同概念>" vllm_omni/ <upstream_repo>/`，**两边都查**。
- 仓库里已有的 ResolutionGroup / Processor / Sampler 等同模型类**就是 upstream**——它们已经把上游算法对齐过一次了，你再写第三份纯 Python 复刻 = 三处需要同步的源码漂移。
- **派生规则**：加工具函数前必跑：

```bash
grep -rn "<algorithm-name>\|<key-concept>" vllm_omni/ scripts/
grep -rn "<algorithm-name>\|<key-concept>" hunyuan3.0_ins/  # or other reference repo
```

- **两边都返回非空 → 必须先回答"为什么不 reuse"再动笔**。

### Shape-compatible semantic bugs 也是 algorithm bugs（PR #3474 GO-1-Air）

- PR #3474 的教训是：新模型接入时，shape / state dict / stub smoke 都通过，不代表 algorithm 对。
- 以下字段只要与 upstream 不一致，就会让模型语义偏掉，但通常不会立刻 crash：

| 字段 | 常见误判 | 必查 upstream |
| --- | --- | --- |
| timestep / positional embedding | 维度对就行 | `cos/sin` 拼接顺序、frequency basis、scale |
| activation | MLP shape 一样就行 | `GELU` / tanh GELU / `SiLU` / gated MLP |
| token / joint order | concat 后长度一样就行 | time / frequency / state / action / image token 的相对顺序 |
| scheduler | alpha-bar loop 能去噪就行 | DPM-Solver / Euler / DDIM、prediction type、step spacing |
| attention mask | `input_ids != pad_id` 是通用写法 | `pad_id == eos_id`、special token 是否参与 attention |
| preprocess / action normalization | dtype/shape 对就行 | resize、crop、mask、coordinate system、normalization range |

- **规则**：如果代码在复刻 upstream module，即使权重能 strict load，也必须 diff 这些 semantic fields。
  - 找不到上游实现时才可以写“推理：从 config / paper / naming 推断”，并在 PR body 标成 source inference，不得写成已验证。

### 链接

- PR #3444 review iteration：Hunyuan KV reuse 错题（源链接 `../../../repos/vllm-omni/models/hunyuan-image3/incidents/2026-05-13-kv-reuse-orchestrator.md`）（review iteration 段）
- PR #3626 review iteration：[[reviewer-lens-audit-1]]（reviewer_lens_audit）（4 条评论同一根因）
- PR #3474 review iteration：GO-1-Air shape-compatible semantic mismatch
- 相邻：hf_alignment_pitfalls（源链接 `../../../repos/vllm-omni/models/hunyuan-image3/hf-alignment-pitfalls.md`）（HF model 接入时 grep README/demo）
- 派生硬规则：CLAUDE.md B30

## 决策与踩坑

### Why（PR #3444 实测）

- 发现 AR `<answer>` stop 太早砍掉 size/ratio tail → 我直接换 `<|endoftext|>`，理由"让 AR 走完 forced tail 直到自然 EOS"。
- **upstream 实际做法**（`modeling_hunyuan_image_3.py:3289-3303`）：

```python
if need_ratio:
    final_stop_tokens = list(range(tkw.start_ratio_token_id, tkw.end_ratio_token_id + 1))
    for start, end in getattr(tkw, "ratio_token_other_slices", []):
        final_stop_tokens.extend(range(start, end))
```

- **停在 ratio token 本身**，配 `_ConditionalSliceVocabLogitsProcessor` 强制下一个 token 落 ratio 区间。AR 自然轨迹 `</recaption><answer><boi><img_size><img_ratio_X>` ←停在最后这个。
- 我的 `<|endoftext|>` 方案让 AR **白跑 5 个 decode step**（emit `<answer><boi><img_size><img_ratio><eos>` 才停）。
- PR #3444 reviewer Bounty-hunter 第一条 review 就是 "seem not correct, can you ref upstream line 3290 and run comparative experiment" —— 一句话戳穿。

### 反模式

- "我 trace 现场就够了" → 看不到 upstream 的设计 invariant
- "等 reviewer 提了再改" → reviewer 不是 oracle，upstream 才是
- "upstream 太复杂，先按自己理解写" → 永远不会回去对 upstream，diff 越走越远

### PR #3626 实测（仓库内同模型工具类）

- PR #3626 实测：我在 `prompt_utils.py` 加了 `_build_reso_group_ratios`，仓库里已有的：
  - `vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py:ResolutionGroup._calc_by_step`
  - `vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:HunyuanImage3Processor.ResolutionGroup._calc_by_step`
- reviewer 一句 "_build_resolutions_by_step，可以复用吗？" 直接戳穿。**这两份已经在那了，我没 grep**。
- "模块标 lightweight / no-torch 所以不能 reuse" 不是借口：算法可以**移到持有数据的那一层**（AR 模型 `__init__`），重 import 在那一层本来就 OK。
- 约束应该指向"在哪做"，不应该被偷换成"再造一份"。
