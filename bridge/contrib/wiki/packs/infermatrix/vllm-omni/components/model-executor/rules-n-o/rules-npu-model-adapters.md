---
name: rules-npu-model-adapters
description: "NPU model adapter 规则 VLLM-OMNI-PR9106-DRAMA3-NPU（PR #9106）：共享模型（fish_omni）的 NPU 适配分层——adapter 归 platforms/npu/models/ 与 platforms/npu/quant/、共享代码走 NPU-only 惰性分支、构造期 patch 经 current_omni_platform.prepare_stage_engine()、qk-rope eager patch 在模型 __init__ 进程级安装；MRv2 边界（XPU fail-fast、NPU 仅 AR worker 有 V2 runner）；910B block-FP8 专家经 AscendFp8Config 展开约 64.4 GiB、TP2 加 expert parallel 的 npu profile"
metadata:
  scope: 只收共享模型的 NPU 平台适配分层、patch seam 与 worker 级 MRv2 边界一条规则 VLLM-OMNI-PR9106-DRAMA3-NPU；Drama 3 的 CUDA hybrid INT4 量化配置归 rules-drama3-quant，NPU KV cache 布局归 rules-npu-kv-layout，NPU profiler metric 归 rules-npu-profiler
---
# NPU model adapter rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-npu-model-adapters.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #9106
- [VLLM-OMNI-PR9106-DRAMA3-NPU] 共享模型的 NPU 适配必须分层：惰性选择分支、patch seam 与 worker 级 MRv2 边界
  - 触发：为共享模型新增 NPU 等平台专用适配（attention 兼容、hybrid model state、quant method、worker/runner），修改 `model_runner: v2` 的平台级或 worker 级 fail-fast，或在 `StageEngineCoreProc` 构造流程与平台模型 `__init__` 中安装平台 patch。
  - 强制：平台专用 adapter 实现归属 `platforms/npu/models/` 与 `platforms/npu/quant/`；共享模型代码（本例 `fish_omni_model.py`、`model_state.py`、`quantization.py`）通过 NPU-only 的惰性选择分支引用这些 adapter，CUDA 路径保持 upstream 实现；通用 eager kernel 与 request-history snapshot 留在共享实现，tower norm 与 frame sampling 在非 CUDA 设备走 eager 路径。
    - 平台 patch 按作用域各走各的 seam：必须先于 upstream scheduler/cache manager 构造生效的 patch（本例 Ascend Mamba allocator signature 兼容）经 `current_omni_platform.prepare_stage_engine()` 由 `StageEngineCoreProc` 在 engine 构造前安装，默认 hook 为 no-op，且不波及其它平台；
    - 模型内 attention 兼容（qk-rope eager）则由 NPU platform model adapter 的 `FishOmniForConditionalGeneration.__init__` 调用 `_install_npu_eager_qk_rope()` 安装，该 patch 进程级改写 `Qwen3NextAttention.__init__`，评审时必须如实标注安装 seam 与进程级作用域。MRv2 边界必须分层表述：deploy override 的 fail-fast 收窄到 XPU；
    - NPU 上只有 AR worker 由 `npu_omni_v2_model_runner` 提供原生 V2 runner（`torch.cuda` 别名到 `torch.npu`），而 NPU generation worker 仍显式拒绝 V2，不得把“NPU 放行 V2”外推到 generation stage。910B 的 block-FP8 路由专家经 `AscendFp8Config` 在 CPU 展开 bf16（设备 in-place copy 报 `aclnnInplaceCopy` 561103，dense 副本分配前先释放 FP8 源）；
    - 256 个专家全量展开约 64.4 GiB，单卡放不下，`fish_omni.yaml` 的 `npu` profile 以 TP2+expert parallel 分两卡（stage 0 `enforce_eager: false`，PIECEWISE ACL graph），DAC stage 留 V1/eager 共享第二卡；TP 采样噪声从 rank 0 广播保证两 rank 同帧。
  - 验收：`tests/config/test_omni_config.py` 覆盖 XPU fail-fast、NPU 全局与 per-stage `model_runner: v2` 放行，并逐字段断言 fish_omni `npu` profile（stage0 v2、TP2、EP、`enforce_eager: false`、0.72、devices `0,1`；stage1 v1、0.10、devices `1`）；
    - NPU worker runner selection 测试断言 AR worker 选用 V2 runner 而 generation worker 仍拒绝 V2；`tests/engine/test_stage_engine_core_proc.py` 断言 platform compat 在 engine 构造前执行；eager kernel、V2 MoE comm context 与 mamba compat 测试通过；共享代码中每条 NPU 选择分支逐一核对只影响 NPU 路径；每个平台 patch 写明安装 seam 与作用域（是否进程级）；
    - recipe 如实标注验证边界（未评 WER/RTF、非 finished serving configuration）。^[PR #9106]

## 决策与踩坑

- [VLLM-OMNI-PR9106-DRAMA3-NPU] 禁止：把通用 eager kernel、request-history snapshot 等共享实现搬进或复制到平台目录；在共享代码里添加没有 NPU-only 守卫、会改变 CUDA 或其它平台行为的分支；把模型 `__init__` 里的进程级 attention patch 描述成经 `prepare_stage_engine()` 安装，或把 allocator 一类构造期 patch 改用全局 import 副作用绕过 platform hook；
  - 以“NPU 已放行 V2”为由移除 NPU generation worker 的 V2 拒绝，或把 deploy 级 fail-fast 恢复到已有原生 V2 AR runner 的 NPU；把仅完成权重加载、语音请求未跑通（smoke 在 expert 后处理 OOM）的 profile 宣称为可服务配置或给出 WER/RTF 结论。
