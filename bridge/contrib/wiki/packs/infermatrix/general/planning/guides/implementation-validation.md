---
name: implementation-validation
description: 实现与功能验证：plan 阶段 trace 完整 lifecycle、功能验证默认走 e2e 而非 FakeXxx 单测、性能优化按 trace 现象到 ownership 问题到小 PR 到双验证
metadata:
  scope: 只收通用的实现规划与功能/性能验证方法（lifecycle trace、e2e 优先、性能优化证据链与验证矩阵）及其来源事故；mini spec 模板归 mini-spec，产品闭环拆任务归 product-loop-planning
---
# 实现与功能验证

## 关键事实

- 源页：`knowledge/general/planning/guides/implementation-validation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, planning；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）："#3734"、vllm_omni/core/prefix_cache.py、repos/vllm-omni/models/hunyuan-image3/incidents/painterly/_index.md
- 每节的 **Why**（事故经过）和反模式在 决策与踩坑 一节，按同一节号对应。

### 1. Plan 阶段必须 trace 完整 lifecycle，不要拿快照建模

- 给 multi-stage 数据流相关的方案前必须 grep 全调用链 + 列读过的代码点，不要只看一处就拍方案。
- **How to apply**：
  - 给 plan 里涉及"政策决定"的小节（dispatch / routing / size / shape / placement / quantization），开头必须列一段 "决策依据" 子列表：每行一个 file:line + 一句话写它对决策的影响。强迫自己把证据链摆出来——如果只能列出 1-2 个点，要么继续读，要么明说"证据不足、方案待验证"。
  - 看到 postprocess / consumer 函数时**特别关注 input 参数的来源**。`output.X` 这种字段一看就是上游传进来的，意味着决策在更早 stage frozen——别用 consumer 行为反推 producer 意图。
  - 多 stage 数据流的方案在 plan 里画 ASCII 箭头图（`AR(选桶) → DiT(按桶 denoise) → postprocess(微调 aspect)`），把每一步谁决定什么、消费什么写出来。
  - 对应硬规则 B16："静态 diff 找到差异 → 差异 → 假设 → 隔离实验 → 才确认机制"——这条 feedback 是 B16 的 plan 阶段对偶：**看到一处行为 → 不要反推整个流程意图，必须扫完所有上游/下游证据**。

### 2. 功能验证默认走 e2e，不要给刚写的函数堆 FakeXxx 单元测试

- 用户问"这功能能不能用"时，**默认**直接 e2e（真模型 + 真输入跑一遍），不要先写一堆 FakeTokenizer / FakeModel 单元测试。
- 正确做法：用户给"加多图输入"这种 feature 需求 → 第一刀就该是远端 GPU 真跑 `examples/.../end2end.py --image-path img1,img2`，shape mismatch / placeholder count 错位类问题立刻暴露。一次 smoke 比 49 个 FakeTokenizer pytest 信息量大几个数量级。
- **How to apply**：
  - 任务问"这能不能用 / 跑没跑通 / 多图 work 吗" → 第一动作 = e2e smoke，不是写单元测试
  - 给**自己刚写的函数**写 unit test = 同义反复警报，stop。除非满足以下**全部**条件才写：
    1. 这是稳定 API（多个调用方依赖它的契约不变）
    2. 改动有 **regression 风险**（旧路径可能被新参数破坏）
    3. e2e 已经验过功能能 work（先 e2e，后单测做防回归）
  - FakeTokenizer / FakeModel / mock 满天飞的单元测试**不是覆盖**，是**自我安慰**。它们只能保护"重构这个函数时不破坏它现在的行为"——这是回归守卫的价值，**不是功能验证的价值**
  - 不确定走哪条时默认 e2e。e2e 慢但信息量真，单测快但容易写成同义反复。本仓库 `tests/e2e/accuracy/` 有现成 GPU pytest fixture 模式可以套
  - **写 e2e 不需要重新发明轮子**：`tests/e2e/accuracy/test_hunyuan_image3_it2i_ar_output.py` 之类有"加载真模型 + 跑 inference + 比 HF baseline"的模板，照抄改 prompt 就行
- **关联硬规则**：与 C5 "vllm-omni 对齐官方回归测试四条红线" 互补——C5 管 e2e 测试本身怎么写不踩坑，本条管**什么时候**该写 e2e vs unit。

### 3. 性能优化优秀模式：trace 现象 → ownership 问题 → 小 PR → 双验证

- 做框架层性能优化时，最好的路线不是直接追单个 kernel 快慢，而是先用 profiler 找**重复 work / 错层 ownership / host-side 同步点**，再用小 PR 改 ownership，最后用 profiling + accuracy 同时证明收益和正确性。
- 正确切法是先做低风险 Phase 1：
  - runner 每 step 只 staging 一次 hidden states
  - prefix cache 只校验和消费 staged CPU tensor
  - 旧 caller 不传 staged tensor 时保持原 fallback copy 行为
  - 不在同一个 PR 里顺手加 pinned memory / copy stream / GPU-resident cache / multimodal output 重构
- 这让 PR review surface 很小，同时保留后续优化空间。Phase 2 再做 pinned async staging，Phase 3 再考虑 block-boundary batching / GPU-resident cache。
- **How to apply**：
  - 性能结论必须写完整证据链：trace event → CPU/GPU 时间 → stack → source line → ownership 问题 → proposed change。
  - 优化方案先问 ownership：谁创建 tensor / buffer，谁消费，谁负责 fallback，谁持有 mutable batch metadata。
  - 进入实现前先跑 design-time 双 owner review：module owner 查模块 contract / state matrix / edge cases，omni project owner 查 repo ownership / API surface / validation evidence。不要等 patch 写完再让 sub-agent 抓问题；事后抓到 P0/P1 说明方案 gate 放晚了。
  - 第一个 PR 优先收敛 ownership 和去重，不急着引入 async、pinned、ring buffer、GPU resident 这类更大机制。
  - 如果要 defer work，必须列 producer/consumer 数据清单；来自 mutable runner/input_batch 的字段要 snapshot 到 state object，不能消费时再从全局状态取。
  - 改 runner / prefix cache / pooler payload / shared execution state 时，验证矩阵必须覆盖默认路径以外的 feature-flag 组合：cache on/off、prefix hit/miss、`requires_full_prefix_cached_hidden_states` true/false、downstream payload all/subset、last/non-last PP rank、staged CPU tensor None/fallback、deferred multimodal keys。
    - rebase / cherry-pick 后要重新跑这张矩阵，因为两边改动合起来最容易漏非默认分支。
  - 验证矩阵要把“被本 PR 激活的旧代码”当成一等路径：如果新增测试/新分支第一次消费旧变量、旧 helper 或旧 cache merge 结果，旧行也必须被 review/test。不要用 blame 判断责任后跳过验证；blame 只解释来源，不证明当前 PR 的执行路径安全。
  - 最小同路径 smoke 里的 fake 必须对齐真实对象接口。runner / scheduler / input_batch 常见字段不是裸 tensor，而是有 `.cpu` 属性、`.np` host mirror、`copy_to_gpu()` 的 wrapper；用裸 `torch.Tensor` 起 smoke 前，先 grep 真实调用点和同类 runner 用法，不确定就把 wrapper 形态也参数化进测试。
  - 如果验证入口是 online serving，把 request preprocessing 也列进矩阵，而不是只列 runner/cache 内部：OpenAI request body、`chat_template` 来源、tokenizer/processor artifact、`mm_processor_kwargs`、engine prompt 形态、sampling params list、runner feature flag。
    - server 参数组合（如 `--stage-overrides`、`--enable-prompt-tokens-details`、prefix cache 开关）会改变实际 e2e 路径，不能用同文件其它 online test 的通过结果替代。
  - transformers/vLLM 版本行为门要写进风险栏：例如 transformers 4.44+ 不再允许默认 chat template；模型 repo 可能把模板放在独立 `chat_template.json` 而不是 tokenizer 内置字段。
    - 真实 checkpoint artifact 缺失时，stub / dummy load / runner 单测只能算 blocked 或 plumbing smoke，不能支撑“online serving 可用”结论。
  - 性能 PR 的 Test Result 同时写 profiling 和 accuracy：同一 workload 的 base/patch event count / wall time / trace 指标 + eager/graph 或相关模式下的输出/精度对齐。
  - issue / PR 评论不要只贴性能数据，必须写"我准备怎么改、为什么这是框架层、预期收益来自哪里、后续期怎么拆"。
- **优秀基因**：
  - 证据链驱动：用 trace 和 stack 把性能气泡落到源码 ownership，而不是凭经验猜。
  - 小步拆期：Phase 1 去重，Phase 2 异步化，Phase 3 改 cache 结构；每期都能独立 review 和验证。
  - 正确性不让位给性能：性能收益旁边必须有 accuracy / output consistency，尤其是 graph/eager 两种模式。
  - review-ready 表达：新增参数写 contract，generic helper 命名不泄漏 caller 语义，把"需要解释"改成代码自己说清楚。

## 决策与踩坑

### 1. Plan 阶段必须 trace 完整 lifecycle，不要拿快照建模

- **Why**：2026-05-08 写 HunyuanImage3 IT2I 多图输入 PR 的 plan §3 时，看 `postprocess_outputs` 多图分支只扫到 "iterate cond images, find ratio match"（line 451-459）就以为"输出尺寸由输入图驱动"，提议把 `pipeline_hunyuan_image3.py:287-291` 的裸像素 fallback 改成 `reso_group.get_target_size(image_list[0])` 桶量化。
- **漏看了三处证据**：
  1. `output_image.width/height` 是 `postprocess_outputs` 的入参——意味着输出尺寸在 postprocess 之前就 frozen 了
  2. `SliceVocabLogitsProcessor`（`hunyuan3.0_ins/image_processor.py:32-58, 412-421`）在 AR 阶段把 ratio token 位置的 vocab 限制成 ratio tokens——`image_size="auto"` 真实含义是 AR 自己采样输出桶
  3. postprocess 不是"挑桶"是"借 cond original aspect 微调"——AR 已经选完桶了
- 正确数据流：**AR 选桶 → DiT 按桶 denoise → postprocess 微调精确长宽比**。我把第二步当第一步，方案整反。用户用一句话+截图就把方向纠了。
- 详见 Painterly 错题（源链接 `../../../repos/vllm-omni/models/hunyuan-image3/incidents/painterly/_index.md`）。

### 2. 功能验证默认走 e2e，不要给刚写的函数堆 FakeXxx 单元测试

- **Why**：2026-05-08 HunyuanImage3 多图输入 PR，我给 `prompt_utils.build_prompt(num_images=N)` 写了 49 个 pytest case，47 个用 FakeTokenizer——本质就是验证"我的函数对它声明的输入做了我让它做的事"，**同义反复零信息量**。
- 真正的风险在 vLLM placeholder expansion / AR forward / DiT denoise 这些**我函数 return 之后**的链路，pytest 49 过完全不能说明全栈多图能跑。
- 用户当面骂"测什么狗屎测那么久，直接 e2e 不就行了"——骂得对。

### 3. 性能优化优秀模式：trace 现象 → ownership 问题 → 小 PR → 双验证

- **Why**：2026-05-19 PR #3734 prefix-cache CPU staging dedup 是正例。
  - trace 先显示 CUDA graph 模式下仍有 per-step DtoH 气泡；stack 归属指向 `prefix_cache.py::_coerce_to_cpu_tensor()`；源码继续确认 GPU AR runner 同时为 prefix cache update/merge 和 pooler/downstream payload 构造 CPU hidden-state slice。
  - 结论不是"某个 CUDA kernel 慢"，而是**同一 hidden-state slice 的 CPU staging ownership 分散在多个 consumer 里**。
- **反模式**：
  - 一上来做 pinned async + GPU cache + multimodal path 全套重构，review surface 爆炸。
  - 只写"Memcpy DtoH 下降"但不写 stack/source，别人无法判断优化点是否真实。
  - deferred work 只移动 wait 点，却忘记 snapshot `slot_mapping` / `query_start_loc` / batch state 这类当步元数据。
  - 只验证 HunyuanImage3 这类默认 full-prefix hidden 路径，就把 tail-only 模型（如 `requires_full_prefix_cached_hidden_states=False`）当成“自然也会过”；这类 opt-out 分支必须有单独 payload smoke 或明确不适用理由。
  - 新增/修改的单测本地因 `vllm` 等依赖缺失跑不起来，就用 `ruff` / `py_compile` 替代行为验证。静态检查不会发现 dormant typo 被新路径激活；必须换到 CI-like 容器/远端，或写一个不依赖全 pytest fixture 的最小同路径 smoke。
    - 这个 smoke 还必须覆盖真实 abstraction 形态，不能只覆盖自己临时造的裸对象。
  - online serving CI 报 4xx 预处理错误时仍继续只看 runner 内部。400/BadRequest 往往发生在模型执行前，应该先按 request/protocol/template/tokenizer/processor 分层定位；只有请求进了 engine/runner，runner 修复才相关。
  - 把本地 pytest 缺依赖、远端 venv 不匹配等环境问题混进性能结论。环境问题只能算 blocker，不算性能数据。
