---
name: rules-amd-ci-1
description: vllm-omni AMD/ROCm CI 规则（上）：VLLM-OMNI-PR9227-R2-01-SHARDING（READY R2-01 双分片 pytest-shard、分片独占工件、45m/50m 超时）、VLLM-OMNI-PR9224-AITER-MHA-ABI-FALLBACK（AITER MHA 缓存候选顺序与发布）、VLLM-OMNI-PR9126-WAN22-I2V-ACC-NIGHTLY（Wan2.2 I2V MI300 夜间精度单 pod 作业）
metadata:
  scope: "只收 PR #9227、PR #9224、PR #9126 三条 AMD CI 规则；Qwen3-Omni Seed-TTS 夜间基准与夜间源依赖过滤两条归 rules-amd-ci-2；MERGE 通道 Wan2.2 冷启动拆分归 vllm-omni-rules-2"
---
# vllm-omni AMD/ROCm CI 流水线规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-amd-ci.md` 的第 1/2 部分；第 2 部分 [[rules-amd-ci-2]]
- 源页：`knowledge/repos/vllm-omni/rules-amd-ci.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-10-22；updated: 2026-10-25
- 来源（sources）：PR #9227；PR #9224；PR #9126；PR #9307；PR #9372
- [VLLM-OMNI-PR9227-R2-01-SHARDING] AMD READY R2-01 双分片：pytest-shard 切分、分片独占工件、fail-closed 与超时保留
  - 触发：改动 `.buildkite/amd/test-amd-ready.yml`（AMD READY 通道，区别于 PR #8014 覆盖的 MERGE 通道 test-amd-merge.yml）中 `ROCm · Model Executor GPU Coverage (R2-01) · Shard %N/%t` 步骤——`parallelism`、pytest 命令、junit/log/summary 工件路径、超时或 grade——或 `tests/buildkite/test_amd_ready_r2_01.py` 结构回归测试的断言。
  - 强制：R2-01 必须保持 `parallelism: 2` 的两个并行 `mi300_1` 分片，label 以 `· Shard %N/%t` 结尾；分片只能经 pytest-shard 旗标 `--num-shards=$$BUILDKITE_PARALLEL_JOB_COUNT`、`--shard-id=$$BUILDKITE_PARALLEL_JOB` 实现，pytest 选择面保持不变（单卡 marker 表达式、`--run-level "core_model"`、`--durations=0`、`-v`、`-ra`）；
    - junit XML、tee 的 log 与 `tail -n 100` 生成的 summary 三类工件文件名都必须嵌入 `$${BUILDKITE_PARALLEL_JOB}-of-$${BUILDKITE_PARALLEL_JOB_COUNT}` 后缀，使并发分片互不覆盖；
    - 保留 `timeout --signal=TERM --kill-after=2m 45m` 命令超时（为 summary 工件留约 5 分钟）、`timeout_in_minutes: 50`、`grade: NonBlocking`、`mirror_hardwares: [amdproduction]`、`depends_on: amd-build`，以及 fail-closed 语义：该步骤恰好一条 pytest 命令、无 `--collect-only`、无 `VLLM_CI_ALLOW_NO_TESTS`。
    - 结构必须由 `tests/buildkite/test_amd_ready_r2_01.py` 回归守护：断言 `parallelism == 2`、argv 含两个分片旗标与 `-v`/`-ra`/`--durations=0`、三类工件名带分片后缀、单条 pytest 命令、fail-closed 旗标缺失与 45m/50m 超时。动机（PR #9227 记录的实测）：单作业选中 1,811 个用例需 pytest 34m21s、作业 35m05s（build 14388）；
    - 双分片实测 19m01s/21m35s、关键路径 22m22s，且两个 AITER MHA kernel 在每个干净 worker 上独立编译（253-254s 与 275-278s），分片不会摊薄每分片的编译成本。
  - 验收：`.buildkite/amd/test-amd-ready.yml` 的 R2-01 步骤含 `parallelism: 2`、以 `· Shard %N/%t` 结尾的 label、pytest 命令含 `--num-shards` 与 `--shard-id`、三类工件名均含 `-of-` 分片后缀、命令级 `45m` 与 `timeout_in_minutes: 50`、`grade: NonBlocking`；
    - `python3 -m pytest --confcutdir=tests/buildkite tests/buildkite/test_amd_ready_r2_01.py -q` 通过；`pre-commit run --files .buildkite/amd/test-amd-ready.yml tests/buildkite/test_amd_ready_r2_01.py` 通过。^[PR #9227]
- [VLLM-OMNI-PR9224-AITER-MHA-ABI-FALLBACK] AMD AITER MHA 缓存：精确可信源在前、可信分支非 PR 回退候选随后追加，注意力套件成功后发布
  - 触发：改动 `.buildkite/amd/scripts/aiter_mha_cache.py` 中候选构建来源的发现或生产者校验（`candidate_sources`、`discover_build_sources`、`discover_recent_branch_sources`、`_build_numbers_from_listing`、`provenance_matches_source`）；或改动 `.buildkite/amd/test-amd-ready.yml` 中 FlashAttention/AITER 作业的缓存 prepare、注意力测试编排与发布步骤；
    - 或改动 `tests/buildkite/test_aiter_mha_cache.py`、`tests/buildkite/test_amd_pipeline.py` 中对应契约测试。R2-01 lane 的分片契约不在本规则范围（PR #9224 明确不改该 lane，见 VLLM-OMNI-PR9227-R2-01-SHARDING）。
  - 强制：`candidate_sources` 必须保持“精确可信来源在前、可信分支回退候选在后”的列表顺序：先收集同 PR/head commit/merge base/精确 checkout 的早期构建与可信 commit 上的非 PR 构建；
    - 随后对每个可信分支（`main`；本构建为非 PR release-line push 时含 `release/vX.Y.Z`）调用 `discover_recent_branch_sources` 追加其最近的非 PR 构建（默认 `limit=15`，commit 须为完整 SHA、剔除 PR 构建与当前构建自身，按 build_id 去重）。该追加是无条件的——调用点不检查精确来源是否已找到，优先级完全由列表顺序表达；
    - `discover_recent_branch_sources` 文档所述“精确 merge-base 从未发布（如镜像 ABI 升级后）”只是该函数的动机说明，不是调用前提。兼容性闸门是既有工件校验链（checksum、`gfx942` 设备码、运行时 ABI 身份哈希、Buildkite 来源元数据、provenance），不是 Omni merge-base SHA 等值——`.so` 由 ROCm 镜像内的 AITER 产出，身份哈希才是兼容依据；
    - 因此 `provenance_matches_source` 对可信分支非 PR 生产者只要求：分支属于可信分支、非 PR、`VLLM_OMNI_AITER_MHA_TRUSTED_COMMIT` 为完整 SHA。消费方仍获得 job-local 可写副本，缓存未命中时在该目录原地编译。Buildkite 查询/校验失败的日志必须脱敏：不得携带 commit、branch 或异常文本，仅输出固定措辞（可含构建号）。READY 的 FlashAttention/AITER 作业仅在注意力测试套件退出码为 0 时发布该模块，使后续 READY/MERGE 作业可命中同一 ABI。
  - 验收：`tests/buildkite/test_aiter_mha_cache.py` 与 `tests/buildkite/test_amd_pipeline.py` 通过；`aiter_mha_cache.py` 的 `candidate_sources` 在精确来源之后无条件追加去重、排除自身构建的可信分支非 PR 候选，可信分支 provenance 保持三项条件，失败日志为脱敏固定措辞；`test-amd-ready.yml` 的 FA/AITER 作业仅在注意力套件成功（退出码 0）后发布模块。^[PR #9224]
- [VLLM-OMNI-PR9126-WAN22-I2V-ACC-NIGHTLY] Wan2.2 I2V AMD MI300 夜间精度作业：单 pod 基线→在线→比对、收集钉死三节点、缺前置工件 fail closed
  - 触发：改动 `.buildkite/amd/test-amd-nightly.yml` 中 `:full_moon: Wan2.2 Accuracy MI300 Nightly` 组或 `Wan2.2 I2V Accuracy 2 GPU` 作业的定义（agent 池、grade、超时、env、命令、artifact 路径）；
    - 或改动 `tests/e2e/accuracy/wan22_i2v/prerequisite.py` 的 `require_similarity_artifacts`、`tests/e2e/accuracy/wan22_i2v/test_wan22_i2v_video_similarity.py` 的比对前置与结果落盘；或改动 `tests/buildkite/test_amd_pipeline.py` 中三个 Wan2.2 精度契约测试。本规则只覆盖 AMD 夜间通道；
    - MERGE 通道的 Wan2.2 e2e 冷启动拆分另见 VLLM-OMNI-PR8014-WAN22-COLDSTART，两轨互不替代。
  - 强制：该精度路径必须是夜间流水线中恰好一个 NonBlocking 作业：组内仅 `Wan2.2 I2V Accuracy 2 GPU` 一步，`agent_pool: mi300_2`、`grade: NonBlocking`、`timeout_in_minutes: 180`、`env.DIFFUSION_ATTENTION_BACKEND: TORCH_SDPA`、工件根 `artifacts/rocm-wan22-accuracy-2gpu/**/*`。
    - 三个测试节点 `test_wan22_i2v_diffusers_offline_generates_video`、`test_wan22_i2v_online_serving_generates_video`、`test_wan22_i2v_serving_matches_diffusers_video_similarity` 必须在同一 pod 内按此固定顺序、以单次 `pytest -s -v` 调用执行：离线 diffusers 基线（cards_1）先运行，其产物供同 pod 内后续的 cards_2 在线生成与比对消费，基线生成与比对不得拆到不同 pod。
    - marker 必须保持 `full_model and diffusion and rocm and MI325 and (cards_1 or cards_2)`，同时容纳 cards_1 与 cards_2，不得收窄为仅 cards_2。正式运行前必须 `pytest --collect-only -q` 预收集：输出写入工件目录 `collection.txt`，逐一 grep 确认三个节点均被收集，并断言收集到的 `::` 节点数恰好为 3；任一不满足即以 `exit 5` 失败，防止 marker 漂移导致静默少跑。
    - 比对必须 fail closed：`require_similarity_artifacts` 对任一缺失前置工件（在线视频、离线视频、离线 metadata）抛出指名缺失路径的 AssertionError——被跳过的比对不算精度覆盖。比对摘要以 `similarity.json` 落盘；
    - 生成的视频与元数据写入测试运行期在 `tests/e2e/accuracy/wan22_i2v/` 目录下生成的 `result` 输出目录（运行期产物，非仓库检入路径），作业命令须在透传退出码前以 `if [[ -d ... ]]` 守卫把该目录 `cp -a` 复制进工件目录的 `result/` 子目录。内层 `timeout --signal=TERM --kill-after=2m 165m` 必须短于外层 180 分钟作业期限，pytest 退出码经 `PIPESTATUS[0]` 透传后决定作业结果。
  - 验收：`pytest tests/buildkite/test_amd_pipeline.py` 通过；`.buildkite/amd/test-amd-nightly.yml` 该组恰含一个 `mi300_2`、`NonBlocking`、`timeout_in_minutes: 180`、`TORCH_SDPA` 的 `Wan2.2 I2V Accuracy 2 GPU` 作业，命令含 `--collect-only`、`exit 5` 且三节点按固定顺序出现；ready 与 merge 流水线不含 `Wan2.2 I2V Accuracy`；
    - `require_similarity_artifacts` 在任一工件缺失时抛 AssertionError、齐全时静默通过。^[PR #9126]

## 决策与踩坑

- [VLLM-OMNI-PR9227-R2-01-SHARDING] 禁止：移除 `parallelism` 退回单作业串行；以拆分 marker 表达式或测试选择的方式代替 pytest-shard（改变选择面）；使用不带分片后缀的共享 `pytest.xml`/`pytest.log`/`pytest-summary.txt` 文件名让并发分片互相覆盖工件；缩短 45m 命令超时或 50m 作业超时；改动 `NonBlocking` grade 或 `mirror_hardwares`；引入 `--collect-only` 或 `VLLM_CI_ALLOW_NO_TESTS`；
  - 删除或削弱结构回归测试中 parallelism、分片旗标、分片工件名、fail-closed 或超时断言。
- [VLLM-OMNI-PR9224-AITER-MHA-ABI-FALLBACK] 禁止：把可信分支回退候选排在精确可信来源之前；对可信分支来源恢复 `source.commit == VLLM_OMNI_AITER_MHA_TRUSTED_COMMIT` 的等值要求；接受 PR 产生的、当前构建自身的、或未通过校验链的原生模块进入另一构建；在注意力套件非零退出时发布模块；在失败日志中回填异常文本、commit 或 branch 值；删除候选排序、可信分支 provenance、PR 拒绝、不兼容 ABI 拒绝、checksum 校验、敏感值日志或 FA 发布的契约测试。
- [VLLM-OMNI-PR9126-WAN22-I2V-ACC-NIGHTLY] 禁止：把该组拆成多个作业，或把基线生成与比对分离到不同 pod 形成跨 pod 工件依赖；将 `grade` 改为阻塞合并的级别，或把 `Wan2.2 I2V Accuracy` 作业加入 `.buildkite/amd/test-amd-ready.yml` / `.buildkite/amd/test-amd-merge.yml`；删除 `--collect-only` 预收集、三节点逐一核对或 `exit 5` 计数断言；
  - 把缺前置工件的比对改回 skip 路径（相似度测试文件不得回归 `Missing offline artifacts` 字样）；把命令换成或混入 `test_diffusers_backend_similarity.py` 节点；
  - 删除或放宽 `test_wan22_accuracy_has_one_nonblocking_comparison_job` 与 `test_wan22_similarity_fails_when_offline_baseline_is_removed`、`test_wan22_similarity_accepts_complete_artifacts` 两个单元测试；删除 pytest 结束后复制 `result` 输出目录的命令块，使失败运行丢失视频与元数据证据。
