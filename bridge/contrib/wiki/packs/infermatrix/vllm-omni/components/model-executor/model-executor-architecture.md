---
name: model-executor-architecture
description: "Model Executor 共享架构：model_executor/ 与 worker/ 的职责划分、stage_configs / stage_input_processors / models 边界、当前源码职责锚点（build_stage_runtime_overrides、_preprocess 等，v0.26.0 @ a4ea67a2 复核）、MUSA 平台接口边界（MUSA_VISIBLE_DEVICES，PR #6058）、AR async Omni output materialization、payload 与 KV connector 所有权、Qwen3 code predictor 分离投影布局（main @ 78c144f3）和问题归属判断"
metadata:
  scope: 只收 Model Executor 的共享职责、阶段边界和源码锚点说明；规则入口与代码路由归 model-executor-rules-1，fused shard 验收门禁 EXEC-2b 归 rules-loader-contract，diffusion worker 的 IR-op priority 合同 DIFFPLAT-1a 归 rules-platform-runtime
---
# Model Executor 共享架构

## 现状

### 负责什么

- `vllm_omni/model_executor/` 负责组织 AR/LLM 等非 diffusion stage 和具体模型实现；`vllm_omni/worker/` 负责共享 runner 执行、逐请求调度状态、runner 到模型的预处理合同和 MTP 路由。两者共同构成这里的 Model Executor owner；不能因为类名是 `ModelRunner` 就忽略 `worker/` 路径。

### 主要边界

- `stage_configs/` 描述 stage 组合和运行参数。
- `stage_input_processors/` 负责跨 stage 数据转换。
- `models/` 下的实现负责具体模型执行，但模型专有结论仍归对应模型目录。
- `vllm_omni/worker/gpu_model_runner.py` 拥有共享 GPU runner 的 `_preprocess`、逐行 metadata 生产和 `talker_mtp` 路由；平台 worker 可以继承或覆盖这些边界。

### 当前源码职责锚点

- 调查前用 current main 验证这些符号仍存在；路径变化时沿调用方更新本页，不保留失效副本。（2026-08-05 在 `v0.26.0 @ a4ea67a2` 复核：下列 6 个锚点文件与 `build_stage_runtime_overrides`、`_preprocess` 符号全部存在。）
- 全局 CLI、deploy YAML 和 per-stage override 合并：`vllm_omni/config/stage_config.py` 的 `build_stage_runtime_overrides` 及其 config factory 调用方。
- stage devices、replica 布局和启动前容量：`vllm_omni/engine/stage_runtime.py`、`vllm_omni/engine/stage_init_utils.py`。
- 子进程设备可见性和 worker 启动：`vllm_omni/engine/stage_engine_startup.py`。
- AR/LLM worker rank 与设备选择：`vllm_omni/worker/gpu_ar_worker.py`。
- runner 到模型的预处理 metadata、prefill/decode 分类和 MTP 路由：`vllm_omni/worker/gpu_model_runner.py` 的 `_preprocess`。
- 共享 runner 回归测试：`tests/worker/test_omni_gpu_model_runner.py`；具体模型怎样消费 metadata：`tests/model_executor/models/`。
- 启动类错误优先沿“最终 stage 配置 → runtime devices → 启动前校验 → worker rank”读取这四段。只有其中一段把错误状态交给其他模块时才横向展开。

### MUSA 平台接口边界

- `MUSAOmniPlatform` 必须把共享 stage/runtime 接口落到 MUSA 自己的 runtime，而不是借用 CUDA 名称：设备能力来自 `torch.musa.get_device_capability()`；stage visibility 的 set/unset 成对操作 `MUSA_VISIBLE_DEVICES`。
  - 后者被 `entrypoints/stage_utils.py` 的逻辑→物理设备映射和 `stage_engine_startup.py` 的 scoped subprocess spawn 直接消费，因此既要支持设置，也要在异常路径恢复原值或删除变量。传入值在调用链中已归一化为 `str`；平台签名虽沿共享接口保留 `str | int | None`，不能据此声称任意 `None` 可直接写入 `os.environ`。
- 本次只做平台实现对齐，没有新增 MUSA runtime/unit 测试；PR 作者仅运行 compileall、pre-commit 与 diff check，并明确本地缺少 torch/vLLM/vllm_musa。设备 capability 查询、真实 spawn 隔离和 capability 驱动的 FlashAttention 选择因此仍需 MUSA 环境验证。
  - diffusion worker 的 IR-op priority 合同见 [[rules-platform-runtime]]（DIFFPLAT-1a；源锚点 #diffplat-1a-platform-ir-op-priority-必须区分-inductor-与-eager）。^[PR #6058]

### AR async Omni output materialization

- `GPUARModelRunner` 可把 `OmniModelRunnerOutput` 的 D2H、逐请求切片和 payload 构造从 decode critical path 移到 background builder；采样 token feedback 与下一步要读的 postprocess state 仍须同步完成。
  - 进入下一 decode step 前，scheduler/request mapping、token span 和可复用 CUDA output 都要形成 step-owned snapshot，CUDA tensor 要 clone 后在独立 stream 搬到 pinned host buffer，并用 event 标记 ready。
- snapshot 不包含 connector output：background builder 是该 output cycle 的唯一 drain consumer，读取 live connector signal；`get_output()` join builder，同时是完成与异常传播边界。启用条件是 AR async scheduling、`async_chunk`、model opt-in 且没有 prefix cache、speculative decode、routed-expert output 等冲突状态；条件不满足时回退同步构造。
  - CUDA/ROCm 是已验证范围，不是代码里的 platform guard；XPU/MUSA 可能通过共享 GPU runner 进入但尚未验证，Ascend NPU 使用独立 runner 并保持同步 materialization。

### Payload 与 KV connector 所有权

- `OmniConnectorModelRunnerMixin` 把 runner payload 传输与 `OmniKVTransferManager` 管理的 KV 传输视为独立数据面。receiver 总是创建 payload connector；sender 只在声明了非空 `custom_process_next_stage_input_func` 时才拥有 payload connector。因此 Bagel/Hunyuan 这类 KV-only sender 可只保留 KV manager，不另外创建无 consumer 的 payload transport。
  - 可执行验收见 [[distributed-rules-1]]（Distributed DIST-1c；源锚点 #dist-1c-payload-connector-按-edge-所有权创建且不与-kv-manager-捆绑）。

### Qwen3 code predictor 当前投影布局

- `main @ 78c144f3` 的共享 code predictor 保持分离 `q_proj`/`k_proj`/`v_proj` 和 `gate_proj`/`up_proj`，HF 同名参数由普通 loader 直接写入，TP plan 也指向这些分离名称。只有 310P 平台 overlay 在 `prepare_qkv_weights()` 内为本地执行临时拼接 QKV weight/bias；这不表示共享模型或 checkpoint loader 已改为 fused parameter。
  - 未来再引入共享 fusion 时的验收门禁见 [[rules-loader-contract]]（EXEC-2b；源锚点 #exec-2b-fused-shard-必须按-source-完整性与布局数值闭环）。

### 怎样判断问题归属

- 多个模型共用的 stage 生命周期、配置解析、runner 预处理合同或数据桥接问题归这里；某个模型怎样解读 metadata、token、attention 或 checkpoint 的问题归对应 `models/<模型>/`。
- 源码会变化，具体类名和路径在改代码前必须以目标仓库当前版本为准。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, components, model-executor；created: 2026-07-10；updated: 2026-09-04
- 来源（sources）：PR #5610；PR #5744；PR #6058；docs/design/feature/omni_async_output_materialization.md；vllm_omni/model_executor/models/common/qwen3_code_predictor.py；vllm_omni/model_executor/models/qwen3_tts/configuration_qwen3_tts.py；vllm_omni/platforms/interface.py
  - vllm_omni/platforms/musa/platform.py；vllm_omni/platforms/npu/_310p/patch/qwen3_tts.py；vllm_omni/worker/omni_connector_model_runner_mixin.py；vllm_omni/worker/gpu_model_runner.py；vllm_omni/worker/gpu_ar_model_runner.py；vllm_omni/platforms/npu/worker/npu_ar_model_runner.py
  - vllm_omni/config/stage_config.py；vllm_omni/config/omni_config.py；vllm_omni/engine/stage_runtime.py；vllm_omni/engine/stage_engine_startup.py；vllm_omni/entrypoints/stage_utils.py；tests/worker/test_omni_connector_mixin.py；tests/worker/test_omni_gpu_model_runner.py
  - tests/worker/test_gpu_ar_model_runner.py
