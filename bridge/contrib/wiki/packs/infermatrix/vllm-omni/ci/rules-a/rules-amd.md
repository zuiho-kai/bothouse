---
name: rules-amd
description: AMD/ROCm CI 规则 OMNI-CI-2f、2g、2i 至 2i6、OMNI-CI-OFFLOAD-1a、OMNI-CI-GPU-BOUNDARY-1a、OMNI-CI-PLATFORM-ORACLE-1a：MI300 stabilization 有界执行、单卡 job 排除 multi-card marker、ready/merge-test 选 L2/L3、ROCm Dockerfile canary、nightly suite、entrypoints ready job、exit 134 retry、AITER cache、offload backend、CPU/GPU 分片、平台 oracle
metadata:
  scope: 只收 .buildkite/amd 与 ROCm 平台专属的 CI 规则（OMNI-CI-2f 到 OMNI-CI-PLATFORM-ORACLE-1a）；跨平台通用 CI 规则归 ci-rules-1 至 ci-rules-3，构建兼容性归 rules-build-compatibility，L4/K8s 归 rules-l4-k8s
---
# AMD/ROCm CI 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/rules-amd.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #6704；PR #6830；PR #6884；.buildkite/amd/；tests/helpers/clean.py；tests/helpers/stage_config.py；tests/buildkite/test_amd_pipeline.py；tests/e2e/offline_inference/test_qwen3_omni_colocate_async.py；PR #7234；PR #6966；PR #7395；PR #6978；PR #7398；PR #8342；PR #7935；PR #7933；PR #8527
  - PR #8189；PR #8520；PR #8570；PR #8643
- 置信度（confidence）：high
- [OMNI-CI-2f] AMD CI stabilization 必须保留有界执行与测量信号
  - 触发：AMD/ROCm Buildkite bootstrap、long-running shard timeout/quarantine、GPU-memory assertion、cleanup diagnostics、Qwen3-TTS argv，或 Qwen3-Omni sleep/abort control-plane E2E 变更。
  - 强制：debug-only READY+MERGE composition 保留 normal branch selection、一个 shared build dependency 和 named groups；MI300 long steps 有 explicit bounds，已知 failing case 保持独立、time-bounded `NonBlocking`。memory comparisons 在 model/offload 后采样并清 cache；
    - 原 device-global incremental sampling 已由 worker-local allocator peak 合同替代，见 DIFF-4x；optional cleanup diagnostic 也必须 bounded。ROCm offload threshold 只是一项机制 signal，不是 portability/capacity/performance claim。^[PR #6704]
  - 强制：MI300 blocking layerwise-offload step 只 deselect exact Stable Audio parameter，并以 dependent `mi300_1` `NonBlocking` step 保留该 case；其余 params、spawn/log env 不变。ROCm BF16 AITER cross-attention 仅可用 `assert_close(rtol=1e-2, atol=1.5e-2)`，CUDA/XPU 保持 strict。^[PR #6830]
  - 强制：AMD Qwen3-TTS Base step 是 direct `pytest`（无 nested `bash -c`），列出两个 Base test files，marker 精确为 `advanced_model and cuda`、`--run-level` 为 `advanced_model`，保留 env/timeouts；这只证明 rendered argv/collection，不证明 CUDA/ROCm runtime。
    - Qwen3-Omni control-plane E2E 使用命名 `ci/qwen3_omni_moe_colocate_async.yaml`：thinker-only stage 0、single GPU、8K、`max_num_seqs=1`、eager、no prefix cache。CUDA 保留 `.9` percentage/no byte cap；ROCm 仅该 MI300-ish fixture 清 percentage 并 pin 2 GiB KV。
    - test marks 是 `advanced_model`+`omni`、one-card `H100`/`MI325`。^[PR #6884]
  - 验收：render merge/ready/combined/malformed selection、timeouts/quarantine/dependency；分别检验 ROCm sampling/cleanup 与 model assertion。PR #6884 必须 parse argv 与 platform overlay，断言 marker/run-level、CUDA preserve、ROCm-only clear/pin；最终需 exact final-head real MI300 L3 跑完两个 target jobs。
    - 该 PR 未提供该 run，现有证据仅 author-reported local/static validation。^[PR #6704] ^[PR #6830] ^[PR #6884]
- [OMNI-CI-2g] 单卡 AMD diffusion model job 必须排除全部 multi-card marker
  - 触发：修改 `.buildkite/amd` 的 Diffusion Model Test、sequence-parallel/`mi300_2` 任务，或给 diffusion 模型测试加 `cards_N` / ROCm hardware marker。
  - 强制：`mi300_1` 一类单卡 model job 的 pytest marker 必须 `not (cards_2 or … or cards_8)`，同时保留无 `cards_1` 的 legacy 单卡用例；真正需要双卡的用例（如 LTX2 Ulysses parity）改到已有双卡 lane，并声明 `rocm` 资源与 `device_count >= world_size` 早失败。
  - 验收：pipeline argv/collection 断言单卡 job 排除 multi-card markers、双卡 job 收集目标文件；硬件 marker helper 覆盖 ROCm 声明。^[PR #7234]
  - Simple CPU diffusion shard 即使 module 同时带 cpu，也必须排除全部 multi-card case；Pi0.5 的昂贵 module-scoped CPU fixture 可整体迁到独立 blocking lane，避免拆到不同 shard 重复启动。AuK 四个 graph case 用独立 GPU selector；Ulysses mask-layout 在真实 two-GPU lane执行。
  - PR #8342 的 `not cards_2…cards_8` 仅修 multi-card misrouting，不保证排除所有 cards_1 GPU case。MERGE 的 Ulysses command 又位于 Z-Image TP 后；前一 command hang/fail 时目标可能未执行。审查须检查目标 node 的实际终态，不从 YAML presence/邻近 pass 推断全树 CPU/GPU routing 闭环。专用 CPU/GPU per-test marker 防空转合同见 OMNI-CI-1a。^[PR #8342]
- [OMNI-CI-2i] AMD bootstrap 必须按 ready/merge-test 标签选择 L2/L3 suite
  - 触发：修改 `.buildkite/amd` bootstrap、`select_test_suites.py`、AMD PR label 路由，或 skip-ci 对 AMD suite 的过滤。
  - 强制：`ready` 选 L2（ready suite），`merge-test` 选 L3（merge suite）；两标签同时存在时合并多 suite 且共享一次 image build；`DEBUG_TEST_YAML` 优先；main 继续 L3；无 tier 标签的 PR 可保留 legacy ready fallback。PR labels 精确匹配且失败时 fail closed；skip-ci 必须对已选 L2/L3 独立过滤。
  - 验收：selector/bootstrap 单测覆盖 ready-only、merge-only、both、debug override、main、label fetch failure 与 per-suite skip-ci；日志报告实际 `TEST_SPECS`。^[PR #6966]
- [OMNI-CI-2i2] ROCm Dockerfile 必须与 CI 的 vLLM release 对齐并在构建期 canary
  - 触发：修改 `docker/Dockerfile.rocm` 的 `BASE_IMAGE` / `VLLM_VERSION_OR_COMMIT_HASH` / `USE_NIGHTLY_BUILD`、`.buildkite/amd` 的 image build 命令，或 AMD 运行时因缺失 vLLM API 失败。
  - 强制：默认 `BASE_IMAGE` tag 与可选 source rebuild 的 `VLLM_VERSION_OR_COMMIT_HASH` 都必须等于 `docker/Dockerfile.ci` 的 `VLLM_BASE_TAG`；AMD build 不得 `--build-arg` 覆盖这两个默认。可选 nightly 重装之后、业务层拷贝之前，必须用当前 Omni 依赖的 vLLM API 做 image-build canary，构建失败优于整 lane runtime 失败。
  - 验收：静态回归断言 ROCm base/source ref 跟踪 CI tag、默认 `USE_NIGHTLY_BUILD=0`、AMD build 不覆盖上述 arg、canary 位于 nightly 块之后；故意错位 pin 必须失败。^[PR #7395]
- [OMNI-CI-2i3] AMD nightly suite 必须可显式选中且不受 L2/L3 skip-ci 误杀
  - 触发：修改 AMD bootstrap/`select_test_suites`、`NIGHTLY_TESTS` YAML、`nightly-test` label，或 skip-ci 对 suite spec 的过滤。
  - 强制：`nightly` 映射 `NIGHTLY_TESTS:test-amd-nightly.yml`；`main+NIGHTLY=1` 或 PR `nightly-test` 选中它；可与 ready/merge 组合共享一次 image build。`NIGHTLY_TESTS:*` 在 skip-ci 过滤中原样保留，docs-only 也不得剥掉显式/scheduled nightly。burn-in 叶子保持 `NonBlocking` 直至另有 gate。
  - 验收：渲染 `DEBUG_TEST_YAML=nightly`、`NIGHTLY=1`、组合 label 与 docs-only+nightly，断言 suite spec 与子 pipeline 叶子集合。^[PR #6978]
  - 新 AMD nightly 使用 shared native runner、精确 node/selector 的 fail-closed collect-only，再执行同一 selection，JUnit 从 /tmp staged 到 checkout-relative artifact root。rendered template 已注入 amd-build 依赖时不重复 source field；通用 template/schema tests 与 rendered inspection 验证所有权，避免每新增 job 都复制只复述配置的 UT。
  - LingBot ROCm 单卡仅给 CFG-off case MI325 eligibility，batch-CFG sibling 仍 CUDA-only；Cosmos3 保留 CUDA marks并增加 exact ROCm T2I node。NonBlocking、collection 与 artifact 不是模型质量或目标 MI300 pass。两个 source 的最终 step budget 都为 90min。^[PR #7935] ^[PR #7933]
  - Cosmos3 prewarm 与 server 使用同一 job-local AITER/Torch cache。仅在 ROCm、真实 FA可用且 `AITER_JIT_DIR` 明示时，以 masked/unmasked BF16 MHA 分别检查输出 shape/finite 和两项预期 `.so` 存在；prewarm 55min、test 25min 均以 TERM/kill bounds 留出 90min step信封。^[PR #7933]
- [OMNI-CI-2i4] AMD entrypoints GPU ready job 必须单次 pytest、有界超时并检测进程泄漏
  - 触发：修改 `.buildkite/amd/test-amd-ready.yml` 的 entrypoints/R2-02 GPU coverage、artifact 根路径，或 teardown 进程快照比较。
  - 强制：`mi300_1` NonBlocking job 设 `VLLM_WORKER_MULTIPROC_METHOD=spawn`，marker 排除 `cards_2`–`cards_8`，只跑一次 verbose pytest（禁止第二趟 `--collect-only`）。内层 `timeout` 短于 Buildkite step，为 teardown/artifact 留窗口。artifact 根在 Buildkite checkout；前后 `ps` 快照用 PID+start-time 身份比较，泄漏则 fail closed。
    - 零 collection 不得被允许通过。
  - 验收：结构断言单次 pytest、超时信封、marker、六类 artifact 与 `process-cleanup` PASS；真实 MI300 跑通 selected node。^[PR #7398]
- [OMNI-CI-2i5] AMD exit-status retry 只能表达有界恢复策略
  - 触发：为 AMD READY/MERGE Simple Diffusion shards 增加 automatic retry。
  - 强制：两 suite 保持相同 `exit_status: 134, limit: 1`，Kubernetes retry 从 fresh pod 开始。assertion exit1、timeout124、OOM137 与其他 exit不在该 retry selector 中。
  - 验收：rendered READY/MERGE 保留唯一134 retry及既有timeout；从original/retry job日志核对 source SHA、pod身份、exit与terminal结果，分别报告status选择和实际根因。^[PR #8520]
- [OMNI-CI-2i6] AMD AITER cache 复用必须保留完整文件与 blocking backend 覆盖
  - 触发：将cold-compiling diffusion attention tests迁入共享AITER lane或修改test backend override。
  - Mammoth READY 保留整个 attention file：blocking model lane 在 production `OmniDiffusionConfig` context 下显式 TORCH_SDPA；default AITER 的完整 file 位于已有 nonblocking attention suite 后，共用已暖的 job cache。直接构造 DiT 时也必须进入相同 config context，并断言 env override到达 `TransformerBlock`。
    - 不能只挪一个 node、只设 env 或只延长 timeout 来宣称避免 cold compilation；两条 backend/lane 分开资格化，warm default run 不代替 blocking SDPA或MERGE coverage。^[PR #8527]
  - 验收：rendered argv覆盖完整file与两个backend；production config context下直接构造layer 证明显式backend到达consumer，default backend仍命中平台默认；exact target jobs分别记录 collection、cache复用和terminal结果。静态/缺依赖的local run不能宣称MI300 runtime pass。^[PR #8527]
- [OMNI-CI-OFFLOAD-1a] AMD offload lane 显式选择独立 diffusion backend
  - 触发：修改 AMD merge 的 diffusion offloader 测试命令或 backend env。
  - 强制：在两个 offloader pytest 命令之前 export DIFFUSION_ATTENTION_BACKEND=TORCH_SDPA，使 backend-independent offload 行为不被 AITER attention 构建依赖阻塞；其他 attention 专项 lane 维持自身 backend 目标。
  - 验收：检查 export 顺序及两个命令的有效环境，确认 offload 断言仍保留；实际 lane 结果另报告。 ^[PR #8570]
- [OMNI-CI-GPU-BOUNDARY-1a] 冷 GPU 编译不得占用 CPU 分片预算
  - 触发：修改 AMD diffusion CPU sharding、JoyImage GPU lane 或 artifact paths。
  - 强制：GPU inference 用例与 CPU 单测分模块和 marker，保留 CUDA 一卡路由；JoyImage default-AITER 完整 GPU suite 由独立 nonblocking AMD nightly 承载，job 隔离 JIT/extensions cache，并保留 JUnit/durations。READY/MERGE CPU 分片配置同步，fail-closed pytest 输出 shard 唯一、checkout 相对的 JUnit。当前 5 分片/60 分钟及 nightly 90/80 分钟为可调整预算，按真实冷启动证据复核。
  - 验收：pipeline 断言与两 lane YAML 同步，验证 CPU/GPU collection 不串组、artifact 唯一且被收集；冷 run 的耗时和结论单独记录。 ^[PR #8643]
- [OMNI-CI-PLATFORM-ORACLE-1a] 平台测试保留实际 dispatch 与有效输出 oracle
  - 触发：修改 NVIDIA/ROCm graph eligibility、JoyImage default backend 测试或 VDN float64 reference。
  - 强制：NVIDIA flow-encoder capture 与 ROCm eager fallback 分开断言，保留 shared-arena 测试；JoyImage 用 inference_mode，default backend 与 SDPA 比较所有 image 和有效 text 输出，并扰动 padded text 证明有效输出不变。HIP wheel 缺 CPU LAPACK 时 VDN solve-rule reference 用 ROCm GPU，无 GPU 明确 skip，非 HIP 仍 CPU。
  - 验收：覆盖平台先验与 dispatch，检查无 GPU skip 范围，保留独立数值 oracle和 padded-text 不变性；单次平台通过不外推其他设备。 ^[PR #8643]

## 决策与踩坑

- [OMNI-CI-2f] 禁止：把 debug override 当默认 routing、用邻近 green shard/NonBlocking/旧 head 宣称 target case resolved，或让 diagnostic hang bypass timeout；不得把 absolute device use 当 model peak、ROCm tolerance 扩展到其它平台/path/quality/runtime parity，或把 2 GiB 外推为生产/其他 model/SKU sizing。
- [OMNI-CI-2g] 禁止：让 `cards_2+` 测试在单卡 worker 上 spawn rank1→GPU1 导致 `invalid device ordinal`；用邻近 green shard 宣称 multi-GPU routing 已修好。
- [OMNI-CI-2i] 禁止：凡 PR 一律上传 ready suite；用子串匹配 labels；在仓库侧假装已改变 Buildkite 外部 trigger 条件；把 `nightly-test` 当成已有 AMD L4 覆盖。
- [OMNI-CI-2i2] 禁止：只升 Omni 代码而留下过期 ROCm base；把 canary 推到测试阶段；用自定义 source pin 却不更新 `tests/buildkite/test_rocm_dockerfile.py`；把 Docker pin 误当成非 Docker 安装会自动装上匹配 vLLM。
- [OMNI-CI-2i3] 禁止：把 `nightly-test` 当成无 suite 的噪声 label；用 L2/L3 diff gate 静默丢掉已选 nightly；把实验 nightly 阈值外推为 CUDA H100 基线。
- [OMNI-CI-2i4] 禁止：依赖 PID-only 比较掩盖 reuse；把 CUDA pipeline 定义当作 ROCm ready 覆盖；用邻近 green shard 宣称本 job 合同已满足。
- [OMNI-CI-2i5] 禁止：将任意134诊断为GPU hang，或让源码确定性失败/冷编译timeout进入无界重跑；成功retry 不抹去原失败证据。job-specific配置UT不应替代 generic retry/template保留与真实失败日志。
- [OMNI-CI-OFFLOAD-1a] 禁止：假定 VLLM_ROCM_USE_AITER 同时控制 diffusion attention；从 YAML 改动推断已获得某个运行时或耗时。
- [OMNI-CI-GPU-BOUNDARY-1a] 禁止：让冷 AITER 编译藏在 CPU marker 下；靠扩大 skip 或宽松退出状态掩盖失败，或把 nonblocking 配置当作 runtime 已验证。
- [OMNI-CI-PLATFORM-ORACLE-1a] 禁止：将 NVIDIA capture 期望施加给 HIP；强制 SDPA 而丢 default-AITER 检验；为测试 LAPACK 缺失改变生产算法，或以 padded-query 差异放弃有效 key-mask 验证。
