---
name: debug-funnel-cases-1
description: "调试漏斗纪律第 1 部分（PR #3444 HunyuanImage-3.0 IT2I online 方图 bug，我 ~2h vs Codex ~10min 的对比表）：规则 (a) grep 优先于实测、(b) 怀疑收敛到 1 个再动手、(c) user 给诊断 ≠ 给修法，信号识别清单，PR #3444 实测复盘（hunyuan_image3.yaml:25 is_comprehension: false 导致 online stop 不覆盖）"
metadata:
  scope: "只收漏斗规则 (a)–(c)、信号识别和 PR #3444 复盘；PR #3611 graph mode 复盘、派生规则 (d)(e)、How to apply 和链接归 debug-funnel-cases-2，下结论纪律归 conclusion-discipline-cases-1、conclusion-discipline-cases-2"
---
# 调试漏斗纪律（1/2）

## 关键事实

- 拆分说明：本页是源页 `debug-funnel-cases.md` 的第 1/2 部分；第 2 部分 [[debug-funnel-cases-2]]
- 源页：`knowledge/repos/vllm-omni/debug/guides/debug-funnel-cases.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10
- PR #3444 HunyuanImage-3.0 IT2I online 方图 bug 复盘。Codex 与我并行调同一个 bug：

| | 我 | Codex |
|---|---|---|
| 总耗时 | ~2h | ~10min |
| 远端启停次数 | 4 次（每次 ~2min model load）| 0 |
| 怀疑点 | 同时持有 5 个（stop set / target_h+w / image_size / M-RoPE / sampler 调用），每个都跑实测 | 收敛到 1 个：`serving_chat.py:2353` 找 AR stage 的判定字段跟 yaml 不一致 |
| 真因发现路径 | 改了 4 处代码全部 revert，才回到起点，再静态找 | 静态读 3 个文件：serving_chat / pipeline.py / yaml |

- 派生自 [P1 证据先行] + [P4 单变量隔离归因] + [B29 用户给 fix 指令直接动手] 的反向场景。

---

### 规则

- **触发器**：debug bug 时同时持有 ≥2 个独立怀疑，或想 "重启服务跑一次试试"
- **强制**：

#### (a) grep 优先于实测

| 动作 | 成本 | 信息量 |
|---|---|---|
| 启动 server + 1 次 AR/DiT 实测 | ~2-3 min | 1 个 hypothesis 的 yes/no |
| `grep -rn <symbol> <dir>` | <1s | 全文件分布 |
| 读完整调用链（4 个文件 × 50 行）| ~3 min | 整条 path 的所有 fork 点 |

- **规则**：连续 ≥2 次实测仍未定位 → **强制回静态**，禁止再启动服务，直到找到新的怀疑点。

#### (b) 怀疑收敛到 1 个再动手

- **强制流程**：
  1. 列出所有怀疑点
  2. 标相对概率排序（基于 grep 出的实际代码分支多少 / yaml 字段是否真存在 / 历史 commit 是否动过）
  3. 静态二分排除：每个怀疑找一个**便宜的反证**（grep 一行能否证伪）
  4. 收敛到 1 个 → 动手 fix
  5. 不能收敛 → AskUserQuestion 让 user 给方向，**禁脑补**

#### (c) user 给诊断 ≠ user 给修法

| user 说 | 我应该做 |
|---|---|
| "改 X 文件的 Y 函数加 Z 参数" | **直接动手**（B29 适用）|
| "这个函数没验过 think_recaption 场景" | **先 framing 修法 scope**：是改这个函数 / 周边 / 还是别的层？AskUserQuestion 给 ≤3 个修法选项 |
| "之前修好了，现在又出来了" | **先 trace timeline**：什么时候修的、什么时候坏的，**禁猜测立刻改代码** |

- **禁**：基于 user 单句诊断脑补"按上游真值表改函数 + 加 image_size 参数 + 改 2 处 call site"——这是**修法范围 inflation**，B29 不适用。

---

### 信号识别

- 列怀疑点超过 2 个，每个想"试试"
- 想"重启 server 验证一下" → 先问：能不能 grep 出答案？
- 想"按 X 修一下试试" → 先问：诊断闭环了吗？
- 想"等 Codex/user 给方向" → 先问：我的 grep 做完了吗？
- 修改 ≥3 个文件后才发现方向不对要 revert → 早期没收敛信号

---

### PR #3444 实测复盘

- **用户报现象**：online `/v1/images/edits` 输出方图 1024x1024，offline 同 prompt 是 1216x832。
- **我的 debug 路径**（错的）：
  1. user 提"stop 差异" → 我钻 `resolve_stop_token_ids` 真值表，加 `image_size` 参数 + 2 处 call site → scp → 跑 → 行为没变 → revert
  2. 又怀疑 `target_h/target_w` inject → 加 `model_arch != "HunyuanImage3ForCausalMM"` guard → scp → 跑 → PNG 字节完全一样 → revert
  3. 加 init-time PROBE 打 `engine_output_type` 值 → 跑 → 显示 "latent" / generation mode 都正确 → 死路
  4. 加 sample-time PROBE 打 `last_token` / `forced` → 准备跑
- **Codex 的 debug 路径**（对的）：
  1. 从最近的 `incidents/` 查相似错误
  2. 读 `end2end.py` (offline) 和 `serving_chat.py` (online) 找 stop 覆盖逻辑
  3. 看到 offline `for sp in params_list: if hasattr(sp, "stop_token_ids"): sp.stop_token_ids = ...` 是"对所有非 diffusion stage 覆盖"
  4. 看到 online `for stage in stage_configs: if is_comprehension: comprehension_idx = idx` 是"找 is_comprehension=True"
  5. 看 yaml `is_comprehension: false` → online 找不到 AR stage → stop 不覆盖 → 钉死
- **修法**：`is_comprehension: true` + 6 行注释解释字段语义。1 文件 7 行。

---

---

## 决策与踩坑

### 规则

#### (b) 怀疑收敛到 1 个再动手

- **禁止**：同时持有 ≥2 个独立怀疑时动手 fix 任何一个。
- **Why**：N 个怀疑里只有 1 个真，先 fix 错的 (N-1)/N 概率 = 80%（N=5）需要回滚的修改。今天 4 处全 revert 印证。

### PR #3444 实测复盘

- **根因**：`vllm_omni/deploy/hunyuan_image3.yaml:25` `is_comprehension: false`。"`is_comprehension`" 在 vllm-omni 内部语义是"tokenizer-owning AR stage"，不是用户视角的 comprehension task。yaml 写错。
