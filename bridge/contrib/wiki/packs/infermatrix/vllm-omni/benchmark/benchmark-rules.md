---
name: benchmark-rules
description: vLLM-Omni Benchmark 规则 BENCH-1a…BENCH-1j（含 BENCH-1f2）：perf JSON 零值 warmup、realtime 完成/artifact/质量分层、Hub dataset 固定 revision、per-request timeout 900s、/v1/videos 轮询预算、realtime 复测控制漂移、样本计数导出、PyAV 媒体解码、Buildkite runner 按 schema 选择、startup/raw-load 测量边界、archived baseline 采样窗口
metadata:
  scope: 只收 BENCH-* 可审计规则（触发 / 强制 / 禁止 / 验收）；证据口径和远端 scope lock 归 evidence-gate，MiniCPM-o 模型专有行为归该模型的规则页，运行步骤归 benchmark-guides-overview 所列指南
---
# vLLM-Omni Benchmark 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, benchmark；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #7648；PR #6817；tests/dfx/perf/scripts/run_benchmark.py；tests/benchmarks/test_omniinteract.py；PR #7130；PR #7259；PR #7624；PR #7504；PR #8107；PR #7312；PR #6538
- 置信度（confidence）：high
- 只有 `BENCH-数字字母` 是可审计规则 ID。证据口径和远端 scope lock 见 [[evidence-gate]]（evidence gate）；模型专有的 MiniCPM-o 行为见 [[minicpm-o-4-5-rules-1]]、[[minicpm-o-4-5-rules-2]]、[[minicpm-o-4-5-rules-3]]（MiniCPM-o 4.5 rules）。
- [BENCH-1a] perf JSON 的显式 warmup 覆盖必须保留零值
  - 触发：新增或修改 `tests/dfx/perf/tests` 的 perf JSON，或修改它传给 benchmark client 的 warmup 解析。
  - 强制：仅在字段缺失时使用 runner 默认值；显式的非负整数（包括 `0`）原样传递到 client。将测量目标标为冷请求时，在 JSON 明示 `num_warmups: 0`，而不是依赖并发数或 truthiness 推导。
  - 验收：metadata/unit test 同时断言字段缺失得到默认值、`num_warmups: 0` 仍为零，且负数、bool 或非整数被拒绝。 ^[PR #6817]
- [BENCH-1b] realtime workload 的完成、artifact 与质量资格分层
  - 触发：runner 为 realtime/OmniInteract 一类 workload 增加 PASS/FAIL 断言或汇总字段。
  - 强制：先断言计划请求全部完成，再断言 workload 汇总的 total、success、failed 与计划一致以及必需 artifacts 完整；把 official manifest eligibility 作为单独报告的质量信号。LISTEN-only 合法路径可以没有 response audio 或 transcript chunk。
  - 验收：完整 lifecycle/artifact fixture 通过；缺 summary、请求计数不符、失败请求或 `artifacts_complete=false` 的 fixture 必须失败；clipped/cancelled 等不合资格输出仍能被报告为本地 lifecycle 成功。 ^[PR #6817]
- [BENCH-1c] checked-in 外部 benchmark workload 必须可复现
  - 触发：把 Hub dataset 或媒体 archive 写入 checked-in 本地 perf JSON。
  - 强制：使用 `org/repo@immutable-revision` 形式的 dataset 标识，固定 subset、请求顺序和输出目录；filesystem fallback 同时支持 plain `org/repo` 与带 revision 的路径。
  - 验收：配置中的 dataset 标识含 revision；fallback unit coverage 覆盖 plain 与 revision 两种输入；每个固定 subset 的 case 数、并发与 warmup 设置可由 JSON 直接审计。 ^[PR #6817]
- [BENCH-1d] omni bench 共享 session 必须有界 per-request total timeout
  - 触发：修改 `vllm bench serve` / `benchmarks/patch` 的 `aiohttp.ClientSession`、`--omni-request-timeout-s` 或请求失败记账。
  - 强制：默认 per-request `ClientTimeout.total` 为 900s；显式正值覆盖默认；`<= 0` 才恢复 legacy 6h。超时必须经既有 request-func 记为 `failed`，使挂起的 server 结束 run 并写出结果 JSON，而不是占满 concurrency slot。
  - 验收：默认/显式/`<=0` 三态与 session `timeout.total`；对 accept-then-silence 的假 server 断言 `success is False` 且 run 在 deadline 内返回。^[PR #7130]
- [BENCH-1e] `/v1/videos` 轮询预算可配置，失败请求必须计入进度与报告
  - 触发：修改 diffusion serving benchmark 的 video job POST/poll/cleanup、`--video-job-timeout` 或失败汇总。
  - 强制：轮询 deadline 来自 per-request `video_job_timeout`（默认 900s，可 CLI 加大），从 job 创建后起算含排队；仅当 status 仍非 `completed`/`failed` 且超时才判失败。progress/latency 在 cleanup 路径更新，使失败请求也推进进度条；报告打印失败数与样例错误，JSON 写入全部 `request_errors`。
  - 验收：覆盖默认/加大 timeout、deadline 时已 `completed` 仍取回、混合成功/失败时进度与 `failed_requests`/`request_errors` 一致。^[PR #7259]
- [BENCH-1f] realtime 优化复测必须绑定实际加载源码并量化控制漂移
  - 触发：修复或 rebase 后重新判断 realtime chunk latency/RTF 是否回归，尤其差值接近噪声时。
  - 强制：每个 arm 用独立服务启动并核对实际模块路径、head、依赖和模型 revision；固定 workload、GPU 拓扑、compile/graph、优化开关及 instrumentation。用 baseline→candidate→ baseline 控制漂移，逐 arm 独立 warmup，明确 steady chunk 索引条件、样本数与 RTF 的 FPS。
  - 验收：产物能追溯各 arm 的真实 source/config/environment，报告候选差值和控制漂移；稳态统计可从相同筛选重算，正确性另由对应 parity 测试支持。 ^[PR #7648]
- [BENCH-1f2] benchmark 结果必须始终导出样本计数，包括零
  - 触发：修改 `benchmarks/patch` 的 result dict，或 DFX 对 `num_tpot_samples` 等计数字段的读取。
  - 强制：`calculate_metrics()` 已经产出的 `num_ttft_samples`、`num_tpot_samples`、`num_itl_samples`、`num_audio_ttfp_samples`、`num_audio_rtf_samples` 必须写入结果，包括 0，且与 percentile 是否被选中无关。JSON 往返后字段仍在。缺键是 `None`，不是 0；DFX 在 finite `mean_tpot_ms` 下仍会因 `isinstance(None, int)` 失败。
  - 验收：真实聚合加 JSON round-trip，分别覆盖 measured/unmeasured TPOT 与选中/未选中 percentile；省略 `num_tpot_samples` 而保留 finite mean 的结果必须被 baseline 拒绝。^[PR #7624]
- [BENCH-1g] duplex/eval 媒体解码必须用捆绑 PyAV，不得依赖 host ffmpeg
  - 触发：修改 `omni-duplex-eval` 或同类 benchmark 的视频时长、帧抽取、音频 PCM 解码，或重新引入 `ffmpeg`/`ffprobe` subprocess。
  - 强制：媒体路径经 PyAV（`av`）打开/seek/decode/resample；结果不得依赖主机安装的 ffmpeg 版本。帧抽取语义对齐“首个 PTS ≥ 目标时刻”；非 WAV 音频经 `AudioResampler` 并在循环后 `resample(None)` flush 尾部样本。
  - 验收：覆盖 duration/JPEG/PCM 合同与失败 raise；至少用曾触发 host ffmpeg 4.4.2 挂起的样本证明不再无限忙等。^[PR #7504]
- [BENCH-1h] Buildkite perf 步骤必须按 JSON schema 选择 runner
  - 触发：修改 `.buildkite/**` 里 `run_benchmark.py` / `run_diffusion_benchmark.py` 的 `--test-config-file`，或把 perf JSON 在 `dataset` 与 `dataset_name` schema 之间迁移。
  - 强制：按 `is_diffusion_perf_config` 选择 runner：`benchmark_params` 中存在 `dataset` 且无 `dataset_name` 的条目时为真，只有 diffusion runner 保留这些 case；`run_benchmark.py` 过滤掉这些 case，predicate 为假本身不证明 case 含 `dataset_name` 或已通过完整 schema 校验。schema 过滤不看 `mark`。迁移 JSON 后，扫描全部 CUDA/NPU/AMD 引用并核对 runner。
    - PR #8107 的 NPU HunyuanVideo-1.5 步骤同时改为 `BENCHMARK_DIR` 与对应 artifact glob；其他步骤须核对自己的输出目录和 artifact 契约，不得据此假定都采用相同 glob。
  - 验收：扫描全部 `.buildkite` 调用，断言 runner 与 JSON schema 一致；HunyuanVideo-1.5 t2v 等已迁 JSON 不得再回到 `run_diffusion_benchmark.py`。^[PR #8107]
- [BENCH-1i] startup 与 raw-load 数字必须保持测量边界并拒绝残缺样本
  - 触发：修改 MammothModa2 startup/storage benchmark、stage log parser 或 raw safetensors loading诊断。
  - 强制：分别报告import、Omni构建、first/subsequent generate与process→first image；保存实际 script hash、source/config/依赖、线程/cgroup、cache条件与每次fresh-process样本。parallel stage intervals可重叠，不能相加；weight-load与model-load差值只是setup估计，缺字段保持未测量。
  - 强制：无 `BENCH_JSON` 为incomplete，`--require-complete`使其失败；storage wrapper传播engine exit，删除旧summary/当前label旧输出，仅汇总本次成功logs。shard selection必须全匹配且非空。raw-loader materialization含page faults/CPU allocation/copy，H2D含GPU allocation；
    - CUDA setup 和operation warmup在timer外，不能称为disk bandwidth或engine-level read/cast/copy分解。
  - 验收：覆盖day/year rollover、无completion、engine非零退出、旧log/summary、缺shard/partial selection；报告rotated fresh-process重复样本及spread，memory polling另跑。性能结果只适用实际hardware/config，CUDA graph memory/headroom和质量另做matched验证。^[PR #7312]
- [BENCH-1j] archived baseline 刷新必须绑定明确采样窗口与 workload
  - 触发：据nightly archive改DFX perf JSON硬件bucket或调高latency/降低throughput reference。
  - 强制：逐metric/hardware/concurrency给出immutable raw-run links、成功数、排除原因、软件/workload差异与重算方法；同window nightly等权算术平均，最后一次round，不暗加margin。temporary realtime backend与ordinary HTTP Seed-TTS、duplex timing边界不可混用；不同版本/性能period分开，并披露选旧window或只有two-night coverage的敏感性限制。
  - 验收：独立由原始数据重算全部更改值，保持benchmark/deployment/tolerances未改且bucket/sweep位置一致；说明完整metric counts/失败数。PR #6538的69值属于历史reference，不能推断H100 reference-audio变更解释全部shift或C8 RTF<1目标已实现。^[PR #6538]

## 决策与踩坑

- [BENCH-1a] 禁止：用 `value or default`、`max(default, value)` 或类似逻辑把显式零值改成默认 warmup 数。
- [BENCH-1b] 禁止：用 manifest eligibility、非空 WAV 帧数、或是否有回应音频替代 transport/lifecycle 成功；也不能在 artifact 缺失或 request 失败时继续产出性能结果。
- [BENCH-1c] 禁止：让已提交的性能 workload 跟随 Hub 默认分支，或只测试不带 revision 的 fallback。
- [BENCH-1d] 禁止：把 6h 当默认“无超时”；只改打印文案不改 session timeout；用 warmup 成功推断测量请求不会 hang。
- [BENCH-1e] 禁止：硬编码 600s 后删除仍可能完成的 job；成功路径才 `pbar.update`；只报告成功计数而隐藏失败原因。
- [BENCH-1f] 禁止：仅设置 PYTHONPATH 就假设从目标 checkout 加载；混用不同 warmup 截断或 FPS 的指标；把小于控制漂移的差异称为确定改善/回归；把单次视频哈希相等当作 compiled bitwise determinism 或 eager 数值等价证明。
- [BENCH-1f2] 禁止：只在选中 TPOT/ITL percentile 时写出计数；用均值存在代替样本数字段；改 DFX 判定去迁就缺字段的 JSON。
- [BENCH-1g] 禁止：`subprocess` 调用 host `ffmpeg`/`ffprobe` 作为默认路径；把“本机 ffmpeg 能跑”当作可复现证据；在已知会挂起的旧 HEVC decoder 上无超时地阻塞 generate 阶段。
- [BENCH-1h] 禁止：一边已迁 omni-bench、一边仍调 diffusion runner（会 skip 全部 case，pytest 0 selected / exit 5）；把某一平台的 runner 修复外推为其他 pipeline 已对齐。
- [BENCH-1i] 禁止：把requested eviction当保证cold machine/NFS server cache；用一次fixed-seed image equality 宣称跨prompt/mode质量等价。1Hz device-global GPU采样含其他users且可能漏transient peak，process-tree RSS也只是采样；parser first-milestone的stage timeline不证明multi-replica全体时间。
- [BENCH-1j] 禁止：选择性删除慢night或把未知revision的archived均值当fixed-version因果对照；把更新 reference说成优化目标已达成，或在无consumer时说成active performance regression gate。
