---
name: vllm-omni-rules-2
description: vLLM-Omni 硬门禁（2/3）：VLLM-OMNI-PR8014-WAN22-COLDSTART（MERGE 通道 Wan2.2 冷启动拆两个 Blocking 作业）、PR8786-INTENT-GATE（贡献者自检意图门槛）、PR8770-NPU-RECORD-SHAPES、PR8645-DUPLEXEVAL-BENCH（bench serve 独占 run 目录）、PR8897-MERGE-LOOP（匹配平台 L2 为唯一合并门槛）
metadata:
  scope: "只收 PR #8014、#8786、#8770、#8645、#8897 五条规则；六节仓库级门禁归 vllm-omni-rules-1，CodeQL、评审回复清单、DuplexEval 夜间守卫三条归 vllm-omni-rules-3"
---
# vLLM-Omni 硬门禁（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[vllm-omni-rules-1]]；第 3 部分 [[vllm-omni-rules-3]]
- 源页：`knowledge/repos/vllm-omni/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-07-10；updated: 2026-10-14
- [VLLM-OMNI-PR8014-WAN22-COLDSTART] Wan2.2 冷启动 e2e 拆分独立 CI 作业并保持分层超时
  - 触发：改动 `.buildkite/amd/test-amd-merge.yml` 中 `Diffusion · Wan22` 作业的定义或编排，或调整 `tests/e2e/offline_inference/test_wan22_t2v.py` / `tests/e2e/online_serving/test_wan22_t2v.py` 中 `init_timeout`、`stage_init_timeout`、`startup_timeout` 或外层 `timeout` 的取值（本规则仅覆盖 MERGE 通道；READY 通道的 Wan2.2 作业不在范围内）。
  - 强制：Wan2.2 离线与在线两条 e2e 路径必须是两个独立的 Blocking Buildkite 作业（`Diffusion · Wan22 Offline Test` 与 `Diffusion · Wan22 Online Test`），各自拥有独立的 `timeout 40m` 进程期限，使任一路径的冷 ROCm 启动（可近 30 分钟）不挤占另一条路径；测试内层超时取 2100 秒（35 分钟），比外层作业期限少约 5 分钟留给清理（离线作业设置 `init_timeout`/`stage_init_timeout`，在线作业另设 `startup_timeout`）；
    - 拆分结构必须由 `tests/buildkite/test_upload_pipeline.py::test_amd_wan22_merge_jobs_have_independent_cold_start_budgets` 回归守护，断言每个作业命令只包含自己的测试文件。
  - 验收：`.buildkite/amd/test-amd-merge.yml` 恰好包含上述两个 Wan2.2 作业，均含 `timeout 40m` 且互不引用对方测试文件；`pytest tests/buildkite/test_upload_pipeline.py` 通过。^[PR #8014]
- [VLLM-OMNI-PR8786-INTENT-GATE] 贡献者自检意图门槛：四项人类回答、PR 必要性与 bug fix 真实失败证据
  - 触发：以贡献者身份准备、实现或提交自己的 vllm-omni 贡献（按 `.claude/skills/precheck-pr/SKILL.md` 的 `## Contributor intent gate` 在实现前运行，意图或范围变化时提交前复检），或 PR 改动 `.github/PULL_REQUEST_TEMPLATE.md`、`.claude/skills/precheck-pr/SKILL.md`、`CONTRIBUTING.md`、`docs/contributing/README.md` 中该门槛的小节、锚点或入口链接。
    - 该门槛只约束贡献者自检：SKILL.md 明确把它限定于 contributor self-review，排除对他人 PR 的独立评审与自动评审选择。
  - 强制：四个人类必答问题——想达成什么结果、对该结果杠杆最高的变量、这项工作如何推动该变量、解决谁的客户/用户的哪些需求——须由人类贡献者作答，或附其明确回答的公开安全来源引用；任务或 issue 中已有明确人类回答时直接复用，不让贡献者重复作答；agent 不得自造回答、不得从 diff 推断认可；回答缺失或明显含糊时询问人类并等待，等待期间只可继续只读调查，实现与提交均被阻断。提交前核对 PR 描述按现行模板回答全部四个必答小节：空白小节、未改动的占位注释或 agent 写的猜测都不通过，并阻断提交与 ready-for-review。
    - 答案明确后先判断达成结果是否真的需要 PR（优先既有能力、配置、文档、支持性答复或不改动；文档改动本身也可能需要 PR；不需要时停止提交流程并说明更小的下一步；需要时把窄范围与验证计划挂钩到所述结果与变量）。bug fix 须先建立真实失败：记录期望与实际行为、受影响的修订版本（revision）与环境，并附最小复现、失败的回归测试或观测到的失败 trace 之一；失败未确立时报告证据缺口并继续调查，而非宣称已确认修复。自查报告中保留这些回答及其来源。
    - 改动上述四个文件时须保留模板四个必答小节、SKILL.md 的门槛小节（锚点 `#contributor-intent-gate`）及 `CONTRIBUTING.md` 与 `docs/contributing/README.md` 指向该锚点的两处链接。
  - 验收：贡献者自查时，四个意图问题均有人类回答或公开安全引用并已回答“是否需要 PR”，bug fix 附可核验的失败证据（期望与实际行为、受影响修订版本与环境、最小复现/失败回归测试/失败 trace 之一）；改动四个文件的 PR 中，模板仍含四个带 `Required` 占位注释的小节，SKILL.md 含 `Contributor intent gate` 节，两份贡献文档指向 `#contributor-intent-gate` 的链接有效。^[PR #8786]
- [VLLM-OMNI-PR8770-NPU-RECORD-SHAPES] NPU profiler 必须显式转发 torch_profiler_record_shapes
  - 触发：改动 `vllm_omni/platforms/npu/profiler.py` 中 `NPUOmniProfiler._create_profiler` 传给 `torch_npu.profiler.profile(...)` 的参数集合，特别是 `record_shapes` 一项的取舍。
  - 强制：该调用必须保留 `record_shapes=profiler_config.torch_profiler_record_shapes` 的显式转发。依据 PR #8770 随该行新增的代码注释：缺省此参数时 NPU profiler 会静默忽略 `torch_profiler_record_shapes=True`。
  - 验收：`vllm_omni/platforms/npu/profiler.py` 的 `_create_profiler` 中，`torch_npu.profiler.profile(...)` 调用包含 `record_shapes=profiler_config.torch_profiler_record_shapes`。^[PR #8770]
- [VLLM-OMNI-PR8645-DUPLEXEVAL-BENCH] Omni-DuplexEval 并入 bench serve：独占 run 目录、计时后评分与取消语义
  - 触发：改动 `vllm_omni/benchmarks/duplex/omni_duplex_eval_serving.py`、`omni_duplex_eval_runner.py`、`omni_duplex_eval_judge.py`，或 `vllm_omni/entrypoints/cli/benchmark/`（cli_args.py / serve.py）中 `omni-duplex-eval` 数据集与 `--duplex-eval-*` 旗标在 `vllm bench serve` 的接线，
    - 或 `tests/benchmarks/duplex/test_omni_duplex_eval_serving.py` 与 `docs/cli/bench/serve.md` 的对应小节。
  - 强制：`--duplex-eval-response-root` 仅是父目录，每次调用必须在其下创建独占 `run-*` 子目录（使并发/QPS 扫描不覆盖旧结果），实际路径写日志并存入保存结果的 `omni_duplex_eval.response_root`；只有成功的测量会话在基准计时结束后发布 `<split>/<id>.json` 与 `<id>.meta.json` 工件，工件错误记入 `omni_duplex_eval` 摘要而不丢弃服务测量。
    - 可选评分（`--duplex-eval-evaluate` 及 judge 旗标）复用既有独立评测器且必须在性能计时结束后运行，按 total/evaluated/skipped/failed 报告覆盖：零 evaluated 记为 `failed` 而非合法准确率，warmup 永不评分，judge 失败不得使已完成的性能测量作废。会话语义：一个视频即一个会话/请求；正常 barge-in 取消是回合结局而非样本失败，其已收集文本仍可交给 judge；
    - 关闭会话前排空观察到的活跃响应，关闭边界产生的响应记入元数据 `unfinished_response_ids`，由结果的 `omni_duplex_eval.published_with_unfinished_responses` 计数、非零时告警；服务器错误、失败响应与排空/关闭超时仍使样本失败。媒体准备在各并发槽的 worker 线程内懒惰执行并在请求完成时释放解码输入，参考音频只编码一次共享；准备不计入单会话时延但计入总时长与吞吐；`--omni-request-timeout-s`（默认 900 秒）只覆盖准备后的完整会话。
  - 验收：`tests/benchmarks/duplex/test_omni_duplex_eval_serving.py` 通过；同一 response-root 下重复调用生成互不相同的 `run-*` 目录；保存结果含 `omni_duplex_eval.response_root`、带覆盖计数的 `omni_duplex_eval.accuracy` 与 `published_with_unfinished_responses` 字段。^[PR #8645]
- [VLLM-OMNI-PR8897-MERGE-LOOP] PR merge loop bible：匹配平台 L2 是唯一放行门槛，L3/L4 不阻塞合并
  - 触发：改动 `docs/contributing/ci/pr_merge_loop.md`（维护者 PR 合并循环指南），或 `CONTRIBUTING.md`、`docs/contributing/README.md` 中指向该指南的入口链接，或 `docs/contributing/ci/.nav.yaml` 的 `pr_merge_loop.md` 导航项；以及在评审/合并判定中应用该指南的门槛语义（合并资格、平台 L2 匹配、docs-only 跳过记录、CUDA merge-test 回归处置）。
  - 强制：合并资格 = tip 匹配的批准 + 适用的 GitHub checks 绿 + 匹配平台的 L2 ready 绿，或如实的 docs-only 跳过记录；L3/L4 不计入合并资格。L3 merge-test（`.buildkite/cuda/test-merge.yml`）可由 `merge-test` label 触发，也可合并后在 main 上运行；L4 nightly（`.buildkite/cuda/test-nightly.yml`）由 `NIGHTLY=1`/`nightly-test` 触发；
    - 两者供给 quality watch 与 LESSONS（L3 红当日 LESSONS、L4 深度 LESSONS），无论以何种方式触发都不得变成合并前门槛或逐 PR 的例行税。
    - vendor/平台 PR 必须用匹配平台门：CUDA `.buildkite/cuda/test-ready.yml`、AMD `.buildkite/amd/test-amd-ready.yml`、NPU `.buildkite/npu/test-npu-ready.yml`（NPU 有 L2/L4、无独立 L3）、Intel 静态 `.buildkite/intel/pipeline-intel.yml`（Intel 无独立 L3/L4 文件）；严禁以 CUDA-only L2 给 Ascend/AMD 等平台标绿。
    - docs-only 变更的 GPU/wheel 检查跳过必须记录为跳过而非“绿”，label 请求不覆盖该跳过，main 的定时 nightly 覆盖仍运行。CUDA merge-test 合并后变红时：先判定是否新合并变更所致，确认因果后立即 revert 该变更（不等同类堆叠或次日评审）；须区分基础设施失败与 flaky，先定位因果 commit 再 revert；失败检查、因果变更、revert 与后续写入 LESSONS；L3 仍是合并后健康检查，不是新增的合并前门槛。
    - 每 6 小时的自动 merge-readiness 刷新只是补充每日检查点，每日上限仍为 ≤10 triage / 1 deep review。首评清单验收线保持：bug 须有指名的、无该变更即失败的回归且 tip 上变绿；perf 数字必须来自同硬件 + 同 prompt 集的 tip vs baseline A/B 配对；验证者必须写明在该 tip SHA 实际运行了什么，未运行的检查列 “not run”，不得省略。
  - 验收：`docs/contributing/ci/pr_merge_loop.md` 存在并保留 CI ladder（含 L3/L4 触发方式：L3 为 `merge-test` 或合并后于 main 运行、L4 为 `NIGHTLY=1`/`nightly-test`）、High-priority selection、Daily clock、Quality watch（含 CUDA merge-test regressions 小节）与 First-comment checklist 各节的上述语义；
    - `CONTRIBUTING.md` 与 `docs/contributing/README.md` 的入口链接有效，`.nav.yaml` 含 `pr_merge_loop.md` 且 YAML 可解析；对该指南的改动不与上述门槛相矛盾。^[PR #8897]

## 决策与踩坑

- [VLLM-OMNI-PR8014-WAN22-COLDSTART] 禁止：把两条 Wan2.2 e2e 测试文件合并进单个作业命令串行执行；令内层超时大于或等于外层 `timeout 40m`；删除该 YAML 结构回归测试，或使任一作业重新包含另一条路径的测试文件。
- [VLLM-OMNI-PR8786-INTENT-GATE] 禁止：agent 编写、推测或预填意图回答，或让空白小节、未改动的占位注释蒙混过关；把合理诊断或未执行过的复现脚本当作已验证失败证据；未经人类授权把私有任务对话内容复制进公开 issue/PR（意图摘要只能在授权的受众与信息共享范围内分享）；删除或改名必答小节、SKILL.md 门槛小节或锚点导致入口链接失效；把该门槛当作 GitHub/CI 对模板的机械强制，或将它套用于对他人 PR 的独立评审与自动评审选择——SKILL.md 与贡献文档明确排除了这两种用法。
- [VLLM-OMNI-PR8770-NPU-RECORD-SHAPES] 禁止：从 `_create_profiler` 删除 `record_shapes` 转发，或将其改为不读取 `profiler_config.torch_profiler_record_shapes` 的常量，使该配置项重新被静默忽略。
- [VLLM-OMNI-PR8645-DUPLEXEVAL-BENCH] 禁止：把工件直接写入 response-root 根层或复用/覆盖既有 `run-*` 目录；在计时结束前评分、给 warmup 评分，或把零 evaluated 报成有效准确率；因 judge 失败丢弃性能结果；把正常 barge-in 取消计为样本失败；在事件循环上同步解码全部媒体或令驻留解码片段数突破 `--max-concurrency`。
- [VLLM-OMNI-PR8897-MERGE-LOOP] 禁止：把 L3/L4 当作每 PR 的合并前阻塞；用不匹配平台的 L2 结果为 vendor PR 放行或标绿；把 docs-only 跳过表述为检查通过；未排除 infra/flake、未定位因果 commit 就 revert；删除或改写指南中上述门槛语义，或移除两个入口链接与 `.nav.yaml` 导航项。
