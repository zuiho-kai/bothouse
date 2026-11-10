---
name: debug-funnel-cases-2
description: "调试漏斗纪律第 2 部分：PR #3611 graph mode 复盘（enforce_eager: false 的 ConstraintViolationError，Codex 给 positions 补 dynamic_arg_dims -1，4 行修复）、失败点对照表、派生规则 (d) 多层报错抓深层、(e) torch.compile 报错前先确认 tensor 真实形状，debug 开始 / 实测前 / user 说话后的 How to apply 自审，上位原则与相邻页面链接"
metadata:
  scope: "只收 PR #3611 复盘、规则 (d)(e)、How to apply 和链接；规则 (a)–(c) 与 PR #3444 复盘归 debug-funnel-cases-1"
---
# 调试漏斗纪律（2/2）

## 关键事实

- 拆分说明：本页是源页 `debug-funnel-cases.md` 的第 2/2 部分；第 1 部分 [[debug-funnel-cases-1]]
- 源页：`knowledge/repos/vllm-omni/debug/guides/debug-funnel-cases.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10

### PR #3611 (graph mode) 实测复盘

- **现象**：HunyuanImage3 AR 开 `enforce_eager: false` 报：

```
ConstraintViolationError: Constraints violated (L['inputs_embeds'].size()[0], L['positions'].size()[0])
You marked L['inputs_embeds'].size()[0] as dynamic but your code specialized it to be a constant (32768)
```

- **我的 debug 路径**（错的）：
  1. 抓第一行"两个 size 不一致" → 加 `torch._check(inputs_embeds.size(0) == positions.size(0))` 直接进 forward override → 跑 → dynamo `Eq(s59, s80)=False` 新错
  2. 切到 `shape_invariants` hook（grep 发现 llama_model_invariants 就抄）→ 跑 → 退回原错
  3. 准备开 `TORCH_LOGS=+dynamic` 深挖
- **Codex 的 debug 路径**（对的，4 行 fix）：
  1. 看报错第二行"specialized to constant 32768"→ 问 32768 哪来的 = yaml `max_num_batched_tokens`
  2. 问 positions 实际 shape 是什么 = `(3, num_tokens)` MRoPE
  3. 看 `@support_torch_compile` 默认行为 = 把每个 Tensor 参数 dim 0 标 dynamic
  4. 对照 = positions dim 0 是常量 3 不是 num_tokens，**装饰器配错位**
  5. grep 兄弟模型 `dynamic_arg_dims.*positions` → Qwen2/Qwen3/Ming 都传了 `"positions": -1`
  6. 补 `dynamic_arg_dims={"positions": -1, ...}`，4 行结束。10.7× 提速
- **我具体哪里失败**：

| 失败点 | 我做的 | 该做的 |
|---|---|---|
| 报错多层信息抓错层 | 抓第一行的 size 名字，框定成 "tie 它们" | 抓第二行的 "specialized to N"，N 是哪来的 → 哪个 dim 声明错 |
| 没看数据 | 默认 positions 跟 input_ids 一样是 `[num_tokens]` | grep yaml `mrope_section` 或 `rotary_emb(positions...)` 调用方就发现 (3, T) |
| pattern match 过快 | grep `shape_invariants` 找到 llama 例子就抄，没想 llama positions 是 1D 而我是 2D | grep 应该是 `dynamic_arg_dims.*positions`，兄弟 MRoPE 模型才是对照 |
| 重复失败没切 framing | 第二次 fail 后继续在 "tie them" 思路上变 API | 同方向 2 次 fail = framing 错，回退到 "为什么会报不一致——是声明错还是真不等" |

- **派生规则**：

#### (d) 多层报错信息抓深层不抓表层

- torch.compile / dynamo / 类型推断报错经常有两层：
  - 表层："X 和 Y 关系错"（命名两个具体 entity）
  - 深层："某个声明被某段代码烤成常量 N"（指向声明配置 / 调用代码哪里坏了）
- **规则**：报错里出现"specialized to constant N" / "marked dynamic but ... constant"，先 trace N 是哪来的（一般是某个 yaml config / max size），从那条链反推**哪个 dim 在源头标错**。**禁**先做"让 X == Y 在运行时成立"的 runtime check——那是表层 fix。

#### (e) framework 错误前先 sanity check tensor 真实形状

- 调 torch.compile / fx / dynamo 错误前，先确认每个被命名 tensor 的 runtime shape，**不**按"标准 LLM tensor shape 约定"假设。多模态模型（MRoPE / interleaved attention / cross-modal positions）经常打破"dim 0 = num_tokens"约定。
- **规则**：torch.compile 报错前问 3 件事：
  1. 这些 tensor 的 runtime shape 是什么？（不是看类型注解，看实际 forward 调用方）
  2. 装饰器自动推断的 dynamic dim 跟实际 shape 哪一维是 num_tokens 一致吗？
  3. 兄弟模型（同 attention family / 同模态架构）的 `@support_torch_compile` 调用模板是什么？

---

### How to apply

- **debug 开始时**：
  1. 列怀疑点 + 相对概率
  2. 看每个怀疑点能不能 1 行 grep 证伪
  3. 二分到 ≤1 个再动手
- **实测之前自审**：
  - 我现在多少个未排除候选？≥2 个 → 停，回去 grep
  - 上次实测验证了哪个 hypothesis？答不上来 → 那次实测白跑
- **user 说话后自审**：
  - user 说的是现象 / 诊断 / 修法？
    - 现象 → 我去 trace
    - 诊断 → 我先 framing 修法 scope（AskUserQuestion），别脑补
    - 修法 → 直接动手（B29）

---

### 链接

- 上位原则：P1（证据先行）、P4（单变量隔离）
- 相邻：execution principles（源链接 `../../../../general/debug/guides/execution-principles.md`）（用户给方案直接执行）、conclusion discipline（源链接 `../../../../general/debug/guides/conclusion-discipline.md`）（推理 vs 实测前缀）、[[style-bias-debug]]（style bias debug）（静态 diff > dump）
- 反向：[B29] user 给具体 fix 指令禁 detour（这条管的是给 fix 指令的场景，本规则管诊断不给 fix 的场景）
- 派生硬规则：CLAUDE.md B32
