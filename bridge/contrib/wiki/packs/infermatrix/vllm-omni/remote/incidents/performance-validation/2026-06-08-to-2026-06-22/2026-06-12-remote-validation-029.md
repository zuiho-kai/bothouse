---
name: 2026-06-12-remote-validation-029
description: 2026-06-12 错题：用户指出 trace 每个 d-step 有短 memory copy 后 GPU 空闲，d-step 性能分析拖成约 10 小时，最终由低开销 input-prep probe 与 .item() 栈采样定位 timestep_mask.sum().item()；含 10 小时做了什么、为何失控、压到 30-60 分钟的流程与状态汇报模板
metadata:
  scope: "只收 2026-06-12 d-step 空洞分析失控的过程、原因与改进流程；最终 PR #4363 的证据口径与模板归 2026-06-12-remote-validation-028"
---
# 2026-06-12 — 10 小时 AR graph d-step 性能分析为什么失控

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-12-remote-validation-029.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-12-remote-validation-029`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：10 小时 AR graph d-step 性能分析为什么失控
- 影响范围：repos/vllm-omni/remote
- **症状**：用户指出 trace 里每个 d-step 有短 memory copy，copy 后 GPU 空闲，要求“先观察是否复现，能不能优化”。实际执行拖成约 10 小时：反复下载/分析大 trace、反复远端跑 graph serve/bench、做多组 profiler/no-profiler/async/wait-all/probe 对照，最后才收敛到一个可合并的小优化 `timestep_mask.sum().item()`。
- **10 小时里实际做了什么**：
  1. 从用户截图出发，先按 Perfetto UI 视觉怀疑 `cudaMemcpyAsync -> HtoD` 中间空白。
  2. 拉取/处理大 trace，确认短 copy 本身只有微秒级，不能解释 `80-100ms` 空白。
  3. 区分 step 内 gap 和 step 间 gap，发现有的空白在 worker 主线程，有的在 async output / shared memory / sampling / RPC。
  4. 跑单请求健康对照，发现 `num_prompts=1` 不复现；又跑 `num_prompts=10` no-profiler 对照，发现普通 workload 也不必然复现旧 trace。
  5. 加 parent/core/worker probe，尝试验证 async scheduling / wait-all / TP phase skew，但后续控制组显示不能把 async scheduling 写成根因。
  6. 加低开销 input-prep probe 和 `.item()` 栈采样，才抓到请求窗口里慢 `torch.Tensor.item` 全部命中 `hunyuan_image3.py` 的 `timestep_mask.sum().item()`。
  7. 做 patch 归因实验：`AR_DECODE_DIAG_PATCH_TIMESTEP_WHERE=1` 后 `Tensor.item >50ms` 从 `18` 到 `0`，说明这是一类真实同步点。
  8. 最后把该同步点固化成 PR，补 no-profiler benchmark 和 AR-only accuracy。
- **为什么拖这么久**：
  1. **先从截图猜根因，而不是先分桶**：一开始没有把问题拆成 startup delay、step-internal idle、inter-step idle、profiler overhead、input-prep sync。导致每个新现象都像 root cause。
  2. **太早使用重型 trace**：直接围绕 900MB-1GB torch trace 分析，解析慢、下载慢、验证慢。正确做法应先用低开销 JSONL probe 判断问题在哪个 phase。
  3. **workload 没第一时间对齐**：单请求不复现、多请求可能复现；profiler 开关会放大耗时；用户/他人的 warm trace 也有现象。没有先锁 `num_prompts`、`extra_body`、输入/输出长度、bucket、profile 窗口，就会得出互相冲突的阴性/阳性结果。
  4. **启动成本和请求内空洞混在一起**：cold cache、JIT、`VLLM_CACHE_ROOT`、ninja/PATH、CUDA graph capture 会解释启动慢，但不能解释 warm request 内每步空洞。混起来导致多次跑偏。
  5. **probe 本身也有坑**：`sitecustomize.py` 只能加载一个入口，多个 probe/patch 分开会互相覆盖；只写 `perf_counter_ns` 无法和 profiler wall-clock 对齐；包装 staticmethod 可能改坏调用签名。这些都制造了额外返工。
  6. **没有足够早设置停损条件**：10 分钟没有进入目标证据层时，应该停下汇报 blocker 或换轻量方法，而不是继续等服务、等 trace、等下载。
  7. **把“能解释一部分”误当“解释全部”**：`timestep_mask.sum().item()` 确实解释了一类同步点，但不能解释所有 tail gap。这个边界后面才写清，导致前期结论摇摆。
- **以后怎么把 10 小时压到 30-60 分钟**：
  1. 前 5 分钟写 scope lock：目标现象、workload、artifact、成功标准。
  2. 前 15 分钟只看现成 artifact 和轻量统计：event_count、rank/tid、GPU busy/idle、main-thread stack、rank overlap。
  3. 前 30 分钟只跑低开销 probe，不导 full trace：

     ```text
     AR_DECODE_DIAG_MIN_MS=0.5
     AR_DECODE_DIAG_WRAP_TENSOR_ITEM=1
     AR_DECODE_DIAG_ITEM_STACK_MS=50
     STOP_PROFILE_ENABLED=0
     PROFILE_NUM_PROMPTS=<match user trace>
     ```

  4. 只有 probe 指向具体 phase 后，才开 full torch profiler；采集窗口必须是 `start_profile -> target request -> stop_profile`。
  5. 每个假设必须有反向控制组：
     - copy 慢：看 copy duration 和全局 GPU idle。
     - profiler overhead：no-profiler 同 workload 对照。
     - async scheduling：async-on/no-waitall、wait-all、async-off 三组。
     - `.item()` sync：stack proof + patch-on/off。
  6. 每轮只回答一个问题：复现了吗、在哪个 phase、能否优化、优化收益多少。不能把这四个问题混成一个长跑。
- **解决办法沉淀**：
  1. 对 d-step 空洞，先按“GPU idle + worker main-thread stack + parent/core phase + cross-rank overlap”四件套归因。
  2. 对大 trace，用 streaming parser 或低开销 probe；不要 `json.load` 巨型 trace 做第一步。
  3. 对 Hunyuan AR input-prep，慢 `.item()` 栈采样是高收益 probe；`timestep_mask.sum().item()` 这类 CPU 读 GPU scalar 要优先查。
  4. 对 PR 级性能优化，最终必须回到 no-profiler benchmark，profiler 只负责解释热点。
  5. 对“能不能优化”的回答必须分边界：
     - 已优化：`timestep_mask.sum().item()` scalar sync。
     - 未优化：剩余 graph launch/input-prep/async output tail。
     - 不应优化：短 DtoD copy 本身，除非有总耗时证据。
- **下次状态汇报模板**：

```text
现在进度：
- workload 是否对齐：
- 是否复现：
- gap 类型：startup / step-internal / inter-step / profiler-export
- 当前证据：GPU idle / worker stack / parent phase / rank overlap
- 已排除：
- 下一步只做：
- 停损时间：
```

- 不要再回复“还在跑”。如果没有上面这些字段，就说明当前动作不是有效进展。
