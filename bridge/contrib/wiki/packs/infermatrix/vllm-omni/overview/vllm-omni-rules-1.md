---
name: vllm-omni-rules-1
description: vLLM-Omni 硬门禁（1/3）：仅适用 vllm-project/vllm-omni 的开工、场景触发器表、代码与模型、CI/测试/性能证据、远端/容器/GPU、Git/PR 与公开证据六节仓库级门禁，及相关入口列表
metadata:
  scope: 只收开工到 Git/PR 六节门禁与相关入口列表；各条以 VLLM-OMNI-PR… 为名的具体规则归 vllm-omni-rules-2、vllm-omni-rules-3；仓库入口与 owner 对照表归 vllm-omni-overview
---
# vLLM-Omni 硬门禁（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[vllm-omni-rules-2]]；第 3 部分 [[vllm-omni-rules-3]]
- 源页：`knowledge/repos/vllm-omni/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-07-10；updated: 2026-10-14
- 来源（sources）：benchmark/incidents/_index.md；ci/incidents/_index.md；git/incidents/_index.md；remote/incidents/_index.md；PR #8014；PR #8786；PR #8770；PR #8645；PR #8897；PR #8673；PR #8910；PR #8871
- 只在当前任务明确属于 `vllm-project/vllm-omni` 时应用本页。先遵守根目录 `CLAUDE.md` 的通用 P0，再执行这里的仓库专属门禁。其他仓库不得继承本页的模型、远端、测试、PR 或身份假设。

### 1. 开工

1. 确认真实 vLLM-Omni checkout、分支和目标 worktree。主基准 checkout 默认只读，业务修改使用专用 worktree。
2. 写代码前读 code taste（源链接 `../../general/review/guides/code-taste.md`）。
3. 新模型、新 pipeline、新 public entrypoint 或性能 claim 先读 mini spec（源链接 `../../general/planning/guides/mini-spec.md`）；涉及模型或 checkpoint 再读 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails）。
4. bug、crash 或行为异常先检查下面的场景触发器；直接匹配时按链接进入 owner。没有直接匹配时才进入 [[debug-overview]]（vLLM-Omni 调试入口），再通过仓库主题、`components/_index.md` 或 `models/_index.md` 确认 owner；不能停在通用规则，也不能先猜 incident 路径。
5. benchmark、profiling、GPU、serving 或远端验证先读 [[benchmark-overview]]（benchmark 入口） 和 [[remote-overview]]（远端入口）。只有规则明确提示、出现高度相似错误或用户要求历史复盘时才查错题。
6. 当前机器地址、worktree、venv、cache、容器和账号只从 ignored `local/` 获取，并用本轮 live 命令验证。

### 2. 场景触发器

| 用户提到 | 必读 | 硬约束 |
|---|---|---|
| profiling、trace、Perfetto、Nsight、算子或时序 | [[ar-graph-profiling-1]]、[[ar-graph-profiling-2]]、[[ar-graph-profiling-3]]（profiling 状态机） 和 [[benchmark-incidents-overview]]（benchmark incidents） | 默认交付 trace artifact 和质量摘要；benchmark stats 不能冒充 trace |
| graph mode、`enforce_eager=false` | 同上 | trace、目标请求和 server 日志必须证明来自同一轮 graph run |
| e2e、QPS、latency 或性能对比 | [[benchmark-scope-1]]、[[benchmark-scope-2]]（benchmark scope） 和 [[evidence-gate]]（evidence gate） | 先固定完整 metric contract，再跑正式 sweep |
| CI 红、check fail、CI 炸了 | [[ci-gotchas]]（外部 CI 自动调查；源锚点 #4-ci-红时自动调查外部-check） | 自动读取所有失败 job 的真实日志并完成 diff 归因；不能因为是 Buildkite 等外部 provider 就停下来问用户 |
| config、deploy、pipeline、CLI、strict schema、默认 factory 或 direct kwargs | [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration 规则） | 基础修改执行 `1a`–`1c`；scope 膨胀加 `1d`；strict/value-state 改动加 `1e`–`1f`；rebase/schema 扩张加 `1g`；只有规则无法解释来源加工链时再读配置审计 guide |
| stage config、并行度、设备映射或 worker 启动 | [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor 规则） | 展开最终配置，并在 worker 前验证并行 world size 和可见设备 |
| runner `_preprocess` 生产的逐请求 phase metadata，例如 `_omni_prompt_len`、`_omni_num_computed_tokens`、`_omni_is_prefill`，或由它们决定的 preprocess/MTP 路由 | [[model-executor-rules-2]]（Model Executor 规则；源锚点 #runner-到模型的预处理合同） | 先查共享 worker runner 的 producer 和路由，再查具体模型 consumer |
| 模型适配、checkpoint 或 HF 对齐 | [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model guardrails） 和对应模型入口 | plumbing 绿灯不等于语义正确 |
| 共享 diffusion pipeline、denoise loop 或**噪声/采样调度器**接入 | [[diffusion-overview]]（Diffusion 组件） | 多模型共享代码的结论放 components，单模型问题放 models |
| AR/生成**请求调度**、`OmniARScheduler`、KV transfer 调度面、prefix cache 截断 | [[scheduler-overview]]（Scheduler 组件） | 请求调度 ≠ diffusion 噪声调度 |
| connector、mooncake、跨 stage 传输损坏或 `Address already in use` | [[distributed-overview]]（Distributed 组件） | 数据面与端口分配的坑先查这里 |
| deploy YAML/CLI 合并语义、stage 显存预算（`gpu_memory_utilization`/KV pin） | [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration 规则） | 争议以展开后的最终配置为准（CONF-3a） |
| 对齐 upstream vLLM：rebase、API 漂移、模块波次 | [[rebase-overview]]（rebase 主题） | 漂移模式两页 + 工作流 |
| CLI、HTTP、OpenAI-compatible API 或 offline/online 请求行为不一致 | [[serving-overview]]（Serving 组件） | 先查入口到 engine 的边界，再进模型内部 |
| PR review | 先从 PR title/body 的声明目标命中组件或模型 owner 的快速入口，再用 changed files 和公开入口闭合 scope；owner 不明时才看 [[components-overview]]（组件职责地图） 或 [[models-overview]]（模型列表） | PR 描述只用于导航、不能证明 finding；命中 owner 后停止文档漫游，绑定当前 head、diff 和真实代码路径 |
| reviewer follow-up 且需要读取或操作 live thread | [[git-overview]]（Git/PR 入口） | 绑定当前 head、diff、live review thread 和真实代码路径；不需要 live thread 时不读 |

### 3. 代码和模型

- Algorithm 决策前先查 upstream 主入口，包括 `modeling_*`、`generation_*`、tokenizer、scheduler、denoising loop、special token、attention mask 和 KV 路径。
- Crash 或 `AttributeError` 不是停止点；必须追到错误类型为什么进入当前路径。
- 仓库场景触发器未直接命中 owner 时，仓库专有 bug 必须完成第二次路由：从 [[debug-overview]]（debug 入口） 进入仓库主题，再通过 [[components-overview]]（组件职责地图） 或 [[models-overview]]（模型列表） 找真实 owner。owner 已有 `rules.md` 时必须读取；没有时以 live 源码为准，复盘确认规则具有复用价值后再补，不为单次 issue 预建目录。
- 新模型的 `0 missing / 0 unexpected`、shape smoke、无 NaN/Inf 和 mock 权重只证明 plumbing；必须补 semantic parity matrix。
- L2 只覆盖 CPU/mock 功能且不能触发真实 stage、device 或 GPU 初始化；真实权重、精度、性能和 profiling 属于 L4。
- 新参数必须有单一 owner、公开 contract 和对应测试；禁止用 `dict.get(...) or fallback`、`hasattr`、随手 `getattr(default)` 或 `generator=None` 掩盖新旧路径不一致。
- 用户可见的 API、CLI、日志、文档或输出变更，必须按 用户可见验收（源链接 `../../general/docs/guides/user-visible-acceptance.md`） 跑真实路径。

### 4. CI、测试和性能证据

- 修改测试至少实跑目标测试文件或目标函数；`compileall`、`ruff` 和 `git diff --check` 不能替代语义验证。
- Python 最后一次改动后运行 touched files 的 `ruff check` 和格式检查，提交前按仓库现有 pre-commit 入口复核。
- benchmark 开跑前写 scope lock：代码 commit、模型 snapshot、pipeline/class、请求入口、分辨率、帧数/fps、steps、并发/请求数、warmup、seed、guidance、compile/eager、GPU 和指标公式。
- 对齐其他 PR 或框架时，PR body 只是摘要；必须核对实际 config、runner/client、请求 payload、结果 JSON 和 server log。
- 异常数字先审请求链路：`config -> runner -> dataset -> request object -> payload -> server log`。禁止先加 `ignore-first`、settle 或放宽 baseline 掩盖字段未传递。
- L4 baseline 更新前先枚举完整同组 config；性能数字只能来自对应 perf runner/result JSON，functional smoke 或 accuracy 不能替代 perf baseline。
- 性能结果必须标成 `strict apples-to-apples`、`workload-aligned only` 或 `smoke only`。不满足 strict 时不能解释为框架性能差异。
- profiling 只有真实请求完成、trace 导出、artifact 来源一致且资源释放都可证明时才算完成。`ttfc_count=0`、`tpot_count=0` 等缺失指标必须写 unavailable。

### 5. 远端、容器和 GPU

- 远端 key 使用完整 `user@host:port`。先验证 repo、worktree、venv、版本、环境变量和模型 snapshot，再运行 pytest、serve、generate 或 benchmark。
- 共享机器上他人 repo、venv 和 cache 默认只读；需要修改时使用本轮自己的 clone/worktree、venv、cache 和 run directory。
- GPU 或大模型任务启动前记录 `pwd`、磁盘、GPU、`CUDA_VISIBLE_DEVICES`、HF/XDG cache 环境和目标 snapshot 是否存在。
- Hugging Face 加载使用验证过的本地绝对 snapshot，并启用 offline 模式；cache miss、需要下载或需要写他人 cache 时停止。
- SGLang diffusion 任务先跑 diffusion detection preflight，并记录 `sglang`、`torch`、cache、`PYTHONPATH` 和 GPU 环境；判定失败不进入正式运行。
- 安装、下载、编译、serve、generate、pytest 和 sweep 必须在远端自身带 timeout/watchdog、状态文件和日志，不能只依赖本地工具超时。
- 启动服务先验证 CLI，随后同时监控 health、PID 和错误日志；单请求 smoke 通过前不进入 sweep。
- 清理只针对本轮 PGID、run directory 和能够证明归属的进程；禁止宽泛 `pkill -f python`。大目录优先同盘移动到本轮 trash，再异步删除。
- 详细规则见 live environment（源链接 `../../general/remote/guides/live-environment.md`）、HF offline（源链接 `../../general/remote/guides/hf-offline-mandatory.md`） 和 [[remote-validation-gates]]（remote validation gates）。

### 6. Git、PR 和公开证据

- 业务修改只在专用 worktree 完成；写入前确认 Git root、branch 和与目标 PR 的关系。
- vLLM-Omni commit 使用 DCO sign-off。提交和 push 前重读本节及 [[git-overview]]（Git/PR 入口）。
- PR 前检查相对目标分支的 commit 列表和 diff，避免把历史实验、其他任务或临时 artifact 带入。
- PR body 先定证据合同：小修复写真实最小回归；性能 PR 绑定当前 head、最终 config、正式 result JSON 和 server log；reviewer follow-up 只回答当前仍成立的 thread。
- PR 的测试计划和结果只写语义测试、端到端、远端实测或 CI；lint、compile、diff hygiene 不能充当行为证据。
- 多个候选 PR 必须选唯一 merge vehicle。integration PR 确认后，窄 PR 只作历史参考并及时关闭 superseded 状态。
- 提交 PR 前运行仓库提供的 scope gate；触碰 tests、examples、entrypoints、model executor 或 diffusion 时逐文件说明 owner、必要性和测试绑定。
- 推送前确认 PR head owner、目标 remote 和当前 GitHub/SSH 身份。TaffyOfficial 拥有的分支只使用本机 `local/` 中登记并已验证的 Taffy SSH remote；不得回退到默认 HTTPS 身份或自造分支名。

### 7. 相关入口

- [[rebase-overview]]（rebase（upstream 对齐））
- [[review-overview]]（review）
- [[ci-overview-1]]、[[ci-overview-2]]（CI）
- [[docs-overview]]（docs 和 RFC）
- [[debug-overview]]（debug）
- [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration 规则）
- [[git-overview]]（Git 和 PR）
- [[benchmark-overview]]（benchmark 和 profiling）
- [[remote-overview]]（remote）
- [[components-overview]]（components）
- [[models-overview]]（models）
