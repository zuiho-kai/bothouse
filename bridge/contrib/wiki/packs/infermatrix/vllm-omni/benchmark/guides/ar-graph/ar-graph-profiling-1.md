---
name: ar-graph-profiling-1
description: AR graph serve / profiling 状态机第 1 部分：通用 profiling 规则（读经验、锁 artifact contract、trace quality summary 模板）、2026-06-05 HunyuanImage3 AR graph profiling 反例、AR-only 口径 gate（hunyuan_image3_ar + /v1/chat/completions + openai-chat-omni）、comprehension stage config parse gate、profiler_config gate 与 /start_profile 404 判定
metadata:
  scope: 只收开跑前的通用 profiling 规则和 AR serve 的口径、comprehension stage、profiler config 三个 gate；trace 质量验收、状态机与 artifact 顺序归 ar-graph-profiling-2，graph mode 采集窗口归 ar-graph-profiling-3，d-step 空洞归因归 ar-graph-gap-analysis
---
# Remote Debug · AR graph serve / profiling 状态机（1/3）

## 关键事实

- 拆分说明：本页是源页 `ar-graph-profiling.md` 的第 1/3 部分；第 2 部分 [[ar-graph-profiling-2]]；第 3 部分 [[ar-graph-profiling-3]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/ar-graph-profiling.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### 通用 profiling 规则：先读经验，再锁 artifact 契约

- 这条不只适用于 Hunyuan AR graph；用户说 `profiling`、`trace`、`算子`、`时序图`、`chrome trace`、`Perfetto`、`Nsight` 时，默认目标是 trace artifact，不是 benchmark stats。
- 开跑前必须先做三步：
  1. **读经验**：先读 [[benchmark-incidents-overview]]（profiling 错题），再读本文件的 profiling 状态机。遇到相似模型/路径时，再读对应模型的 `history/` 成功案例。禁止不读既有经验就从 CLI / 源码接口重新摸索。
  2. **锁 artifact contract**：写清本轮要交付哪类文件。Torch trace 至少要 `trace_rank*.json(.gz)`；Nsight 至少要 `.nsys-rep`。只有 `diffusion_result*.json`、stage duration、吞吐/延迟表时，必须标成 benchmark stats，不准叫 trace profiling。
  3. **按状态机推进**：`service ready -> start_profile 200 -> target request done -> stop_profile 200 -> trace exported -> local saved -> resources released`。任一状态缺证据，只能汇报当前状态和 blocker，不能说“跑完了”。
- 正式交付 profiling 前必须有 trace quality summary：

```text
trace files: trace_rank*.json(.gz) / *.nsys-rep
size: per file
event_count: per rank if JSON trace
coverage: rank / pid / tid
contains: python_function if needed, aten::, CUDA runtime/kernel, NCCL/memcpy when relevant
local artifact path: tar and extracted dir
resource cleanup: this-run PGID gone, GPU/process state checked
```

- 如果完整请求窗口采集导致 worker 死亡、`/stop_profile` empty reply、trace 没落盘，结论是“完整 trace 采集失败”，不是“换一个短请求/关掉字段后继续当正式结果”。降级为 bounded smoke、关闭 stack/shapes、缩短 output、加 `max_iterations` 前，必须明确这是 plumbing smoke，不能作为用户要的正式 profiling。

### AR graph serve / profiling 必须按状态机推进

#### AR-only 口径 gate

- AR-only graph + CLI benchmark 必须固定口径：

```text
deploy: hunyuan_image3_ar
endpoint: /v1/chat/completions
bench backend: openai-chat-omni
extra_body: {"modalities":["text"]}
not: /v1/images/generations
not: /v1/images/edits
not: offline examples/offline_inference/.../end2end.py profiler
```

- 启动前必须显式确认：

```bash
test -f "$CHAT_TEMPLATE"
grep -n "pipeline: hunyuan_image3_ar" "$DEPLOY"
grep -n "enforce_eager: false" "$DEPLOY"
```

- 不要假设 chat template “默认有”。vLLM 会把 path-like 字符串当路径校验；文件不存在会直接报：

```text
The supplied chat template string (...) appears path-like, but doesn't exist
```

#### comprehension stage gate

- AR deploy 里 `is_comprehension: true` 可能解析到 stage 的 `engine_args`，而 serving path 可能只读 `stage.is_comprehension`。如果 `/v1/chat/completions` 返回：

```text
No comprehension stage (is_comprehension=True) found in stage configs
```

- 不要继续调 payload / image / prompt，先做 config parse gate：

```bash
cd "$REPO"
"$PYTHON" - <<'PY'
import os
from vllm_omni.entrypoints.utils import load_and_resolve_stage_configs
_, stages = load_and_resolve_stage_configs(
    "tencent/HunyuanImage-3.0-Instruct",
    None,
    {},
    deploy_config_path=os.environ["DEPLOY"],
)
s = stages[0]
print("stage.is_comprehension", getattr(s, "is_comprehension", None))
print("engine_args.is_comprehension", getattr(getattr(s, "engine_args", None), "is_comprehension", None))
PY
```

- 结论必须写清：这是 deploy parser / serving consumer contract mismatch，不是 benchmark request schema。

#### profiler config gate

- 要拿 AR torch trace，必须在 AR stage 里加 `profiler_config` 后重新起 serve：

```yaml
profiler_config:
  profiler: torch
  torch_profiler_dir: /tmp/<run_dir>/torch_profiler
  torch_profiler_use_gzip: true
  torch_profiler_with_stack: true
  torch_profiler_with_memory: false
  torch_profiler_record_shapes: true
  torch_profiler_dump_cuda_time_total: true
```

- 如果目标只是验证 profiler plumbing，可临时把 `torch_profiler_with_stack` / `torch_profiler_record_shapes` 关掉；但这种轻量 trace 不算可交付分析材料。用户要求“能看进程、线程、Python 调用栈、CUDA/aten 细节”的 trace 时，默认必须开 stack + shapes，并接受导出更慢、文件更大。
- 服务 ready 前必须确认日志里出现：

```text
Omni torch profiling enabled. Traces will be saved to: ...
Profiler endpoints are enabled
Route: /start_profile
Route: /stop_profile
```

- 如果 bench `--profile` 后日志是：

```text
POST /start_profile HTTP/1.1" 404
POST /stop_profile HTTP/1.1" 404
```

- 这轮没有 profiler trace；不要去 `/tmp` 里盲找，直接判定服务没开 profiler endpoint，重启带 profiler config 的 AR serve。

## 决策与踩坑

### AR graph serve / profiling 必须按状态机推进

- **2026-06-05 HunyuanImage3 AR graph profiling 反例 / 修正**：用户要的是 “图模式 + CLI 路径” 的 AR 性能和 trace，不是 offline `end2end.py` profiler，也不是 DiT `/v1/images/*`。正确服务路径是 `vllm serve ... --deploy-config hunyuan_image3_ar.yaml`，客户端打 `/v1/chat/completions`，backend 用 `openai-chat-omni`。
- 本轮耗时来自三类问题叠加：
  1. HunyuanImage3 AR serve 本身启动重：157G checkpoint、KV profiling、torch compile cache load、CUDA graph capture。热缓存后 `torch.compile` 仍有几十秒，完整服务 ready 仍可能 15-25 分钟。
  2. profiler 不是 bench 加 `--profile` 就会产 trace；Omni worker 必须在 AR stage config 里提前配置 `profiler_config`，否则 `/start_profile` / `/stop_profile` 是 404。
  3. 状态汇报混淆：`trace 已落盘`、`stop_profile 返回`、`bench wrapper 退出`、`服务仍在占 GPU` 是四个不同状态，必须分开报。
