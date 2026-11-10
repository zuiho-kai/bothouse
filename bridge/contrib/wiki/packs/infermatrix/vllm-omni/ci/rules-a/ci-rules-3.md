---
name: ci-rules-3
description: vLLM-Omni CI 规则（3/3）OMNI-CI-3a、3b、3c、3d、1f、4a、1g、1h：DFX perf baseline artifact 与回归 gate 的区分（TPOT/ITL 来源、hardware 嵌套结构、mean_audio_rtf）、patched benchmark 兼容、XPU release image、ASR 文本归一化、CUDA mirror HF_TOKEN alias、失败 job 闭环、registry diff 过滤、xdist 全局 GPU cleanup
metadata:
  scope: 只收通用 CI 规则 OMNI-CI-3a、3b、3c、3d、1f、4a、1g、1h；入口表见 ci-rules-1，OMNI-CI-1a 至 2a 见 ci-rules-2；TTS perf 配对归 rules-tts，xdist fixture 合同归 rules-test-fixtures
---
# vLLM-Omni CI 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[ci-rules-1]]；第 2 部分 [[ci-rules-2]]
- 源页：`knowledge/repos/vllm-omni/ci/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-08-23；updated: 2026-10-06
- [OMNI-CI-3a] DFX baseline artifact 与性能回归 gate 是两个合同
  - 触发：修改 perf JSON 的 `baseline`、硬件 label/marker、benchmark result schema，或恢复性能阈值断言。
  - 强制：TPOT 只接受 finite positive value；`openai-chat-omni` 的 client receive interval 只要有一个 finite positive sample 就保持 client timing，不得由 server 覆盖。只有选择 TPOT/ITL percentile 时才请求 stage metrics，且 client 没有正 interval、最终 `output_tokens > 1` 时才读取 latest cumulative Stage 0。
    - Stage-0 `num_tokens_out` 必须是正数且与最终累计 usage completion-token count 精确相等：长度恰为 `output_tokens - 1` 的 finite/nonnegative ITL 且总和为正时使用 exact ITL；否则只接受 positive finite Stage-0 TPOT，并按 decode interval 投影 `text_latency`。两者都无效则 unavailable；不得混合来源、使用其他 stage、混合 cumulative snapshots、制造 zero 或接受 NaN。
    - native-duplex 的最后回退仅在 `text_latency > ttft > 0` 时用 latency fallback。native duplex 累加 segment counts，chat cumulative snapshots 替换；configured mean TPOT baseline 需 positive sample count 和 finite aggregate。JSON 仍非 strict，NaN gap 未闭合。^[PR #6696] ^[PR #6818]
  - 验收：覆盖 `openai-chat-omni` 只在 TPOT/ITL 被选择时 opt in stage metrics；首个 SSE bundle 全部 token 时用 count-matched Stage-0 exact ITL 恢复；client 有正 interval 时即使 Stage 0 不同也保持 client；另需覆盖 count mismatch、缺失/非法 Stage 0、zero-only ITL 与 TPOT-only weighted fallback，且无有效样本不能让 baseline 通过。
    - PR #6818 新增测试只直接覆盖前三项中的 opt-in、bundle recovery 与 client precedence，不证明其余负向分支或跨平台性能。^[PR #6818]
  - 强制：baseline 只接受 `{hardware: {metric: threshold}}` 的硬件嵌套结构；顶层 hardware 必须是 `pyproject.toml` 中带 `[hardware-resource]` 标签的 pytest marker，每个 bucket 非空。metric 名可自定义，值只能是单点 scalar 或与 `request_rate` / `max_concurrency` 顺序严格对齐的 list。
    - runner 在每个 sweep step 写 result 前按 `sweep_index` 将所有 hardware bucket 的 list 收窄为当前 scalar，scalar 原样保留；结果仍保留所有 bucket，留给下游 consumer 选择实际硬件。
  - 验收：当前 CI 仍只用 `completed == num_prompt(s)` gate 请求完成数；baseline artifact 是描述性元数据而非阈值断言。单测须覆盖 omni/diffusion sweep 的逐步收窄、所有 hardware bucket 保留、自定义 metric/scalar，以及 flat、未知 label、dict value、缺 index、越界失败。若重新引入性能 gate，必须有显式 consumer、hardware bucket 选择、metric directionality 与失败测试。
    - 当前实现没有 upfront list-length 校验：短 list 到被访问的 index 才失败，多余值静默不用；若 QPS 与 concurrency 同时配置，同一 list 会按两个独立 loop 的位置复用。因此配置 review 必须人工核对 mode、list 长度和顺序。`[hardware-resource]` 也只代表 baseline key 可解析，不代表 `hardware_marks()` 能调度该资源：当前 H200/B200 尚未进入 CUDA resource 分支。
    - 另有四个 Hunyuan 配置只保留 H200 baseline，却仍标记 H100/A3 执行，当前因无阈值断言而被掩盖。runtime alias 匹配还应保持最长 token 优先；目标 pin 中 `B200` 早于 `GB200`，会把 GB200 名称归一化成 B200，修复前不可把 filename label 当精确设备证据。MiniCPM-o 4.5 的 nightly perf 是这个边界的具体实例：最终 simplex/duplex 配置都是单卡 H100，runner 命令没有阈值开关；
    - simplex 只 gate 完成请求数，duplex 另要求每 session 恰好四个音频 response。配置里的 H100 baseline 因此只是结果 artifact，既不能证明回归阈值，也不能外推到 A3；PR 文本中的“双卡”描述也不能覆盖最终 lane/YAML 的单卡事实。^[PR #5524]
    - ready perf 复用同一合同：Seed-TTS English、`openai-chat-omni`、text+audio、关闭 thinking 并启用 TTS template，sweep 是 `(concurrency,num_prompts)=(1,10),(4,40)`。CUDA lane 分配 `h100_1`；NPU lane 分配 `a3_npu_2`，但 JSON hardware mark 声明每 case `num_cards: 1`，资源 allocation 不等于模型 stage 用卡数。
    - 两边都直接调用 runner、没有 `--assert-baseline`，所以仍只 gate `completed == num_prompts`；H100 metrics bucket 在 A3 run 中也只是 artifact，不能构成 A3 threshold。^[PR #6079]
  - ready 的 `source_file_dependencies` 只列 perf JSON、MiniCPM deploy/model/stage processor；shared `run_benchmark.py`/DFX conftest 由 nightly 覆盖，故不触发这个高成本 model job。
    - functional offline/online/duplex jobs 不可因 perf job 存在而删除：perf 只发 Seed-TTS text prompt，不覆盖 offline、non-stream text content assertion 或 image/video/audio multimodal ingestion。若要降成本，应收窄各自 workload，而不是声称 perf 是 functional superset。^[PR #6079] ^[PR #5402] ^[PR #5845]
  - Qwen3-Omni Async Chunk 的一个 perf JSON 可以承载多个 top-level case；`mark` 是按 case 附着的，CI 即使使用 `--test-config-file` 也必须用硬件和 scheduling marker 过滤。CUDA nightly 选择 `H100 and full_model and not slow`，weekly 选择 `H100 and slow`；A3/NPU 保持独立 `npu` 选择。
    - 不要把没有 A3 实测值的 H100 baseline 留在 A3-only case：该 case 在重新测量前只能 collect/run，不能伪装成 A3 阈值。减少 workload 后同样必须移除失效 baseline，待重新测量。清理单例 E2E 前要按输入/输出合同检查 suite-level owner：本轮 default text+audio perf 与 streaming audio-only 由 multi-replica suite 保留，Async Chunk text-only 仍保留；
    - 不支持的 chat output `audio.format`（如 `aac`）则迁至 weekly invalid-parameter HTTP case，断言 400 和 supported-format 提示。纯文本五并发的 reduced-token 配置独立覆盖 batching，不能因删除相邻 audio-only case 而丢失。^[PR #6570]
  - Qwen3-Omni audio-output DFX baselines must select `mean_audio_rtf`, not `mean_e2el_ms`, when the talker may free-run to its stop token: generated-audio length changes e2el without establishing a serving-speed regression.
    - At `bbb3ae01`, this applies to the three async-chunk `random-mm` audio cases and all four no-async-chunk audio cases (including the five-point `data=random` sweep); their surviving H100 `mean_audio_rtf` limits are respectively `[0.1098]`, `[0.1335]`, `[0.1798]`,
    - `[0.169, 0.2041, 0.2382, 0.3177, 0.4595]`, `[0.138]`, `[0.1609]`, and `[0.2048]`. Async-chunk cases with `modalities: ["text"]` retain `mean_e2el_ms`, because they do not produce talker audio.
    - Do not confuse baseline metric selection for downstream comparison with collection: `percentile-metrics` still includes `e2el` in every affected audio case, so e2el remains reported but is no longer selected by the baseline.
    - This PR changes only perf configuration (25 deletions), not runtime behavior; its local plan could validate JSON shape only because baseline comparison occurs downstream after artifact upload. ^[PR #6743]
- [OMNI-CI-3b] patched upstream benchmark 必须保持参数与 output subtype 兼容
  - 触发：upstream `benchmarks/serve.py` 增参，或 Omni 聚合字段只存在于扩展 output subtype。
  - 强制：patched copy 逐版本同步公开参数及控制流；background probe 从独立的最小请求生成，主 workload 完成后显式停止。Omni-only duplex metrics 用 tolerant attribute reads 聚合，plain-vLLM output 缺字段等价于空集合，不能抹掉已经成功的主结果。
  - 验收：签名/控制流与 pinned upstream 对照；probe rate 0 与正值覆盖启动/停止；plain 与 Omni output 混合列表都保留完成数，只有存在时才写 duplex metrics。^[PR #5976]
- [OMNI-CI-3c] XPU release image 从同版 upstream target 构建
  - 触发：升级 XPU vLLM/torch/Inductor 镜像，或为 compiler 故障改变 model/stage eager gate。
  - 强制：从精确 release tag 的 upstream `Dockerfile.xpu` 构建 `vllm-openai` target 后再叠 Omni；torch、oneCCL、triton-xpu 成套 pin。v0.27 使用 triton-xpu 3.7.2并保留 upstream oneCCL。
  - 强制：新 API 未支持时用平台 gate 保留 eager。PyTorch 2.13 XPU Dynamo 的 duplicate-handler workaround 只覆盖 Qwen2.5 Thinker/Talker 和 Qwen3 shared code predictor，不得扩展成全局 XPU eager。
  - 验收：核对 image provenance、XPU import/startup，以及这三条路径 compile 未被调用而其他模型保留原能力。^[PR #5957]
- [OMNI-CI-3d] ASR 文本比较先归一化已证实的等价词形
  - 触发：修改 ASR transcript 与期望文本的相似度评分，或修改其词汇归一化表。
  - 强制：在 n-gram 余弦评分前，仅对有复现证据的等价词形做大小写无关、词边界保护的归一化；回归测试同时断言预处理结果相等和最终相似度合同。
  - 验收：`"eight kilohertz"` 与 `"8 kHz"` 归一化后一致，且 `cosine_similarity_text(...)` 约等于 `1.0`；焦点 helper 回归测试在 CPU 上通过。^[PR #6947]
- [OMNI-CI-1f] scheduled CUDA mirror jobs 的 secret env 必须避开 Buildkite 同名覆盖
  - 触发：修改 CUDA mirror hardware preset、scheduled build env、Hugging Face token 注入，或 `upload_pipeline.py` 对 GPU preset 的 command expansion。
  - 强制：Kubernetes secret 不得直接以 `HF_TOKEN` 注入 CUDA pod env；必须使用 collision-proof alias，并在 job shell 开头恢复导出到 `HF_TOKEN`，这样 scheduled build 级 env merge 也不会把 secret-backed token 覆盖成空值或低权限值。该恢复只适用于实际消费 HF_TOKEN 的 CUDA mirror preset；NPU lane 保持原合同。
  - 强制：preset expansion tests 必须同时断言 pod env 中存在 alias、不再存在裸 `HF_TOKEN`，并验证 L4/H100/B200 全部 CUDA mirror preset 的 commands 都 prepend 同一恢复语句；非 CUDA preset 不得无故注入该 wrapper。
  - 验收：render 后的每个 CUDA mirror step 都保留 secret alias 和 runtime export，scheduled build 的同名 `HF_TOKEN` 不再导致 gated-model jobs 401；NPU steps 的 env 与 commands 保持不变。^[PR #7118]
- [OMNI-CI-4a] CI 修复以失败 job 和实际运行时闭环
  - 触发：Buildkite 失败但 build JSON 的 jobs/steps 为空，或本地通过而硬件 lane 失败。
  - 强制：从 build 的 `data/steps`、`data/jobs` 定位实际失败 job，检查分页与日志截断；使用 job 返回的 `base_path` 加 `/log` 读取日志，按首个根因归并 shard。记录失败 head、Torch/平台版本，与本地 import/version 预检对照，再运行对应路径。
  - 验收：修复绑定当前 head，明确本地实际执行数、skip 与平台边界；重触发后核对新 build 的 SHA 和状态。queued/running 只能报告已触发，不能报告 CI 通过。 ^[PR #7648]
- [OMNI-CI-1g] PR 与 post-merge L3 必须按 registry 做 diff 过滤
  - 触发：修改 `ci_source_file_dependencies.yml`、`upload_pipeline.py`、merge bootstrap 或 pipeline 的 `source_file_dependencies`。
  - 强制：key/list 由 registry 展开为路径前缀，按 PR/commit diff 保留命中步骤；无 key 的步骤保留，上传前剥离 uploader-only 字段。模型路径用共享 anchor，job key 另列自己的脚本/pytest 路径，不从 command 猜。PR-label 与 post-merge main L3 都过滤；仅显式 `--all`/`--e2e`（scheduled nightly/weekly）保留全量。
    - 无 job-key 命中时，被上传的 pipeline YAML 或 `source_filter_fallback` 命中可 keep-all；已有 job-key 命中时正常过滤优先。
  - 验收：覆盖 key 展开/未注册拒绝、无关 diff 丢弃、无 key 保留、fallback 优先级；main 的 `force_all=False/e2e_only=False` 返回 diff，显式全量返回 `None`，普通 merge bootstrap 不带 `--all`。^[PR #6597] ^[PR #7371]
- [OMNI-CI-1h] xdist online 测试不得用全局 GPU 占用做跨 worker 屏障
  - 触发：修改 `tests/model_tests/diffusion` 等 online/xdist suite、`cleanup_test_environment`，或在并行 worker 上等待“整卡显存回落阈值”。
  - 强制：`cleanup_test_environment` 观察的是整卡占用，不是当前 worker 自有分配。在 `is_xdist_worker` 下，online diffusion 等并行 suite 必须禁用/no-op 该全局 cleanup，避免 server teardown 变成跨 worker 屏障；`OmniServer` 仍拆除自己的子进程树。非 xdist 运行保留更广的 cleanup。
  - 验收：xdist worker 断言 cleanup 被 monkeypatch 为 no-op；非 worker 控制路径仍调用真实 cleanup；并行 online lane 不因全局 GPU wait 放大 wall time。^[PR #7534]

## 决策与踩坑

- [OMNI-CI-3a] 禁止：把 result 中存在 baseline 描述成 active regression gate；从执行 marker 推断同名阈值 bucket 存在；使用 flat metric map、以 concurrency 为键的 metric dict、未知/alias-only hardware label，或让 baseline list 与 sweep 顺序脱节。`_RUNTIME_DEVICE_ALIASES` 只服务 result filename 与运行时身份，不扩展 baseline allowlist；
  - runtime 也不自动选择 baseline bucket。
- [OMNI-CI-3b] 禁止：以“看似无关”删除 upstream 新参数；把 probe 混入 throughput/latency 主样本；直接读取扩展字段导致普通 backend 的结果整体 fallback 成 completed=0。
- [OMNI-CI-3c] 禁止：用旧 Omni base target 冒充新版 upstream、卸掉 oneCCL 只补 triton，或以 CUDA 通过外推 XPU。
- [OMNI-CI-3d] 禁止：降低相似度阈值来吞掉格式差异；把已证实的转写缩写差异宣称为模型音质回归；未经证据把其他模型的转换表或推测词形并入共享评分器。
- [OMNI-CI-1f] 禁止：依赖 Buildkite/Kubernetes 的 env merge 顺序碰巧正确；只修一个 GPU family；或把本地 shell/export 成功外推为 secret 已进入 pod env。
- [OMNI-CI-4a] 禁止：把空 metadata 当作没有失败；把新版运行时通过当作旧版 CI 已修复；把 skipped 当作执行通过，或用 CUDA 结果宣称 ROCm 已验证。临时绕过硬件探测只可用于已经证明运行时可用的隔离验证，不能取消生产测试门禁或隐藏 skip 原因。
- [OMNI-CI-1g] 禁止：仅因 `BUILDKITE_BRANCH=main` 就 keep-all；普通 main merge bootstrap 默认传 `--all`；把未注册 key 交给 Buildkite，或用旧模型族 label 代替有效 tier label。
- [OMNI-CI-1h] 禁止：在 xdist 下等待 sibling worker 的分配消失才结束 teardown；把全局阈值等待说成单测资源隔离；或删除非 xdist 路径上仍需要的环境清理。
