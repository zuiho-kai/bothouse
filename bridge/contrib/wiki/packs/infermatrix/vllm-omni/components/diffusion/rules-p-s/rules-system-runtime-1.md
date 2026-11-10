---
name: rules-system-runtime-1
description: Diffusion paged cache 与系统运行时规则（1/2）DIFF-4a、4b、4c、4d、4e、4f、4x、4y、4g、4h：容量预算在 warmup/profile 后测量、native vLLM 组件的 adapter 契约、feature gate 的 enabled 路径矩阵、异常清理三条路径、paged backend 启动期平台校验、paged attention metadata 显式 layout、SymmMem Ulysses A2A workspace、CFG parallel state、Ring GQA 与 advanced UAA padding、FlashInfer mixed-dtype plan key
metadata:
  scope: 只收本页 sources 清单与 system-runtime 审查组的 DIFF-4a 至 DIFF-4h（含 4x、4y）；DIFF-4i 及之后的 metadata、AR-Diffusion、scheduler/worker paged KV 规则见 rules-system-runtime-2，上游兼容侧 DIFF-4k、4l 归 diffusion-rules-upstream-compat，FlashInfer 量化 scale（DIFF-13a 至 13c）归 rules-flashinfer-quantization
---
# Diffusion paged cache 与系统运行时规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-system-runtime.md` 的第 1/2 部分；第 2 部分 [[rules-system-runtime-2]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-system-runtime.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-03；updated: 2026-09-22
- 来源（sources）：PR #5255；PR #5344；PR #5543；PR #5838；PR #6094；PR #6102；PR #6385；PR #6340；PR #6714；PR #6814；PR #6563；PR #5716；PR #6786；vllm_omni/diffusion/attention/；vllm_omni/diffusion/attention/parallel/ulysses.py；vllm_omni/diffusion/attention/parallel/ring_kernels.py
  - vllm_omni/diffusion/diffusion_kv/；vllm_omni/diffusion/distributed/cfg_parallel.py；vllm_omni/diffusion/distributed/parallel_state.py；vllm_omni/diffusion/worker/diffusion_model_runner.py；vllm_omni/platforms/interface.py；vllm_omni/platforms/npu/platform.py
  - tests/diffusion/diffusion_kv/；tests/diffusion/distributed/test_cfg_parallel.py；tests/diffusion/attention/test_piecewise_attn.py；tests/diffusion/attention/test_ulysses_uaa.py；PR #5491；PR #5194；vllm_omni/diffusion/data.py；vllm_omni/diffusion/utils/hf_utils.py；PR #7041；PR #6463
  - PR #6844；PR #7548
- 置信度（confidence）：high
- `system-runtime` 审查组的 `DIFF-4a`–`DIFF-4i`。触发条件、覆盖范围和其余审查组见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion 共享规则） 的 Direct 代码快速入口；上游兼容侧的 `DIFF-4k`–`DIFF-4l` 留在 [[diffusion-rules-upstream-compat]]（upstream 兼容规则）。
- [DIFF-4a] 容量预算必须在影响峰值的初始化完成后测量
  - 触发：新增或修改 KV/cache block 数、GPU/CPU memory budget、auto-fit、warmup/profile、dummy run 或物理 cache 分配。
  - 强制：写出并核对 `model load → activation warmup/profile → available-memory measurement → logical config → physical allocation → first real request` 的真实顺序；预算必须包含真实 activation/graph/lazy-kernel 峰值及明确 headroom。若当前阶段故意只建逻辑控制面，必须使用显式固定预算或把最终容量决定推迟到数据面 profile 之后。
  - 验收：enabled 路径在真实初始化顺序下记录测量前后峰值，低显存/最大合法请求不会因漏算 activation 在首次或后续执行 OOM；显式预算分支和自动预算分支各有测试。 ^[PR #6094]
- [DIFF-4b] 复用 native 组件仍须审计 caller/adapter 契约
  - 触发：diffusion adapter 调用 vLLM 的 cache spec/config/manager、scheduler 或其他版本化 API。
  - 强制：按仓库 pin 的精确 vLLM 版本核对 property/method、签名、sentinel、block-size 单位、max-length/capacity 前提、返回失败语义和 free/rollback 责任；分别证明 adapter 输入、调用时序、输出解释和 native 内部算法。
  - 验收：真实 pin 的 contract test 覆盖正常值、边界/sentinel、容量不足、property 访问和清理；fake 不能把真实 property 改成同名 method 或跳过 native precondition。 ^[PR #6094]
- [DIFF-4c] Feature gate 只限制影响范围，enabled 路径必须独立闭环
  - 触发：新增或修改 `dense_legacy`/paged、eager/optimized 或其他默认关闭的 diffusion 路径。
  - 强制：分别审计 disabled/default 与 enabled；enabled 至少覆盖单请求、并发/多 rank、低资源、partial allocation、执行异常、取消、timeout、shutdown 和重复释放。异常必须到达终端请求或 engine 信号并唤醒 waiter，所有已分配资源由明确 owner 回收。
  - 验收：path/lifecycle matrix 每行有 production-path 测试或明确 `MISSING_EVIDENCE`；enabled 关键行缺失时审查只能是 partial，不能输出 clean/no findings。 ^[PR #6094]
- [DIFF-4d] 异常清理覆盖每种错误传递形态
  - 触发：worker/RPC 在异常后清 traceback、释放 device tensor/cache，或把异常转换成 reply、rank-status envelope、`DiffusionOutput`。
  - 强制：先保存对外所需的字符串化错误，再对 raise、普通错误回复和 collect-status 正常返回三条路径逐一执行同一清理；调用方把异常折叠成成功返回形态时仍必须释放原异常引用。
  - 验收：测试分别覆盖 `collect_rank_status=true` 与抛出/错误回复路径，断言错误文本仍可见、`exc.__traceback__ is None`、cache cleanup 被调用，后续健康 RPC 仍成功。 ^[PR #6385]
- [DIFF-4e] paged backend 在启动时按平台和逐层能力闭环
  - 触发：启用 paged scheduler、增加 diffusion attention backend 或平台 override。
  - 强制：启动阶段解析并验证每层实际 backend 与当前平台；走 Omni platform hook，保留 piecewise/SP 等能力。HunyuanImage3 paged requests 已有 GPU/NPU production caller；NPU SDPA 只可作 startup memory-profile 的 dense fallback，正式 paged request 必须走 native backend；不能因 dense FA4 缺失拒绝 Blackwell formal paged path。
  - 验收：unsupported platform/backend fail-fast；CUDA/NPU 对应 lane 和正式模型 E2E 证明 resolved backend；mixed-mask piecewise/SP 回归通过。 ^[PR #5543] ^[PR #6102]
  - SenseNova-U1 paged AR decode 是 model-local, single-sequence CUDA fallback/capture，不是本规则的 scheduler-owned paged backend；其 eligibility、growth、sleep 与 dynamic-PEFT veto 见 [[sensenova-u1-rules]]（SENSENOVA-1b；源锚点 #sensenova-1b-paged-ar-decode-是单序列模型本地-cuda-opt-in）。^[PR #6516]
- [DIFF-4f] paged attention metadata 不从 padding 猜逻辑布局
  - 触发：paged adapter 修改 GQA、prefix/current-token packing、LSE layout 或二维特例。
  - 强制：显式传递 Q/KV head 数、每请求 prefix/current span 和 layout；LSE producer 必须声明 `bhs` 或 `bsh` 后规范化，绝不按 shape（含 `sequence == heads`）推断；保持压缩 GQA 与 packed current-token 语义，单 token/单 head 二维输入仍使用同一合同。
  - 验收：32Q/8KV、异构 prefix、单 token/单 head、非对称等维 LSE 和 batch compaction 精确对照 dense/reference 输出。 ^[PR #5543] ^[PR #6102]
- [DIFF-4x] SymmMem Ulysses A2A 只能显式启用并保持 workspace 生命周期闭合
  - 触发：修改 `ulysses_a2a_permute`、strict Ulysses all-to-all、NCCL SymmetricMemory JIT extension、CUDA graph capture 或 diffusion worker shutdown。
  - 强制：默认关闭；只在 `ulysses_degree > 1`、strict Ulysses 的正向 `(scatter,gather)=(2,1)` 与反向 `(1,2)` layout 启用，并在 worker/model 初始化时 JIT build/capability failure 直接 fail-at-init。advanced-UAA 保持其 `_ulysses_all_to_all_any_*` path；AllGather 不选择 Ulysses；strict Ulysses+Ring 的 Ulysses leg 仍可使用该 path。
    - 每个 `(device, process-group)` 只有一个单 CUDA stream 的 grow-only byte workspace；首次分配及增长必须是 collective、在增长前同步，容量内以 typed byte-slice view 复用；graph capture 中禁止增长，须先 warm up 最大 shape；worker shutdown 同步并释放 workspace。
    - Fast Ulysses QKV staging 只有 input/output 同一 CUDA device、同一 dtype、input rank-3、shape 相同、output contiguous，且 inner row `stride(2)==1`、`stride(1)==size(2)`、outer stride 不小于一整 row（无 overlap）时，才可在 `CUDAGuard(input.device())` 与 current CUDA stream 上用 `cudaMemcpy2DAsync`。^[PR #6714] ^[PR #6814]
  - 验收：覆盖 CLI/deploy/default-stage 的显式 flag 透传与默认 false、eligible strict path 的 init build、UAA/AllGather/noneligible layout 不调用该 path、strict Ulysses+Ring 的 eligible Ulysses leg、peak workspace 复用/collective growth、capture growth fail、single-stream reject 与 shutdown release；
    - copy op 必须拒绝 device/dtype/rank/shape/output-contiguity/inner-row/overlap 不匹配。当前没有新增 upstream unit；仅 B300 上 row-strided BF16 bitwise copy、四-rank forward/reverse parity 和四-GPU H3 smoke 证据，不能外推为一般硬件或性能结论。^[PR #6340] ^[PR #6814]
- [DIFF-4y] CFG parallel state 未初始化时串行，初始化错误必须可见
  - 触发：修改 `cfg_parallel`、CFG process-group 初始化/查询、正负 guidance branch 的 rank 分派，或其 runner 调用链。
  - 强制：CFG parallel state 未初始化时，所有 rank 必须走 serial-1 路径；state 已初始化后，group 查询、world-size/rank 或 collective 的错误必须原样传播，不能将错误降级成 serial。已初始化 group 的 two-branch 与 N-branch 路径都必须按该 group 的 rank/world-size 分派，不能以默认 global parallel state 猜测 CFG 拓扑。
  - 验收：以 mock/distributed test 覆盖未初始化 → serial-1、已初始化 group 的错误传播、two-branch rank 分派与 N-branch rank 分派；测试只证明这些 CFG state/path 合同，不外推为多节点吞吐或模型质量。^[PR #6786]
- [DIFF-4g] Ring GQA 只在通信后扩展，Hybrid Ulysses 不把 padding 当真 head
  - 触发：修改 Ring SDPA、GQA/MQA head 数、LSE accumulation、Ulysses all-to-all 或 `advanced_uaa` head padding。
  - 强制：Ring 始终以原始 `H_kv` 通信 K/V；仅在本 rank 的 aten SDPA 调用前，当 `H_q != H_kv` 时要求 `H_q % H_kv == 0`，再用 `repeat_interleave(H_q/H_kv)` 将 K/V 扩成 Q head 数。该 local materialization 增加 kernel 输入计算/显存，但不增加 ring 通信量；不能提前到 send/recv 前。
    - 之所以不能直接用 `enable_gqa`，是该 path 需要 aten flash/efficient SDPA 返回 LSE 供 ring accumulation，而这些调用没有该参数。实现以 K head 数计算 factor 并同样 repeat V，却未显式检查 `H_v == H_k`；现有测试始终令两者相等，future caller/backend 必须保持或提前断言该 invariant，不能等 SDPA 在更深处 cryptic failure。
  - 强制：advanced UAA 独立验证 `K==V`、`Q%KV==0`，main/joint 都适用。Ulysses `U`、ratio `R` 下先令 `padded_KV=ceil(KV/U)*U`，再令 `padded_Q=padded_KV*R`，协调 pad Q/K/V 后 A2A；strict Ulysses 保持 exact divisibility。Hybrid Ring 在既有 PyTorch ring path 本地 expand compact padded KV，不能 blanket reject；
    - Q padding >=1.5x 时按 `(Q,KV,U,label)` warn once，说明 FLOP/temp VRAM。
  - 验收：CPU 覆盖 main/joint 的 valid coordinated padding 与 malformed shape；multi-GPU 以 no-SP baseline 对 SP2 `28/7`、`6/3`、SP4 `12/3` 及 Ulysses2×Ring2 的 MHA/GQA/joint。warning threshold 与 dedup 需单独保护。
    - PR #5716 的 4×H800 数据只是 attention microbenchmark：aligned case 接近 baseline，而 uneven/MQA padding overhead 可显著增加；不构成模型 E2E、质量或通用性能证明。既有 pure-Ring/L4 gate 证据仍只覆盖其原始范围。^[PR #5255] ^[PR #5716]
- [DIFF-4h] FlashInfer mixed-dtype plan 必须绑定完整 runtime shape 与 mask 内容
  - 触发：修改 `FLASHINFER_ATTN`、`BatchPrefillWithRaggedKVCacheWrapper`、QK16/V8、backend selection、ragged indptr/plan cache 或 custom mask fallback。
  - 强制：输入保持初始化时 CUDA device；Q/K 只允许 fp16/bf16 override，V 另允许 fp8_e4m3，wrapper 输出恢复原 query dtype。auto backend 按 compute capability 选 major>=10 `cute-dsl`、major>=9 `fa3`、否则 `fa2`；non-CuTe 才接受 custom mask，CuTe nontrivial mask、causal+explicit mask 或无法 pack 的 mask 必须回退原始输入的 Torch SDPA。
  - 强制：`flashinfer_backend` 即使未设 dtype 也必须经 `AttentionSpec.backend_kwargs()` 序列化到 impl；platform availability 必须 probe 实际 `prefill.BatchPrefillWithRaggedKVCacheWrapper` symbol，而非仅顶层 import。每层 non-CuTe 私有 128MiB workspace 的累计 OOM 风险仍未解决，不得声称已共享/懒分配。
  - 强制：plan key 至少绑定 batch、Q/KV length、Q/KV heads、QK/K/VO head dim、Q/K/V/output dtype、causal、scale 与是否有 mask；shape/dtype 改变重建 indptr/plan，unmasked 同 key 可复用。mask shape 相同也可能内容不同，所以每次 masked call 都必须重新 plan，不能只按 pointer/shape cache。
    - Q/K/V cast 留在 compile-visible path，wrapper plan/run 边界才 disable compiler。目标 key 虽记录 `head_dim_k`，plan 只接收 `head_dim_qk` 与 `head_dim_vo`，且未断言 Q/K head dim 相等；caller 必须保持 `D_q == D_k`，并补 mismatch fail-fast test，不能把 key 字段误当 backend 已消费。
  - 验收：mixed QK/V 仅 FlashInfer >=0.6.16rc1；按真实 plan dtype 检验可解析的旧版、缺失/非法版本都 fail-fast。覆盖 allowlist、auto、device、plan/mask replan、CuTe/causal、GQA/output dtype。PR #5344 的 pre-final B200/B300 smoke 不是 E2E latency、稳定 speedup 或通用质量证据。^[PR #5344]

## 决策与踩坑

- [DIFF-4a] 禁止：用 warmup 前的当前 free/process residency 推导可用 cache，再在之后执行会常驻或抬高峰值的 dummy/profile；也不能用 native auto-fit 或 allocator 成功证明预算来源正确。
- [DIFF-4b] 禁止：把“委托给 native vLLM”当作端到端正确性证明；native manager 不负责验证 Omni 在何时测量预算、是否漏算其他显存、是否正确传播失败，也不保证 adapter 模拟对象符合真实属性合同。
- [DIFF-4c] 禁止：用“默认路径有 gate”“dense 未回归”或单请求 smoke 推导新路径正确；也不能让 scheduler/busy-loop 异常逃逸后留下永远等待的 stream。
- [DIFF-4d] 禁止：只在最外层 `except` 清理，却让内部状态封装路径正常返回；清理后继续从异常对象读取 message/traceback；用单一路径 mock 证明所有 RPC mode 都不会保留 device tensor。
- [DIFF-4e] 禁止：未知平台继承 GPU 默认；分配 cache 后到首次 dispatch 才失败；静默占用 paged KV 却继续 dense；直接换用 upstream backend 丢失 Omni 能力。
- [DIFF-4f] 禁止：从 padding 长度推断逻辑跨度；在 `sequence == heads` 时猜 LSE 维度；fallback 静默换 backend 或把 KV heads 扩成 Q heads。
- [DIFF-4x] 禁止：把 flag 当作默认 transport、静默 fallback；按历史 shape/dtype 无界缓存 allocation；跨 stream 重用 staging buffer；capture 中隐式分配/扩容；把任意 strided tensor 当作 copy-engine eligible，或把 CPU/mock workspace 测试、PR benchmark 写成数学/输出 parity、普遍速度或跨硬件收益。
- [DIFF-4y] 禁止：把“group 不存在”和已初始化 group 的查询/通信失败混为同一 fallback；只实现 two-branch 而让 N-branch 静默串行、重复或遗漏 branch；在调用方吞掉初始化后的错误。
- [DIFF-4g] Ring GQA 只在通信后扩展，Hybrid Ulysses 不把 padding 当真 head
  - 禁止：用默认 backend 的绿测证明 SDPA 修复（安装 FA/FA3 时会绕过）；用 num_heads=3、Ulysses=2 的 padded case 当 Hybrid 正向测试；从通信量不变推断端到端性能不变。
  - 禁止：独立 rounding（如 28/7/U2 成 32/8 以外的 Q/KV ratio）、把 padding 当真实 head、放松 malformed shape，或外推 broad performance。CPU/main-joint、multi-GPU parity 与 4×H800 microbench 仅为有界证据。^[PR #5716]
- [DIFF-4h] 禁止：把本 PR 早期 Sage/TRTLLM kernels 当成 merged scope（review 后删除并转交 TRTLLM backend）；把 activation 直接 cast 成 FP8 描述成带 scale 的 checkpoint quantization；用 `supports_attention_mask=True` 推断 CuTe 支持任意 mask。
