---
name: rules-topology-profiles-1
description: topology 与部署 profile 合同（1/2）CONF-5a 至 5g：冻结 topology 单一来源、trust_remote_code 三态优先级、forced-aligner 辅助 pooling stage 注入、无 model_type 的 NeMo 多 stage checkpoint 路由、MiniCPM-o CFM Graph 开关、π0 单 diffusion stage、MiniCPM-o NPU Code2Wav 按 Stage 2 传递
metadata:
  scope: 只收 CONF-5a 至 CONF-5g；CONF-5h 至 CONF-5m 归 rules-topology-profiles-2，并行拓扑 CONF-4a 至 4g 归 rules-parallel-topology，入口表归 configuration-rules-1，deploy YAML 展开顺序归 deploy-yaml
---
# topology 与部署 profile 合同（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-topology-profiles.md` 的第 1/2 部分；第 2 部分 [[rules-topology-profiles-2]]
- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-topology-profiles.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #4222；PR #4795；PR #5604；PR #5842；PR #5885；PR #6082；vllm_omni/config/stage_config.py；vllm_omni/config/config_factory.py；vllm_omni/engine/stage_init_utils.py；vllm_omni/engine/stage_runtime.py；tests/engine/test_async_omni_engine_stage_init.py；vllm_omni/deploy/；PR #6186；PR #6813
  - PR #6291；PR #6829；vllm_omni/config/pipeline_registry.py；tests/config/test_config_factory.py；tests/config/test_omni_config.py；tests/config/test_pipeline_registry.py；tests/utils/test_tracking_parser.py；PR #6230；vllm_omni/entrypoints/utils.py；tests/entrypoints/test_serve.py
  - tests/entrypoints/test_utils.py；PR #7272；PR #8184
- 置信度（confidence）：high
- `CONF-5a`–`CONF-5j`：冻结 topology 的单一来源、可选辅助 stage 注入、缺少 model_type 的多 stage checkpoint 路由，以及模型专用 deploy profile 的一致传递。触发条件与其余审查组见 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration 规则） 的 Direct 代码快速入口。
- [CONF-5a] 冻结 topology 只保留一份，部署开关决定 wiring
  - 触发：同一模型的 sync/async processor、普通/async chunk 或部署加速出现多份近似 pipeline/stage YAML。
  - 强制：相同冻结拓扑共用一份 pipeline config，同时声明可选 processor；由 deploy flag 决定 wiring。模型 package `__init__` 保持轻量，FP8 等部署加速留在 deploy 层。
  - 验收：两种 wiring 都从同一 topology 展开，配置 diff 只包含预期 deploy 字段；同卡多 stage 的 `gpu_memory_utilization` 总预算不超过可用容量。
- [CONF-5b] `trust_remote_code` 的未指定值必须保留 deploy 优先级
  - 触发：CLI、structured factory、legacy stage factory 或 deploy YAML 同时提供 `trust_remote_code`。
  - 强制：调用方显式 `True`/`False` 才覆盖 per-stage deploy 值；未指定用 `None` 表示并保留 YAML 值，HF config resolution 才把 `None` 收敛为安全的实际 bool。
  - 验收：覆盖“未指定、显式 True、显式 False”三态，并从 structured/legacy 两条路径断言最终 stage config；`with_trust_remote_code_override` 是唯一合并入口。
- [CONF-5c] 可选辅助 pooling stage 必须在最终 topology 中显式注入
  - 触发：为现有 pipeline 增加可选辅助 stage，或新增 `--forced-aligner`、`--forced-aligner-config`、`--forced-aligner-device` 这类只由 orchestrator 读取的开关。
  - 强制：在最终 merge 前把 CLI/YAML 解析为一个 canonical stage config；任一 aligner 来源生效时复制 pipeline/deploy，追加连接到前一 stage 的 `runner="pooling"` 终端 stage，并将 `default_pooling_params.task`、设备和 decoder hook 投影到该 stage；无来源时保持原 topology。
  - 验收：覆盖模型参数、config-only、无参数三态；断言原 pipeline/deploy 未改变，最终逐 stage config 含正确模型、`runner`、pooling task、设备和 decoder hook，并证明 stage 初始化按 `runner` 选择 `PoolingParams`。  ^[PR #4795]
- [CONF-5d] 无 `model_type` 的多 stage checkpoint 必须闭合别名与架构路由
  - 触发：接入缺少 `model_type` 或 `architectures` 的 NeMo 风格多 stage checkpoint，或新增其 pipeline alias、architecture 路由与默认 deploy 配置。
  - 强制：同时登记所有 stage architecture 到 `_ARCH_TO_MODEL_TYPE`，注册统一 `NemotronVoiceChatConfig`，让 alias、path-basename fallback 与 `default_deploy_config_name` 指向同一 pipeline；不得只依赖路径猜测。
  - 验收：用 bare `config.json` 和三个 architecture 分别验证 model type、pipeline、stage config 与默认 deploy 名称；sync/async 配置只切换 processor wiring，并保持三 stage 顺序与 stage architecture 一致。^[PR #5842]
- [CONF-5e] MiniCPM-o 部署 profile 必须一致传递 CFM Graph 开关
  - 触发：修改 MiniCPM-o 4.5 bundled deploy YAML 或 Code2Wav connector extra 中的 CFM CUDA Graph 开关、缓存上限或配置传递。
  - 强制：`minicpmo_4_5.yaml`、`minicpmo_4_5_2gpu.yaml`、`minicpmo_4_5_3gpu.yaml` 和 `minicpmo_4_5_8x4090.yaml` 必须一致声明 `enable_cfm_graph` 与 `cfm_max_graphs`；当前默认值为 `true` 与 `32`，并传入 `MiniCPMO45Code2Wav` 的 `_cfm_graph_config` 和 `BatchedToken2Wav`。非 CUDA 设备仍必须回退 eager。
  - 验收：解析四份 deploy 配置并断言开关和上限一致，追踪非默认值到 `_cfm_graph_config` 与 `BatchedToken2Wav`；覆盖开关关闭和非 CUDA fallback，并确认 stage topology 未发生额外变化。\n^[PR #6082]
- [CONF-5f] π0 的 checkpoint、registry 与 deploy 必须闭合为单 diffusion stage
  - 触发：新增或修改 π0 的 `pipeline_registry.py`、`vllm_omni/deploy/pi0.yaml`、`OmniDiffusionConfig` 的 `type: pi0` autodetect，或 `Pi0Pipeline` 的 stage declaration。
  - 强制：让 `pipeline: pi0`、`OMNI_PIPELINES["pi0"]`、`Pi0Pipeline` 与 checkpoint `type: pi0` resolver 闭合；deploy 配置只能声明一个 diffusion stage，最终输出类型为 `action`，并让 `policy_server_config` 的 `image_resolution`、`action_horizon`、`action_dim`、camera 数量与 `model_config` 保持一致。
  - 验收：无显式 deploy 配置的 checkpoint autodetect 能解析到 `Pi0Pipeline`；解析最终逐 stage config 断言只有一个 diffusion stage、`final_output_type=action`，并核对 `pi0.yaml` 与 websocket handshake metadata 的关键字段一致。^[PR #4222]
- [CONF-5g] MiniCPM-o NPU Code2Wav 开关必须按 Stage 2 传递
  - 触发：修改 MiniCPM-o 4.5 bundled deploy YAML，或新增/调整 `code2wav_enable_npu_graph`、`code2wav_max_npu_graphs` 这类 Ascend Code2Wav graph 配置。
  - 强制：`minicpmo_4_5.yaml`、`minicpmo_4_5_2gpu.yaml` 和 `minicpmo_4_5_3gpu.yaml` 必须在 `platforms.npu.stages` 中按 stage 声明配置；Stage 0/1 保持 `compilation_config.cudagraph_mode: PIECEWISE`，Stage 2 只通过 `additional_config` 传递 graph 开关和上限，默认值为 `true` 与 `32`，并保持最终 runner 的 outer eager 语义。
    - 所有断言必须基于 `_apply_platform_overrides` 与 `merge_pipeline_deploy` 展开的最终 stage config。
  - 验收：逐一解析三个 profile，断言 connector extra 不含两个 Code2Wav key，NPU 展开结果包含 Stage 0/1 的 `PIECEWISE`、Stage 2 的 `enforce_eager: true`、`code2wav_enable_npu_graph: true` 和 `code2wav_max_npu_graphs: 32`，并覆盖开关关闭和缓存上限为 0 的路径。^[PR #5604]
- 部署 YAML 的展开顺序见 [[deploy-yaml]]（deploy-yaml）；stage 执行合同见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor 规则）。

## 决策与踩坑

- [CONF-5a] 禁止：为一个 runtime flag 复制整套 topology；把无关 payload bug 或平台 cleanup 混入 config migration。
- [CONF-5b] 禁止：把 `store_true` 的 absent-False 当成显式 False 无条件写入 override；structured 与 legacy 各自实现 precedence；在末端用默认值静默覆盖用户明确的 False。
- [CONF-5c] 禁止：只检查 `forced_aligner` 而忽略 config-only 注入；原地修改调用方的 pipeline/deploy；把 orchestrator-only flags 泄漏为每个 stage 的 engine 参数；用 `execution_type` 猜测应构造 `PoolingParams` 还是生成参数。
- [CONF-5d] 禁止：只注册 thinker 或只提供一个 alias；让空的 `model_arch` 覆盖 checkpoint architecture；让 sync 与 async deploy 配置解析出不同的 stage 拓扑。
- [CONF-5e] 禁止：只更新一个 deploy profile、依赖未记录的默认值，或把配置存在误认为 graph 已在非 CUDA 环境生效；不得把模型专有开关扩展成所有模型的通用配置合同。
- [CONF-5f] 禁止：只凭 checkpoint 路径或文件存在推断 pipeline，额外添加 model-executor 层或多 stage topology，或让 OpenPI metadata 与最终 stage/model config 的动作尺寸不一致。
- [CONF-5g] 禁止：把 Code2Wav NPU 开关放入 shared connector extra、全局配置或其他 stage；只修改一个 profile；以 YAML 原文或字段存在推断配置已到达 Code2Wav consumer；用全局 eager override 破坏 Stage 0/1 的 `PIECEWISE` 配置。
