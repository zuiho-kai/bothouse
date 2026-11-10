---
name: deployment-memory-budget
description: Deploy 配置与显存预算案例 CONF-1a、2a、3a、4a、4b、5a：Bagel 共卡 diffusion stage 缺 gpu_memory_utilization 的 OOM 诊断与 0.5 修法、VoxCPM2 在 L4 上 pin kv_cache_memory_bytes 6 GiB 取代比例棘轮、以展开后最终配置为准、composable strategy axis、headless 拓扑一致、冻结 topology 单份
metadata:
  scope: 只收 deploy 配置与显存预算的具体诊断材料和 skill 案例；CONF 规则的可执行门禁正文归 configuration-rules-1 至 configuration-rules-3、rules-parallel-topology 与 rules-topology-profiles-1，schema 与解析链归 configuration-architecture
---
# Deploy 配置与显存预算案例

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/deployment-memory-budget.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, config, ci；created: 2026-07-16；updated: 2026-07-29
- 来源（sources）：claude-workflow-starter-private@296ea45；SK-fix-missing-gpu-memory-utilization-diffusion-stage；SK-fix-voxcpm2-l4-oom-after-rebase
- 本页保留 deploy 配置与显存预算的具体诊断材料；可执行门禁已提炼到 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration rules） 的 `CONF-*` 规则。运营 runbook 仍以 rebase-agent 仓库为准。
- [CONF-1a] 多 stage 共卡时 diffusion stage 必须显式设 gpu_memory_utilization
  - skill 元数据：`fix-missing-gpu-memory-utilization-diffusion-stage`，modules=[input_output, model_config]，status=active，run_count=32，2026-06-16 创建 / 07-11 最后使用。
  - 触发：多 stage 模型（如 Bagel）stage 共卡时分布式测试在模型加载期 CUDA OOM，栈在 `MergedColumnParallelLinear.create_weights` 一类权重分配处（`torch.OutOfMemoryError`）。
  - 诊断：检查 CI 配置是否给**所有** stage 都设了 `gpu_memory_utilization`—— stage 1（diffusion）缺省时按默认 0.92 计；stage 0 用 45% + stage 1 用 92% 同卡合计 >100% 即 OOM。注意 diffusion stage 内部同时加载 diffusion 模型**和**一个 LLM（如 Qwen2MoT），仅权重就 ~27.5 GiB。
    - 核对点：`tests/.ci_generated/bagel.yaml` 与 `tests/helpers/stage_config.py` 的 `_CI_OVERLAYS["bagel"]`。
  - 修法：两处同时给 stage 1 加 `gpu_memory_utilization: 0.5`—— `_CI_OVERLAYS["bagel"]`（源模板）与 `tests/.ci_generated/bagel.yaml`（重新生成或直接改），skill 原文示例：

    ```python
    # In _CI_OVERLAYS["bagel"]:
    {
        "stage_id": 1,
        "max_num_seqs": 1,
        "gpu_memory_utilization": 0.5,  # ADD THIS
    },
    ```

    ```yaml
    # In generated YAML:
    - stage_id: 1
      max_num_seqs: 1
      gpu_memory_utilization: 0.5  # ADD THIS
    ```

  - 0.5 的依据：L20X 总显存 ~140 GiB；stage 0 的 45% ≈ 63 GiB；stage 1 权重 ~27.5 GiB；50% ≈ 70 GiB 在权重基线之上留足余量，且对任何 GPU 都给 stage 0 留出空间。
  - 验证：`python -m pytest tests/distributed/omni_connectors/test_bagel_shared_memory_connector.py -x -q --no-header`。^[SK-fix-missing-gpu-memory-utilization-diffusion-stage]
- [CONF-2a] 小显存机型对 KV 外分配模型 pin kv_cache_memory_bytes，不搞比例棘轮
  - skill 元数据：`fix-voxcpm2-l4-oom-after-rebase`（canonical），modules=[worker_runner]，status=active，run_count=30，2026-06-07 创建 / 07-11 最后使用。
  - 触发：`test_voxcpm2_*` 在 L4（24GB）exit -1（信号杀/Docker OOM，**无** Python 栈）；日志可见 `CUDA Graph captured for scaffold (batch_size=N)`、prefill 全部完成，随后 decode 期 30–60s 静默，最后 `Received cancellation signal, interrupting`。
  - 机制：VoxCPM2 的 diffusion 侧路径（CFM solver、batched VAE decode、LocDiT）在 decode 期在 vLLM KV-cache 记账**之外**分配显存。
  - 现行修复状态（动手前先读）：`vllm_omni/deploy/voxcpm2.yaml` 直接 pin KV cache：`kv_cache_memory_bytes: 6442450944`（6 GiB，按 max_num_seqs(2)×max_model_len(4096) 恰好配足（right-sized），其余显存留给 diffusion 侧路径；任何卡峰值 ~13 GiB）+ `max_num_seqs: 2`、`gpu_memory_utilization: 0.70`、`vae_decode_every: 1`、`enforce_eager: true`、
    - prefix caching 关。这**取代**了 2026-06-04..06-09 间每次 rebase 递减 `gpu_memory_utilization`（0.90→0.85→0.80→0.75→0.70→0.65 及回调）的棘轮——pin 了 `kv_cache_memory_bytes` 后该比例不再控制 KV 大小，再减没有意义。
  - 若 pin 后仍 OOM（按序）：1) 确认 YAML 里 `kv_cache_memory_bytes` 没被 rebase 冲突丢掉，丢了先恢复；
    - 2) 对比上次通过 run 的 `Model loading took N GiB` 与 free-VRAM 行（`rebase_logs/runs/<prev>/tests/00_tts_voxcpm2_test.log`），判断 vLLM bump 是否抬高了权重/激活基线；
    - 3) diffusion 侧路径确实变大时的杠杆（按序）：`max_num_seqs` 2→1、关 `enable_batched_vae_decode`、降 `kv_cache_memory_bytes`——每项都换吞吐，实测记录进 debug memory 而不是猜；
    - 4) 查历史 `search_debug_memory(keyword="voxcpm2_l4_oom")`。
- [CONF-3a] 争议以展开后的最终配置为准
  - 触发：CLI、deploy YAML、`base_config` overlay、platform 覆盖、per-stage override 或 `engine_extras` 各层说法不一致。
  - 强制：以 `resolve_deploy_yaml → load_deploy_config → merge_pipeline_deploy → build_stage_runtime_overrides` 展开后的**最终逐 stage 配置**为唯一事实，逐字段打印核对（工作法见 [[config-audit-plain-language]]（配置审计））；合并语义见 [[configuration-architecture]]（architecture）。
- [CONF-4a] composable strategy 只暴露已经接通的 axis
  - 触发：新增 composable parallel strategy、axis、routing/LB policy 或 stage override。
  - 强制：schema 明确区分 wired 与 reserved；translator 对 unsupported/reserved 值显式失败。routing 与 load-balancing policy 只能有一个 owner，不能同时由 strategy 和 CLI 冲突配置。
  - 验收：每个公开 axis 都有 spec → translator → final stage config 的正向测试和不支持值的 fail-fast 测试；stage 使用必填、可读的稳定名称。 ^[PR #4281]
- [CONF-4b] 标准与 headless 启动必须解析出同一拓扑
  - 触发：CLI、headless serve、offline entrypoint 或 engine factory 新增/转发配置字段。
  - 强制：同一命令语义在所有入口转发相同 override，并比较展开后的逐 stage 配置。
  - 验收：标准与 headless 路径对同一 stage override 生成等价 topology；缺字段时测试直接失败，不允许用 skip 隐藏路径漂移。 ^[PR #4281]
- [CONF-5a] 冻结 topology 只保留一份，部署开关决定 wiring
  - 触发：同一模型的 sync/async processor、普通/async chunk 或部署加速出现多份近似 pipeline/stage YAML。
  - 强制：相同冻结拓扑共用一份 pipeline config，同时声明可选 processor；由 deploy flag 决定 wiring。模型 package `__init__` 保持轻量，FP8 等部署加速留在 deploy 层。
  - 验收：两种 wiring 都从同一 topology 展开，配置 diff 只包含预期 deploy 字段；同卡多 stage 的 `gpu_memory_utilization` 总预算在最终配置中不超过可用容量。 ^[PR #5031]

### 相关

- schema 与解析链见 [[configuration-architecture]]（architecture）；启动期并行度×设备容量验收在 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor 规则）。

## 决策与踩坑

- [CONF-2a] 禁止：再"顺手减 0.05"`gpu_memory_utilization`——该棘轮跑了 5+ 轮没修根因，已被 KV pin 取代。^[SK-fix-voxcpm2-l4-oom-after-rebase]
- [CONF-3a] 禁止：拿某一层 YAML 原文当生效值；用默认值脑补缺失字段（`gpu_memory_utilization` 缺省=0.9、`async_chunk` 缺省=true 这类默认正是事故来源）。
- [CONF-4a] 禁止：接受但静默忽略 axis；关键 strategy/deploy 文件缺失时 conditional skip；以可漂移的 stage index 作为长期 identity。
- [CONF-4b] 禁止：只测 parser 输出，未证明值到达 engine/config consumer。
- [CONF-5a] 禁止：为一个 runtime flag 复制整套 topology；把无关 payload bug 或平台 cleanup 混入 config migration。
