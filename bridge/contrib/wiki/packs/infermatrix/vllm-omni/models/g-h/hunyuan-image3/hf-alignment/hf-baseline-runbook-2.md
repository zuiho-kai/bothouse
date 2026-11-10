---
name: hf-baseline-runbook-2
description: HunyuanImage3 HF baseline runbook 后半：monkey-patch progress_bar 让 torch.profiler 只包 denoising loop（trace 从 23GB+ 降到 1.2GB），vllm-omni profiler 单请求必须 delay_iterations:0，device_map=auto 是 layer parallelism 而非 TP（4x L20X 显存分布），完整运行顺序 7 步
metadata:
  scope: 只收 HF baseline 的 profiler 控制、device_map 说明和完整运行顺序；环境要求、两个必修 bug 的 patch 和参数陷阱归 hf-baseline-runbook-1，官方 run_image_gen.py 的运行归 run-image-gen-demo
---
# HunyuanImage3 HF baseline runbook（2/2）

## 关键事实

- 拆分说明：本页是源页 `hf-baseline-runbook.md` 的第 2/2 部分；第 1 部分 [[hf-baseline-runbook-1]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/hf-baseline-runbook.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### torch.profiler 精确控制（关键！）

#### 问题

- 80B 模型即使只跑 13s，profiler 包整个 `generate_image()` → 250GB+ RSS，23GB+ trace。原因是 AR prefill（1234 tokens × 33 layers × MoE）产生百万级 kernel 调用。

#### 解法：monkey-patch progress_bar 只包 denoising loop

```python
_prof_holder = [None]  # None = profiler inactive
_orig_progress_bar = model.pipeline.progress_bar

def _patched_progress_bar(*args, **kwargs):
    pb = _orig_progress_bar(*args, **kwargs)
    class WrappedPB:
        def __init__(self, inner): self._inner = inner
        def __enter__(self):
            r = self._inner.__enter__()
            if _prof_holder[0] is not None:
                torch.cuda.synchronize()
                _prof_holder[0].__enter__()
            return r
        def __exit__(self, *a):
            if _prof_holder[0] is not None:
                torch.cuda.synchronize()
                _prof_holder[0].__exit__(*a)
            return self._inner.__exit__(*a)
        def update(self): self._inner.update()
    return WrappedPB(pb)

model.pipeline.progress_bar = _patched_progress_bar

# Warmup（profiler inactive）
model.generate_image(prompt=..., cot_text=cot_text, verbose=0)

# Profiling（profiler active）
prof = profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
               record_shapes=True, profile_memory=False)
_prof_holder[0] = prof
_, samples = model.generate_image(prompt=..., cot_text=cot_text, verbose=1)
prof.export_chrome_trace("trace.json")  # ~1.2GB (79MB gz)
```

#### 结果对比

| 方法 | trace 大小 | RSS |
|------|-----------|-----|
| 包整个 generate_image | 23GB+ | 250GB+ |
| 只包 denoising loop | 1.2GB (79MB gz) | 正常 |

### vllm-omni profiler 注意事项

- `delay_iterations:1` + 单请求 = 空 trace（profiler 跳过唯一请求）
- 单请求 profiling 必须 `delay_iterations:0`
- 50 步 trace ~79MB/rank gz，10 步 ~47MB/rank gz

### device_map 说明

- 脚本用 `device_map="auto"`（accelerate 自动分层），是 **layer parallelism**，不是 tensor parallelism：
  - 每层只在 1 张卡上跑，激活值逐层搬运，同一时刻只有 1 张卡在算
  - 4x L20X 实测显存分布：GPU0 61GB / GPU1 47GB / GPU2 47GB / GPU3 39GB（不均匀）
  - 对比 vllm-omni TP=4：每层切 4 份，4 卡同时算
- 这是 HF baseline 比 vllm-omni 慢的核心原因之一。对比 trace 时注意：HF trace 是单进程多卡（layer parallel），vllm-omni 是 4 rank（tensor parallel）。

### 完整运行顺序

1. 确认环境（transformers 版本、config.json 有 model_version）
2. **Patch 两个 bug**（snapshot + cache 文件）
3. 加载模型，设 `generation_config.diff_infer_steps`
4. 跑一次拿 cot_text（或从之前的日志提取）
5. Warmup（传 cot_text，3 步，无 profiler）
6. Profiling（monkey-patch progress_bar，传 cot_text，10 步）
7. 导出 trace + gzip
