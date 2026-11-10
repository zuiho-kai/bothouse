---
name: execution-platforms-rules
description: AFD 平台与硬件 E2E 规则 gpu-mrv2-dbo-validation 与 e2e-dsv4-env-fail-not-skip，GPU MRV2 DBO 限制按版本和平台校验、DSV4 Flash 本地 E2E 按场景校验环境和设备
metadata:
  scope: 只收 afd-plugin 平台 owner 的版本化 MRV2 DBO 校验规则与 DSV4 Flash 本地 NPU E2E 环境规则；平台当前机制与支持矩阵归 execution-platforms-architecture，仓库级门禁归 afd-plugin-rules
---
# AFD 平台与硬件 E2E 规则

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/execution-platforms/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin, components, execution-platforms；created: 2026-10-09；updated: 2026-10-09
- 来源：
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:afd_plugin/validation.py
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:README.md
  - afd-plugin@6981ee104533c4793eead627cc2e118f2484bc78:tests/e2e/models/deepseek_v4_flash/test_sync_camp2p_npu.py
  - afd-plugin@6981ee104533c4793eead627cc2e118f2484bc78:tests/e2e/models/deepseek_v4_flash/test_async_cam_npu.py
  - afd-plugin@6981ee104533c4793eead627cc2e118f2484bc78:tests/e2e/environment.py
  - afd-plugin@6981ee104533c4793eead627cc2e118f2484bc78:tests/e2e/README.md
- [gpu-mrv2-dbo-validation] GPU MRV2 DBO 限制必须按版本和平台校验
  - 触发：修改包含 v0.30 GPU MRV2 DBO 实现的 checkout 的 `validate_gpu_model_runner_v2_config`、共享角色校验或启动说明。
  - 必须：先确认目标 checkout 和 runtime pin，区分升级实现与 v0.26 知识基线。
    - GPU MRV2 只允许同步 `P2pNcclAFDConnector`、`compute_gate_on_attention=false`，开启 DBO/ubatching 时必须恰好两个微批且 Attention DP > 1；
    - FFN 不构建 native ubatch runner，不把 Attention DP 条件错误施加到 FFN。
  - 必须：保留 PP/PCP/DCP 为 1、角色 rank 等于 DP×TP、静态 EP、已注册 AFD 模型和 CUDA eager/`FULL_DECODE_ONLY` 校验。README、启动说明与两个角色共用的校验器必须一致。
  - 验收：非两微批、Attention DP=1、错误 connector/gate/并行配置的负例失败；合法 FFN DP 不被 Attention-only 条件拒绝；文档保留版本、平台和硬件证据边界。
  - ^[PR #424]
- [e2e-dsv4-env-fail-not-skip] DSV4 Flash 本地 E2E 按场景校验环境和设备
  - 触发：新增或修改 `tests/e2e/models/deepseek_v4_flash/` 下同步 CAMP2P 或异步 CAM 本地 E2E 的环境装配。
  - 必须：显式提供 NPU backend、模型和设备列表；同步 2A2F 场景要求四个唯一设备、8A8F 场景要求十六个，异步 CAM 场景要求十六个。按当前场景的 `attention_ranks` 将列表前段交给 Attention、其余交给 FFN，不固定设备 ID 本身。
  - 必须：同步 A3 profile 要求 `HCCL_IF_IP` 和 `HCCL_SOCKET_IFNAME`，A5 profile 的 NIC 变量保持可选；其他 profile 按自己的入口声明校验。缺模型、缺必填变量、设备数量错误或重复 ID 必须失败。
  - 验收：四卡场景传十六卡列表及其反向都失败；重复设备、缺模型、A3 缺任一必填 NIC 变量失败；合法自定义设备 ID 按 role 正确分割。同步 smoke 用例只证明并发完成，不能据此宣称答案正确或扩大 PR 门禁范围。
  - ^[PR #359]

## 决策与踩坑

- [gpu-mrv2-dbo-validation] 禁止：仅因 GPU 限制改变就退休整条 [[afd-plugin-rules-init-2]]（AFD-I8）（源链接 `../../rules-init.md#afd-i8-readme-和设计文档对-modelrunnerv2-的说法相互矛盾改动-v2-时必须明确对齐`），或放宽 NPU MRV2 的 DBO/ubatching 禁令；
  - 升级分支合并不证明已晋升 upstream main，也不证明更宽硬件/模型矩阵。
- [e2e-dsv4-env-fail-not-skip] 禁止：通过 skip 或静默降级吞掉环境错误；把 README 某台主机记录的设备映射变成所有主机的硬编码值；把这两种同步 profile 的 NIC 要求推广到所有 NPU E2E。
