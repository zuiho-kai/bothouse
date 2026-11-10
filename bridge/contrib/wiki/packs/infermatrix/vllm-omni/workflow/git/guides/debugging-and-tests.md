---
name: debugging-and-tests
description: "PR Workflow 第 3–5 节：PR still not fixed 时往上找根因（PR #3207 per-instance 锁污染 CUDA_VISIBLE_DEVICES）、已测过的 PR 还有 bug 时核对测试实际路径（HunyuanImage3 PR #2713/#3107/#2986）、写对齐官方测试的三类典型错误"
metadata:
  scope: 只收 PR 修复后仍有问题的调试思路与对齐官方测试的写法；分支、push、rebase 归 branch-push-rebase-1、branch-push-rebase-2、branch-push-rebase-3，PR body 证据归 pr-body-evidence，入口路由归 pr-workflow
---
# PR Workflow · Review/debugging 与测试路径

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/guides/debugging-and-tests.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#2713；#2986；#3107；#3207

### 3. PR "still not fixed" 时找上游根因，别在同层加 fallback

- 当 reviewer 说 PR "still doesn't fix the issue"，不要继续在同一层面加 fallback，要往上找：
  1. **确认失败场景**：PR 已有的 fallback 在哪个输入组合下仍然失败？
  2. **找上游状态来源**：该函数收到的"错误输入"是谁设置的？是调用方竞态还是配置错误？
  3. **检查锁的 scope**：`threading.Lock()` 在类/函数内创建 → per-instance；在模块顶层创建 → shared。并发场景下 per-instance 锁对跨实例的共享资源（如 `os.environ`）没有任何保护。
- **How to apply:** 看到"环境变量读-改-还原"模式 + 多实例并发，立刻检查锁是模块级还是实例级。

### 4. "已测过的 PR 还有 bug" → 看测试实际跑哪条 path

#### 触发条件

- 用户说"之前 PR #N 已经验证过了，但是还有问题"
- 自己接手发现某条已合并的 example/接口在 greedy 下崩坏，但 PR 描述说"已对齐 HF"

#### 不要做

- 不要直接相信 PR 描述里"已对齐 / 已通过"的字样，直接埋头改代码或重新写测。

#### 要做（实证流程）

1. **打开 PR 的"Test Plan"段，逐条问**：
   - 跑的什么 modality / mode（T2T / I2T / IT2I / T2I）？
   - 用 greedy 还是 sampling？yaml 默认 `temperature` 是多少？
   - 有没有和 HF baseline 文本逐字 diff？还是只看视觉/前 N token？
   - 有没有走端到端 string-prompt 路径？还是塞了手工 input_ids？
2. **找 PR 没覆盖的组合**：
   - 别人测了 IT2I sampling + 看图 → 你跑 T2T greedy + 看 AR 文本
   - 别人测了 forward pass（直接喂 input_ids）→ 你跑 `build_prompt(...)` 端到端
   - 别人比对了 first-30-token → 你看后面几百 token（死循环 / 重复都在后段才显现）
3. **挑能让 bug 自暴露的最小用例**：greedy 是 prompt 格式 bug 的 canary——sampling 会把错路径的概率分散，看不出问题。

#### 实证（HunyuanImage3 PR #2713 + #3107 + #2986）

| PR | 声称 | 实际测试路径 | 漏的场景 |
|---|---|---|---|
| #2713 | 加 AR 支持，input_ids 已对齐 6364 tokens | 把 HF `prepare_model_inputs` 的 input_ids 直接塞 vllm-omni → first 30 token 对齐 | 没走 `build_prompt(prompt_str)` → vllm BPE 这条路，没看 30 token 之后 |
| #3107 | 加 `examples/end2end.py` `build_prompt` | `--modality img2img --steps 30 --guidance-scale 5.0 --seed 42` + 对比图片视觉 | 没跑 greedy，没看 AR 文本，没对比 HF baseline；error 被 sampling 随机性掩盖 |
| #2986 | 加 smoke 测试 `test_hunyuanimage3_{i2t,t2i}.py` 走 `build_prompt` | I2T: `assert len(generated_text) > 0`；T2I: 对生成图算 CLIP embedding 余弦相似度 | **断言不检查 AR 文本质量**——死循环 garbage 满足 `len > 0`，IT2I 的 garbage AR 文本也能让 DiT 拼出像样的图（DiT 主要靠 cot_text 关键名词）通过 CLIP 阈值 |

- **结果**：T2T greedy 下 `build_prompt(task="t2t")` 直接产出 `massive arches massive arches ...` 死循环。三个 PR 都路过这段 build_prompt code，但**没有任何一个的断言能让 bug 暴露**。

#### How to apply

- 接到"PR 已测但还有问题"的工作，先做 4 件事再动代码：
  1. 翻 PR 的 Test Plan 一字一字读
  2. 翻**测试断言代码本身**——`assert len > 0` / 视觉相似度 / first-N-token diff 之一基本都漏 prompt 格式 bug
  3. 跑同一脚本但用 `temperature=0`（greedy）+ 完整 output 对比 HF
  4. 跑同一脚本但走端到端字符串 prompt（不是手工 input_ids）
- 任何一项产出 garbage，就把那个组合写成回归测试加进 `tests/` 再修代码。

### 5. 写"对齐官方"测试时的三类典型错误

- 写 "vllm-omni 跟官方 HF 对齐"（ImageProcessor / Tokenizer / AR-output / DiT-output）回归测试时反复犯的三类错。

#### 错误 1：把 vllm-omni 自己的副本当 "official" reference

- **表现**：写 byte-equality 测试时，"对照"导入的是 `vllm_omni.model_executor.models.hunyuan_image3.HunyuanImage3Processor`（vllm-omni 自己 PR 里的副本）而不是模型 snapshot 里的 `image_processor.py`（HF 真官方）。两者都是 PR 作者从官方拷过来的，写 byte-equality 测试拿 vllm-omni 自己当 ground truth = 自己跟自己比，**0 价值**。
- **How to apply**：写 "vllm-omni 跟官方 X 对齐" 的测试前，硬性问自己："我导入的 X 是 git-blame 在 vllm-omni 仓库里有提交记录的副本，还是从模型 snapshot 加载的、版权属于上游模型 repo 的代码？"后者才算 official。
  - 模型 snapshot 路径模板：`$HF_HOME/hub/models--<owner>--<name>/snapshots/<hash>/<file>.py`
  - 通过 `importlib.util.spec_from_file_location` + 注册 fake parent package 解决相对 import
  - 只用 `from vllm_omni... import ...` 导出的对象**永远**不能当 official reference

#### 错误 2：把"输入对齐"误当成"输出对齐"

- **表现**：用户说"AR 输出对齐官方"，去写 `apply_chat_template` 比 prompt prefill token id —— 那是 **input prompt**，不是 AR 推理出来的 **generated output**。input 对齐只能验证 prefill 模板没飘，验证不了 AR 模型本身在 vllm-omni 推理路径上输出是不是合理。
- **How to apply**：**默认按"generated output"解读**——这是更难、更有价值的那个。
  - 真测 AR 输出 = 真跑模型（HF `model.generate(do_sample=False)` + omni AR 推理）+ 比 generated tokens
  - 真测 DiT 输出 = 真跑模型 + 比像素 PSNR
  - 如果你想偷懒只做 input 对齐，**显式跟用户说**："这一条只验 prompt prefill，不跑模型；要真对 AR/DiT 输出我得多写一条 e2e 测试"
  - input-only 测试**禁止**叫 "match\_official" 之类暗示 e2e 的命名

#### 错误 2.5：从便利模板（benchmark/example 脚本）抄 input 当成 regression input

- **表现**：写 IT2I AR-vs-HF 对比，HF baseline JSON 抄了 `scripts/bench/bench_ar_hf.py` 的输入：`prompt="Describe the content of the picture." + 随机噪声图`。那是 benchmark **测 AR 速度的脚本**，输入随便挑一个"能跑通"；跟 IT2I regression 要的输入（IT2I 编辑 prompt + 真实条件图 + bot_task=think）完全不同。**两边输入分布不一致 → token 序列对比无意义**。
- **How to apply**：写对比测试前**先写一句话"本测试要 regress 的场景是什么"**（例：「IT2I greedy AR：edit prompt + 真实条件图 + bot_task=think」），然后两边 input 都从这句话派生。
  - 任何 benchmark/sample/example 脚本的输入都要重新评估，"它能跑通"≠"它跟我的 regression intent 同一个分布"
  - 红线：**两边 input 必须可以追溯到同一个 intent 描述**——能写在测试 docstring 里那种
  - sampling/greedy 也算 input。一边 greedy + max_tokens=64，另一边 sampling temp=0.6 + max_tokens=4096 = input 不一致

#### 错误 3：用户已经验证可行的路径不复用，绕路另起新路径

- **表现**：用户证明 `hunyuan_image3_it2i.yaml` 端到端跑通（生成猫图）后，要测 AR 输出，我**绕去** `hunyuan_image3_i2t.yaml`（single-stage AR-only），那条路径本环境上 hang 在 orchestrator init 8+ 分钟，**纯属浪费**。我已知 IT2I yaml 里的 AR 阶段就是要测的对象，应该直接 hook `ar2diffusion` bridge 函数捕获 AR 输出。
- **How to apply**：测试新行为前先盘点：**用户已经亲眼跑通哪条路径？我能不能在那条路径上加 hook？**
  - IT2I yaml 跑通过 → AR 输出在 stage 0 的 engine_outputs；monkey-patch `vllm_omni.model_executor.stage_input_processors.hunyuan_image3.ar2diffusion` 在 bridge 处捕获即可
  - 任何"我换个看起来更合适的 entry point"都是赌博
  - 红线：**用户说 "X 已经跑通了" 之后，我就不能在不解释清楚为什么要换路径的前提下换路径**

## 决策与踩坑

### 3. PR "still not fixed" 时找上游根因，别在同层加 fallback

- **Why:** PR #3207 只修了 `_map_device_list` 的映射逻辑（symptom），没发现真正的根因是 `_initialize_stages` 里的锁是 per-instance 的，导致多引擎并发时 `CUDA_VISIBLE_DEVICES` 被污染，才传入了"错误的" visible 列表。

### 4. "已测过的 PR 还有 bug" → 看测试实际跑哪条 path

#### Why

- "已对齐 30 tokens" 不能保证后续不发散——causal attention 让 image embedding 阶段的细微差异传播到 `<think>` 时已被放大
- sampling（temp=0.6 + top_p=0.95）能从 degenerate 模式里"跳出去"产合理输出，掩盖 prompt format bug
- 视觉只看 DiT 出图——AR 文本 garbage 也能让 DiT 拼凑出能看的图（DiT 主要靠 cot_text 的关键名词）
- **multi-stage pipeline mask 效应**：T2T 是唯一没有 DiT 兜底的纯 AR 任务，是 prompt 格式 bug 的最强 canary

### 5. 写"对齐官方"测试时的三类典型错误

#### 错误 1：把 vllm-omni 自己的副本当 "official" reference

- **Why**：导入 vllm-omni 内部模块"顺手"，不需要 trust_remote_code 也不用解决相对 import。

#### 错误 2：把"输入对齐"误当成"输出对齐"

- **Why**："对齐"在中文里两种语义都成立；写 input 测试 CPU 可跑、不需要 GPU，"似乎更轻量"，偷懒掉了。

#### 元教训

- 用户用"AR 输出"/"DiT 输出"/"PSNR"这种短词时，短中文词 → 我容易脑补一个简化版的需求并去做。**所有简化必须显式跟用户确认再执行**。
