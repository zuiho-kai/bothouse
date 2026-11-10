---
name: gr00t-overview
description: GR00T N1.7 入口：CamelCase pipeline key Gr00tN1d7、Gr00tN1d7Pipeline 单 diffusion stage 输出 actions，OpenPI websocket 路由 /v1/realtime/robot/openpi，embodiment_tag 等运行期变体轴，Gr00tN1d7.yaml 必须 async_chunk false、policy_server_config handshake 合同，transformers ≥4.57.1 下限
metadata:
  scope: 只收 GR00T N1.7 的命名、入口路径、serving 面、配置与 checkpoint 差异；自加载权重、动作头和观测到动作的流程归 gr00t-architecture
---
# GR00T N1.7

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 正式名称 NVIDIA GR00T-N1.7-3B,GR00T N1.7 是其简称,无其他别名有据（测试用 `nvidia/GR00T-N1.7-3B`,YAML 不 pin）;代码标识区分: model_type/pipeline key `Gr00tN1d7`,pipeline 类 `Gr00tN1d7Pipeline`, 家族目录 `gr00t`。
  - Qwen3-VL（`nvidia/Cosmos-Reason2-2B`）backbone + 流匹配动作头,以单 "diffusion" stage 服务,输出**机器人动作块而非媒体**（`final_output_type="actions"`, 本次 registry 调查中唯一）。
- **pipeline key 是 CamelCase `Gr00tN1d7`**（随 model_type,其他家族都是 snake_case——grep/key 清单注意）;入口路径:diffusion registry `vllm_omni/diffusion/registry.py`（`Gr00tN1d7Pipeline` →（`gr00t`, `pipeline_gr00t`））、`vllm_omni/config/pipeline_registry.py`（`OMNI_PIPELINES["Gr00tN1d7"]`）、
  - 拓扑 `vllm_omni/model_executor/models/gr00t/pipeline.py`（单 stage DIFFUSION, `model_arch="Gr00tN1d7Pipeline"`,`hf_architectures=("Gr00tN1d7",)`, `final_output=True`,以 `default_deploy_config_name="Gr00tN1d7.yaml"` 声明默认 deploy 配置,无 connectors）;
  - 加载兜底 `vllm_omni/diffusion/data.py`（model_type/architectures 含 `Gr00tN1d7` 即强制该 pipeline 类）;HF config `Gr00tN1d7Config` 经家族内 `register_model_config` 注册;无 pre/post-process、无 AR 入口、无 stage input processor。
- serving 面**不是 OpenAI chat**：websocket 路由 `/v1/realtime/robot/openpi` 声明在 `vllm_omni/entrypoints/openai/api_server.py`,serving 实现在 `vllm_omni/entrypoints/openpi/serving.py`（msgpack-numpy 传输）;观测经 `sampling_params.extra_args["robot_obs"]` 进入。树内另一 VLA 家族: [[internvla-a1-overview]]（internvla-a1）。
- 依赖共享模块：diffusion worker 管线（[[diffusion-overview]]（Diffusion 组件））、[[configuration-architecture]]（Config 组件）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 自加载权重、handshake 合同、多 embodiment 权重库 | [[gr00t-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- 单 key/单类/单 deploy;运行期变体轴：`embodiment_tag`（按机器人动作空间,对 checkpoint `modality_configs` 校验,posttrain/finetune-only tag 在基座模型上带提示拒绝）、`use_alternate_vl_dit`、`backbone_model_type`/`model_name`（backbone 选择,pin 上只有 Qwen3-VL 路有具体类）、`Gr00tPolicy` 的 `strict` 校验开关。
  - 另有确定性控制 `GR00T_NOISE_SEED`（种子化采样噪声,e2e 以 max_diff=0.0 对齐 Isaac-GR00T ZMQ 参考值）。
- `Gr00tN1d7.yaml`：**`async_chunk: false` 是必须的**——deploy 校验器拒绝单 stage pipeline 的默认 true（新增单 stage 家族的常见 rebase 坑,YAML 头注明示）;`policy_server_config` 是**客户端 handshake 合同**,启动时 horizon/action_keys/embodiment_tag 对 checkpoint 快速失败校验,
  - 但 `supported_embodiments` 列表原样下发**不校验**（陈旧列表可能向客户端宣传 checkpoint 并不支持的 embodiment）。
- transformers 下限陷阱：`qwen3_vl` 需要 ≥4.57.1（仓库下限 4.56.0,显式 ImportError 提示）。

### 什么时候查这里

- 审查 gr00t 的观测协议、embodiment 校验或 handshake 合同;transformers 升级/降级 PR 把本家族列入回归点。
- **pin 上无 examples**——行为参考只有 deploy 注释与 e2e 测试。语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/gr00t/_index.md`（InferMatrixCopilot@ecfb84d0）；title: GR00T N1.7（机器人 VLA,actions 输出,OpenPI websocket）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/gr00t/；vllm_omni/deploy/Gr00tN1d7.yaml；vllm_omni/entrypoints/openpi/serving.py
