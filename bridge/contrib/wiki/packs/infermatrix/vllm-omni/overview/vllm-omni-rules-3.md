---
name: vllm-omni-rules-3
description: vLLM-Omni 硬门禁（3/3）：VLLM-OMNI-PR8673-CODEQL-SINGLE-JOB（CodeQL 单作业三语言、仅 main 触发）、PR8910-REPLY-CHECKLIST（多动作评审回复用贡献者自有清单，不索取 CUDA L2 结果）、PR8871-DUPLEXEVAL-CI（夜间守卫走 bench serve 单调用）
metadata:
  scope: "只收 PR #8673、#8910、#8871 三条规则；其余 PR 规则归 vllm-omni-rules-2，DuplexEval 判分校验归 rules-duplexeval-judge"
---
# vLLM-Omni 硬门禁（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[vllm-omni-rules-1]]；第 2 部分 [[vllm-omni-rules-2]]
- 源页：`knowledge/repos/vllm-omni/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-07-10；updated: 2026-10-14
- [VLLM-OMNI-PR8673-CODEQL-SINGLE-JOB] CodeQL 单作业三语言扫描：仅 main 触发、组合语言 init 不带 build-mode
  - 触发：改动 `.github/workflows/codeql.yml`（作业拆分、`github/codeql-action/init`/`analyze` 的语言列表与输入、`on` 触发器、作业 `permissions`），或提议为该工作流增删语言、恢复定时扫描、改回每语言单作业结构。
  - 强制：全部 CodeQL 分析在单个 `ubuntu-latest` 作业（`analyze`）中完成，一次 `init` 以 `languages: actions,javascript-typescript,python` 组合初始化三种语言；触发器仅 `push: branches: [main]` 与 `pull_request: branches: [main]`；作业 `permissions` 保持合并时的 `contents: read` 与 `security-events: write`（PR #8673 自检核对的权限集）；
    - 组合语言 `init` 不携带单语言专用的 `build-mode` 输入，`analyze` 不指定 categories 而沿用 action 自动 categories。该文件为纯 CI 配置：验收以 pre-commit（YAML 校验、actionlint 等）与结构核对为准，不要求新增 pytest。PR #8673 合并时 hosted CodeQL 的实际运行（提取与 SARIF 上传）尚属 pending，本地 lint 通过不得被当作扫描运行成功的证据；运行性结论只能来自实际 CI 运行。
  - 验收：`.github/workflows/codeql.yml` 恰含一个 `analyze` 作业；init 的 `languages` 为 `actions,javascript-typescript,python` 且无 `build-mode` 输入；`on` 仅含指向 `main` 的 push 与 pull_request、无 `schedule`；permissions 为 `contents: read` + `security-events: write`；
    - `pre-commit run --files .github/workflows/codeql.yml` 通过。^[PR #8673]
- [VLLM-OMNI-PR8910-REPLY-CHECKLIST] 多动作评审回复用贡献者自有清单；CUDA L2/Buildkite 结果永远不向贡献者索取
  - 触发：改动 `.claude/skills/review-pr/SKILL.md` 的交付指示（多动作合并回复引用 contributor-owned checklist、省略例行流程与维护者 CI 叙述的句子），或 `.claude/skills/review-pr/references/delivery/maintainer-style-study.md`（开头适用范围句，或 `## Consolidated replies with multiple actions` / `### Reviewer CI responsibilities` 两节），
    - 或 `docs/contributing/ci/pr_merge_loop.md` 合并循环指南中 consolidated 回复段及其指向 review skill 的链接。
  - 强制：多条独立后续动作的合并回复必须用简短行动清单：证据允许时 2-4 项，单项动作可保持一句话，零发现也合法；每个 `- [ ]` 项写成动词加贡献者自有的具体交付物或完成条件，必要理由或证据放在其下；发起前先读既有评论与回复，只保留仍未解决的相关动作，不重复已解决请求；相关修订可链接短 SHA 指向完整 commit。已验证缺陷、证据缺口与可选建议须彼此区分，每个缺陷保留位置、触发、影响与修复方向。不得在给贡献者的回复中添加例行维护者/CI 状态小节、流程解释或编辑历史样板；实质性测试限制仅在与请求或结论相关时简短提及，绝不暗示未发生的评审或验证。
    - 评审者 CI 职责：永远不得要求贡献者提供项目的 CUDA L2/Buildkite 结果——维护者负责 CI admission 并检查匹配 head 的结果，这些检查保留在评审记录里而非例行转述给贡献者；须核对实际 label 与运行状态，区分未触发 admission、排队/运行、失败、通过与未知；不得在触发 label 之前（或 `ready` admission 之前）把尚未触发的 L2 结果当前置条件；当前 head 的适用 L2 仍在既有批准/合并门槛处必需（受既有 docs-only 跳过约束）；
    - 该节不替代正当的本地回归、复现或配对 A/B 证据，也不授予施加 label、重跑 CI 或启动算力的任何权限；撤回误发的贡献者向 L2 请求只需一行。`docs/contributing/ci/pr_merge_loop.md` 的合并循环段必须保留指向 maintainer-style-study.md `#consolidated-replies-with-multiple-actions` 锚点的链接及上述 CUDA L2 归属语义。
  - 验收：`maintainer-style-study.md` 保留 `Consolidated replies with multiple actions` 与 `Reviewer CI responsibilities` 两节及上述语义，SKILL.md 交付指示引用其 contributor-owned checklist；`docs/contributing/ci/pr_merge_loop.md` 合并循环段含指向该锚点的有效链接并保留“不向贡献者索取 CUDA L2/Buildkite 结果”的语义。^[PR #8910]
- [VLLM-OMNI-PR8871-DUPLEXEVAL-CI] Omni-DuplexEval 夜间守卫走 bench serve 单调用：退出码不足为凭、断言前先落盘摘要
  - 触发：改动 `tests/e2e/accuracy/omni_duplex_eval/` 下的守卫文件（`test_omni_duplex_eval_ci.py`、`test_omni_duplex_eval_ci_mock.py`、`conftest.py`、`README.md`），或 `.buildkite/common/ci_source_file_dependencies.yml` 中该守卫的源依赖过滤器；
    - 本规则覆盖既有 CUDA/NPU 夜间 Omni-DuplexEval 评分回归的调用方式、结果落盘与断言结构，不覆盖 `vllm bench serve --duplex-eval-*` 实现本身（见 VLLM-OMNI-PR8645-DUPLEXEVAL-BENCH）。
  - 强制：守卫必须以单次 `vllm bench serve --omni --trust-remote-code --duplex-eval-evaluate --save-result` 调用完成生成、评判与结果保存（PR #8645 引入的路径）。样本选择取配置的全量 ID（`--num-prompts 0`）、`--disable-shuffle`、`--max-concurrency 1`，禁用 warmup 与基准自身的请求式就绪探测（`omni_server` fixture 已等待启动）。
    - 完整结果写 `results/bench-result.json`（含 `omni_duplex_eval.accuracy`、发布错误与 `published_with_unfinished_responses`），
    - 其 `omni_duplex_eval.accuracy` 对象复制为 `results/result_acc_{model}_{dataset}_{date}_{random_number}.json`（model/dataset 取配置 ID/路径的 basename，UTC `YYYYMMDD-HHMMSS` 加 8 位随机后缀）供既有 `results/*.json` 工件上传一并收集，不得另跑第二次评测或汇总。
    - CLI 成功退出不足以判通过：必须核对 completed/published/evaluated 计数与 request、artifact、judge 错误（基准在评判失败时仍保留性能结果），摘要须在断言之前保存以便追溯失败细节；调用基准前先清除旧的 `bench-result.json` 与 `result_acc_*.json`，防止 CLI 早退后陈旧结果被当作当次结果上传。
    - 保留协议 pin（config、个体分数与摘要均匹配 `PROTOCOL_PIN`）与分数阈值断言（当前 record mode 0.0），并核对分数文件数量与 split/ID 集合同 CI 选择一致。fixture 须双设备隔离：judge 起在第一个分配设备、Omni server 起在第二个，健康的预启动 judge 可经 `VLLM_DUPLEX_EVAL_JUDGE_URL` 复用；未完成响应的样本仍可参评，其计数可从完整结果读取。
    - CPU mock 测试必须驱动真实守卫：`_run_cli` 替换为记录 argv 并保存合成基准结果的 spy，用真实 `bench serve` 解析器解析拼装命令，验证工件持久化，并在 CLI 成功退出时仍拒绝不完整的生成、发布或评判。
  - 验收：`tests/e2e/accuracy/omni_duplex_eval/test_omni_duplex_eval_ci_mock.py` 以 `core_model` + `cpu` 标记通过；`.buildkite/common/ci_source_file_dependencies.yml` 中该守卫的源依赖指向 `vllm_omni/benchmarks/serve.py`、`vllm_omni/benchmarks/patch/**` 与 `vllm_omni/entrypoints/cli/benchmark/**`；
    - README 记录双设备 fixture（CUDA 为 `full_model and cuda and (H100 or B200) and cards_2`，NPU 为 `full_model and npu and A3 and cards_2`）与结果布局（`results/bench-result.json`、`<response-root>/run-*/evaluation/evaluation_summary.json`、`result_acc_*.json`）。^[PR #8871]

## 决策与踩坑

- [VLLM-OMNI-PR8673-CODEQL-SINGLE-JOB] 禁止：把 C/C++ 加回语言列表——PR #8673 记录此前 C/C++ 扫描在仓库中找不到实现源文件（仅一个头文件）并以 `No source files found` 提取失败，除非仓库实际新增 C/C++ 实现源文件；恢复每周 `schedule` 触发或未使用的 manual-build 模板；给组合语言 `init` 添加 `build-mode` 或把扫描拆成每语言一个作业；
  - 删除或缩减作业 `permissions` 块中的 `contents: read`、`security-events: write` 声明。
- [VLLM-OMNI-PR8910-REPLY-CHECKLIST] 禁止：为凑清单数量捏造动作或省略真实 blocker；在贡献者回复中恢复例行 CI/流程叙述或编辑历史样板；要求贡献者提供 CUDA L2/Buildkite 结果，或在触发 label/`ready` admission 之前要求 L2 结果；以该格式为名放宽或绕过既有批准/合并门槛、docs-only 跳过、posting 权限与 label/CI 权限；删除或改写 SKILL.md 的清单引用、两节的清单与 CI 职责语义，或移除合并循环指南中的对应段落与链接。
- [VLLM-OMNI-PR8871-DUPLEXEVAL-CI] 禁止：把守卫改回独立的 generate→evaluate→summarize 三段式 `vllm bench omni-duplex-eval` 调用，或引入第二评测/汇总流程；仅凭 CLI 退出码放行而不核对覆盖与错误计数；先断言后保存摘要；跑基准前不清除 results 目录中的旧结果文件；删除协议 pin、分数阈值断言或 split/ID 集合核对；把 mock spy 改回只记录 argv 不落盘合成结果，使覆盖断言失去真实驱动。
