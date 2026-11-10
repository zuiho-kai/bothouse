---
name: hf-alignment-pitfalls
description: HunyuanImage3 接 HF 做 baseline / 对齐时的常见陷阱：先 grep 官方 demo 照搬 generate_image（bot_task 取 think_recaption）而不是 model.generate()（2026-04-30 think_recaption 实例），trust_remote_code 模型调试七条教训（requirements.txt 的 transformers 4.57.1、patch 改 snapshot 不改 cache 等），2026-05-18 I2T token8 漂移实为 smoke test 没传 prompt_token_ids
metadata:
  scope: 只收 HF 对齐中选错 API 入口、瞎试版本和测试输入路径这三类教训；HF baseline 的环境与 patch 步骤归 hf-baseline-runbook-1、hf-baseline-runbook-2，逐层排查顺序归 hf-omni-alignment-method-1、hf-omni-alignment-method-2，官方模板细节归 official-prompt-format
---
# HunyuanImage3 HF 对齐常见陷阱

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/hf-alignment-pitfalls.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16
- 接 HF 模型做 baseline / 对齐对比时反复犯的两类错合集——选错 API 入口和瞎试版本。

### 1. 测任何模型对齐前必先 grep 官方 demo / README

- 接 HF 模型做对齐 / baseline 对比测试时，**第一步是 grep 仓库的 README + 找 demo 脚本**，照着官方推荐的 API 调用方式跑。
- 具体动作（按顺序）：
  1. `grep -E "demo|example|generate|infer" $REPO/README.md` 找 inference 入口
  2. 看官方 demo 用的是 `model.generate()` 还是 `model.generate_image()` / `model.chat()` / 自定义 pipeline
  3. 看官方 demo 的关键参数（`bot_task`、`mode`、`use_system_prompt` 等）取值
  4. **照搬**这个调用方式跑 baseline——不要替换成"看上去等价"的更简单 API

#### 实例：HunyuanImage3 think_recaption (2026-04-30)

- **踩坑**：要测 omni 的 `is_comprehension=false` 走 think→recaption 流程，跟 HF 对比。
- **错误做法**：自己写 `model.generate(bot_task="auto", eos_token_id=[</recaption>, <answer>, <boi>])` 跑出 346 chars 输出，发现跟 omni 的 811 chars (think+recap) 完全对不上，以为"两边设计不同 / 不可比"。
- **真相（看官方 README 才知道）**：
  - 官方 demo 用的是 `model.generate_image(prompt=..., bot_task="think_recaption", ...)`，**不是** `model.generate()`
  - `generate_image()` 内部 (modeling_hunyuan_image_3.py:3237-3320) 把 `bot_task="think_recaption"` 拆成：
    - `first_bot_task = "think"` → `prepare_model_inputs(bot_task="think")` 加 `<think>` prefix
    - `stage_transitions = [(end_of_think_id, [recaption_id])]` → 强制 `</think>` 后 emit `<recaption>`
    - `final_stop_tokens = [end_of_recaption_id]` → emit `</recaption>` 时停
    - 单次 `model.generate(stage_transitions=..., final_stop_tokens=...)`
  - **`stage_transitions` 是 HF 自定义 generate 的扩展参数**，omni 的 `_StageTransitionLogitsProcessor` 跟它是同一个机制
  - 直接用 `model.generate(bot_task="auto")` **完全绕过了** stage_transitions——拿到的输出是模型"自由生成"的（HF auto 模式跳过 think 直接 recaption），跟官方推荐跑法 + omni 都不可比
- **纠正后**：复刻 generate_image 内部 AR 部分（带 stage_transitions + final_stop_tokens）才能正经跟 omni对比。
- **烧的成本**：30+ 分钟 + 跟用户解释"两边设计不同/不可比"的错误结论 + 用户一句"那为什么不照着官方，你要自己胡来"。

#### 三类容易踩的 trap

| trap | 典型反例 | 正确做法 |
|---|---|---|
| 简化 API | 用 `model.generate()` 替代 `model.generate_image()` | 找官方 demo 用的是哪个，照搬 |
| 替换参数 | `bot_task="auto"` 替代 `bot_task="think_recaption"` 因为前者"看上去等价" | 看官方 demo 里 `bot_task=` 给的是什么，照搬 |
| 删掉看似多余的设置 | `model.generate_image()` 内部传了一堆 `stage_transitions` 觉得很复杂，自己跳过这步 | 这些"复杂"的设置往往就是模型的真实解码逻辑，不能省 |

### 3. HunyuanImage3 I2T：主干有分段 BPE helper ≠ 测试已经走分段 BPE

#### 2026-05-18 — token8 漂移其实是 smoke test 输入路径错

- **症状**：用户问 HunyuanImage3 I2T 以前 HF 和 vLLM-Omni 能对齐前 20 token，为什么现在从 token8 开始漂；后来又有人说"主干已经是分段 BPE 了"，怀疑本地分支污染。
- **实际证据**：
  - `upstream/main` 的 `vllm_omni/diffusion/models/hunyuan_image3/prompt_utils.py` 已经有 `build_prompt_tokens()`，函数注释是 "Segment-by-segment tokenization that matches HF apply_chat_template"。
  - 但 `upstream/main` 的 I2T smoke test 仍用 `build_prompt(...)` 字符串路径，再交给运行时 tokenize。
  - whole-string prompt token 数是 1237；`build_prompt_tokens(...).token_ids` 是 1239；第一个输入 token diff 在 1-based token 1223。
  - 旧字符串路径导致生成 token8 开始漂；显式传 `prompt_token_ids` 后 eager / CUDA graph 都恢复 HF20 对齐。
- **根因**：把"主干有分段 BPE helper"误读成"所有调用路径已经用分段 BPE"。helper 存在不代表 smoke test、example、serving path 都调用它。字符串路径仍会跨 chat-template segment 边界做 BPE merge，例如 system prompt 尾部换行、`User: `、`<img>`、用户 prompt、`\n\nAssistant: ` 的边界。
- **怎么避免**：
  1. 查对齐问题时同时 grep **helper 定义**和**实际调用点**：

     ```bash
     grep -R -n "build_prompt(\|build_prompt_tokens(\|prompt_token_ids" \
       vllm_omni tests examples
     ```

  2. 对 HunyuanImage3 AR 输出对齐，先打印三项而不是直接跑长测试：

     ```text
     whole-string prompt token len
     segmented prompt_token_ids len
     first input-id diff
     ```

  3. 写 HF prefix smoke test 时，若 reference 是 HF `apply_chat_template` / segmented chat template，就必须传 `prompt_token_ids`，不要传 `prompt` 字符串。
  4. 结论措辞要精确：
     - "主干已有分段 BPE helper" 是源码事实。
     - "某条测试/服务路径走分段 BPE" 必须看调用点或实测 token len。
     - "分支被污染" 要用 `git rev-list --left-right --count upstream/main...HEAD` + `git diff --name-status upstream/main..HEAD` 说话。
- **本次 PR 定位**：这不是模型算子、MoE、attention、CUDA graph 精度修复；是 **I2T smoke test 输入构造修复**。让测试真正喂 HF reference 同款 segmented prompt IDs，恢复 HF20 prefix 断言的意义。

### 与 CLAUDE.md 的关系

- CLAUDE.md B7："测 HF 模型 baseline 前必先 `grep -E "demo|generate_image|prepare_model_inputs" $REPO/README.md` 找官方 API"——本文件 §1 的硬性体现
- CLAUDE.md B2："接入新模型前先做环境侦察"——本文件 §2 是它在 trust_remote_code 场景下的具体清单

## 决策与踩坑

### 1. 测任何模型对齐前必先 grep 官方 demo / README

- **Why:** 模型作者会把"正确的解码逻辑"封装进自定义 generate 函数（如 stage_transitions、final_stop_tokens、custom logits_processor），这些**不是 `model.generate()` 默认行为**。直接用 `model.generate()` 拿到的输出跟官方实际跑法可能完全不同——拿来跟 vllm-omni 对比就是错的 baseline。

### 2. trust_remote_code 模型调试七条教训

#### 2.1 先读官方 requirements.txt，不要猜版本

- transformers 4.50 → 5.6.2 → 4.57.1 试了三轮才发现官方 requirements.txt 写的是 4.57.1。浪费 40+ 分钟。
- **Why:** 每次装错版本 = 重建 venv + 重新加载模型（各 5 分钟），三轮就是 30 分钟。
- **How to apply:** 跑任何 HF 模型的官方 demo 前，第一步 `curl` 他们的 `requirements.txt`，用精确版本。

#### 2.2 trust_remote_code 模型不要假设标准参数生效

- `attn_implementation="eager"` 传了但模型自定义了 `Hunyuan_ATTENTION_CLASSES` 硬编码只有 SDPA。试了 3 轮 eager 都没用。
- **Why:** trust_remote_code 的模型代码完全自治，可以忽略任何 from_pretrained 参数。
- **How to apply:** 第一次报错就 `grep ATTENTION_CLASSES` 或 `grep attn_impl` 看模型自己的 dispatch，不要反复换参数。

#### 2.3 第一次失败后查根因，不要换参数重试循环

- transformers 版本换了 3 次，attn_implementation 换了 2 次，patch 了 4 次。每次都是"换个参数再试"而不是"看代码理解为什么失败"。
- **Why:** 盲试 N 次的期望收益远低于花 5 分钟读代码找根因。
- **How to apply:** 远端报错后，先 `sed -n` 看报错行附近 20 行代码，理解逻辑再决定修法。最多试 2 次，第 3 次必须读代码。

#### 2.4 确认用户要什么产物再跑

- 用户要 torch profiler trace（时序图 JSON），我跑了 benchmark stats JSON。浪费一轮完整的 3 配置 benchmark 时间。
- **Why:** profiling 有两种产物，不确认就跑 = 50% 概率白跑。
- **How to apply:** 用户说"profiling"时，问清楚要 benchmark stats 还是 torch trace（chrome://tracing）。

#### 2.5 pip install 单个包会拉升整个依赖链

- `pip install torchvision` 把 torch 从 2.7 升到 2.11，CUDA 不兼容。
- **Why:** pip 的依赖解析会升级已安装的包。
- **How to apply:** 永远同时 pin torch + torchvision + torchaudio 版本，或用 `--no-deps`。

#### 2.6 trust_remote_code 模型 patch 必须改 snapshot，不能改 cache

- `from_pretrained(..., trust_remote_code=True)` 每次启动都从 snapshot 重新复制到 `$HF_HOME/modules/transformers_modules/<hash>/`，覆盖对 cache dir 的任何手动 patch。
- **Why:** transformers 的 `dynamic_module_utils` 每次调用都做 hash 校验并重建 cache。
- **How to apply:** 改本轮自己维护的 snapshot overlay，不直接修改共享 cache。需要重建动态模块时，先解析并验证精确 hash 目录属于本轮，再将该单一目录移动到 quarantine；禁止对共享 cache 使用递归删除或通配符。

#### 2.7 有 runbook 就直接用 runbook 的版本，任何"先试别的"都是浪费

- 本会话用了 transformers 5.6.2 打了 7+ 个补丁（lazy_initialization / use_cache / KeyError），全部是因为没用 runbook 指定的 4.57.1。正确做法：看 runbook → 找指定 venv → 直接跑。
- **Why:** 官方指定版本是已验证过的，跑过的。偏离一个版本 = 引入任意多个 API 变化。
- **How to apply:** 进远端第一步 `grep transformers requirements.txt`，对上了再跑。`venv_hf` = transformers 4.57.1（HF baseline 专用）；`venv` = transformers 5.6.2（vllm-omni 专用）。
