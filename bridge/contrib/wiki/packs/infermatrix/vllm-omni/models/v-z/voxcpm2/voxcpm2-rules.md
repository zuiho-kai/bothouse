---
name: voxcpm2-rules
description: "VoxCPM2 请求噪声规则：VOXCPM2-2a 请求 seed 驱动模型内 CFM 噪声流且与 batch 位置无关（PR #7866）、VOXCPM2-3a LocDiT inference_timesteps / cfg_value / cfg_cutoff_ratio 统一校验并保留至少一次 estimator 调用（PR #7010）"
metadata:
  scope: 只收 VOXCPM2-2a 与 3a 及开头的信号表；NPU estimator graph 的 VOXCPM2-NPU-1a 归 rules-npu-graphs
---
# VoxCPM2 请求噪声规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/voxcpm2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-09-22；updated: 2026-10-06
- 来源（sources）：PR #7866；PR #7010

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批 live 源码 |
|---|---|---|
| request seed、CFM noise、batched prefill/decode、graph replay | `request-noise`：`VOXCPM2-2a` | `worker/gpu_ar_model_runner.py` request seed → `model_executor/models/voxcpm2/` request generator 与各 noise fill 站点 |
| LocDiT timesteps、CFG 或 runtime overrides | `VOXCPM2-3a` | `model_executor/models/voxcpm2/runtime_config.py` coercion → talker 与 solver |

### [VOXCPM2-2a] 请求 seed 必须驱动模型内 CFM/噪声流，且与 batch 位置无关

- 触发：TTS/talker 在 `forward()` 内绘制 CFM、flow-matching 或同类噪声，且公开协议声称 `seed` 可复现；修改 `_omni_seed`、`SamplingParams.seed`、per-request `torch.Generator` 或 `deterministic_cfm_noise`。
- 强制：`SamplingParams.seed` 到达 vLLM sampler 不等于到达模型内噪声点。有 seed 的请求必须在首次 prefill 从 runner 的 `_omni_seed` 构造请求私有 `Generator`，并在每个噪声 fill 站点（eager、cuda-graph、batched prefill/decode、unified replay）对 shape `(1, …)` 的行切片使用该 generator。同 text+seed 的噪声流必须与 batch 组成、request id 无关；无 seed 保持全局 RNG；
  - `deterministic_cfm_noise` 的 request-id 哈希只服务 replay，且请求 seed 优先。
- 验收：跨 request 同 seed 字节一致、异 seed 敏感、batch 位次无关、seed 优先于 replay 哈希；覆盖所有噪声站点。^[PR #7866]

### [VOXCPM2-3a] LocDiT 设置必须统一校验并保留至少一次 estimator 调用

- 触发：修改 `voxcpm2_runtime_config`、LocDiT `inference_timesteps`/`cfg_value`/`cfg_cutoff_ratio`，或 eager、batched、graph solver 参数。
- 强制：三字段只从 `_VoxCPM2RuntimeConfig` 消费，默认 `10`、`2.0`、`1.0`；`inference_timesteps` 钳制到至少 `2`，`cfg_value` 必须有限，否则初始化失败，`cfg_cutoff_ratio` 夹至 `[0,1]`。所有 solver 路径使用同一已解析值。
- 验收：覆盖负/0/1/2/4/10 timesteps、非有限 CFG、cutoff 两端以及不同 batch size；断言 estimator 调用数、有限且非原始噪声的输出、输入 noise 未被修改，以及省略配置的默认保持。^[PR #7010]

## 决策与踩坑

- [VOXCPM2-2a] 禁止：仅依赖 `SamplingParams.seed` 或全局 `normal_()` 宣称 speech seed 合同；用 request-id 哈希冒充用户 seed；让 seeded 行的噪声依赖同 batch 其他请求。
- [VOXCPM2-3a] 禁止：让 CFG-Zero* 的一阶输入跳过全部 estimator 并返回原始噪声；让 NaN/inf CFG 流入 solver；在 talker 或 graph path 保留另一套硬编码默认。有限负 CFG 当前仍可解析，不能把未实现的非负门禁写成已有合同。
