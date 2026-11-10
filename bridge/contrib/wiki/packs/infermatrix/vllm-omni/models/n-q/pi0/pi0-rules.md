---
name: pi0-rules
description: "Pi0 规则 PI0-1a：π0 的 camera slot 顺序与缺失图像 -1 填充、state 补零截断、PaliGemma 前缀与 action-expert suffix 的 4D mask、手写 eager cross-attention、默认输出 actions [50, 32] 无状态语义、OpenPI/LeRobot parity max|Δ| < 1e-4（PR #4222）"
metadata:
  scope: 只收 PI0-1a 一条规则及开头的 PR 描述信号表；Pi0 的名称、注册与源码路径归 pi0-overview
---
# Pi0 模型硬门禁

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/pi0/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion, serving；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：PR #4222；vllm_omni/diffusion/models/pi0/config.py；vllm_omni/diffusion/models/pi0/modeling_pi0.py；vllm_omni/diffusion/models/pi0/pipeline_pi0.py；vllm_omni/diffusion/models/pi0/processor_pi0.py；vllm_omni/deploy/pi0.yaml；tests/diffusion/models/pi0/test_pi0_units.py
  - tests/diffusion/models/pi0/test_pi0_parity.py；tests/e2e/online_serving/test_pi0_expansion.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| observation preprocessing、flow matching、attention 或 action output | `PI0-1a` |

- 本页承载 Pi0 专有的 VLA 观测预处理、flow-matching kernel、attention 边界与动作输出验证合同；共享输出和配置 wiring 规则见相关页面。

### [PI0-1a] π0 的观测、attention 与动作输出必须保持 OpenPI/LeRobot 合同

- 触发：修改 π0 的 `Pi0Config`、`processor_pi0.py`、`modeling_pi0.py`、`pipeline_pi0.py`，或调整其 camera order、flow-matching、attention mask 与动作输出合同。
- 强制：按 checkpoint `input_features` 顺序构造最多 `max_cameras` 个 camera slot，缺失图像用 `-1` 填充并标记为无效，state 按 `max_state_dim` 补零或截断；保持 PaliGemma 前缀与 action-expert suffix 的 4D mask、float32 mask value 和手写 eager cross-attention 语义；
  - 默认 flow-matching 输出 `actions`，形状为 `[chunk_size, max_action_dim]`，π0 默认 `[50, 32]`，`session_id`/`reset` 保持无状态语义。
- 验收：CPU unit tests 覆盖 config、camera padding、mask、normalization 与 loader remap；固定 noise 的 CPU/float32 LeRobot parity 保持 `max|Δ| < 1e-4`，pipeline e2e 返回有限的 `[50, 32]` actions，OpenPI websocket handshake 与动作 chunk 通过独立验证。^[PR #4222]
- 相关页面：[[pi0-overview]]（Pi0 目录）；[[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（Diffusion 输出与 multiprocess runtime 规则）；[[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（配置开发门禁）。

## 决策与踩坑

- [PI0-1a] 禁止：按传入 dict 顺序重排 camera、丢弃缺失 camera slot、在未完成 4D mask 数值 parity 前替换为普通 attention backend，或把 π0 的连续动作误当成 text/image 输出；不得把 π0 合同外推为 π0.5 支持。
