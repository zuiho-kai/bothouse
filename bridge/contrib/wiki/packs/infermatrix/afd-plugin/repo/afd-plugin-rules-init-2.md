---
name: afd-plugin-rules-init-2
description: AFD plugin 仓库规则（初始化规则 2/2）AFD-I8…AFD-I12：ModelRunnerV2 文档矛盾与约束、afd_metadata 位置、控制面 payload 同步、worker 自动与显式选择、E2E 门禁分层
metadata:
  scope: 只收 afd-plugin 初始化规则页的后半（AFD-I8、AFD-I9、AFD-I10、AFD-I11、AFD-I12）；AFD-I1、I2、I3、I4、I7 见 afd-plugin-rules-init-1
---
# AFD plugin 仓库规则（2/2）

## 现状

- 本页是源页的第 2 部分（AFD-I8、AFD-I9、AFD-I10、AFD-I11、AFD-I12），接 [[afd-plugin-rules-init-1]]（AFD-I1、AFD-I2、AFD-I3、AFD-I4、AFD-I7）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/rules-init.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-10-09；来源（sources）见 [[afd-plugin-rules-init-1]]

- [AFD-I8] README 和设计文档对 ModelRunnerV2 的说法相互矛盾，改动 V2 时必须明确对齐
    - 设计文档和 E2E 契约描述了受支持的 CUDA V2（`AFDAttentionModelRunnerV2`），CI 在 `l4_4` 上按节点 ID 运行 `afd-v2-*-dp2` 和 `afd-v2-*-tp2` 四个用例。
    - Ascend V2 只有单元测试证据。
  - 涉及 V2 的 PR 要说明以哪份文档为准，并同步修改另一份。
  - 不能依据 README 删除 V2 代码路径或 CI 用例，也不能宣称 Ascend V2 经过了硬件验证。
  - V2 的约束由 Attention 和 FFN 共用同一个校验器，只改一端属于缺陷。约束包括：
    - `compute_gate_on_attention=false`；
    - PP、PCP、DCP 均为 1；
    - 角色 rank 数等于 DP x TP；
    - 静态 EP；
    - v0.26 知识基线的 V2 不用 DBO 或 ubatching；包含 v0.30 GPU MRV2 实现的 checkout 按 [[execution-platforms-rules]]（平台规则）检查两微批与 Attention DP 限制，不能把升级分支的支持声明反推到 v0.26 或 NPU；
      - （源链接 `components/execution-platforms/rules.md#gpu-mrv2-dbo-validation-gpu-mrv2-dbo-限制必须按版本和平台校验`）
  - 图模式有平台差异：CUDA V2 只支持 eager 和 `FULL_DECODE_ONLY`，Ascend V2 还支持 `FULL`。不要把 Ascend 的 `FULL` 放宽到 CUDA。
    - 另外 README 的 connector 表把 CAMP2P 写成只支持 `FULL_DECODE_ONLY`，修改时要一并对齐。
  - ^[PR #424]

- [AFD-I9] AFD metadata 只能放在 `forward_context.additional_kwargs['afd_metadata']`
  - CUDA 和 Ascend、Attention 和 FFN、V1 和 V2，全部读写同一个键。不要重新引入 NPU 独立的 metadata 镜像，也不要新增其他 forward context 属性。
  - Ascend FFN 有两条路径：V1 用 `set_ascend_forward_context`；V2 配对用原生 `set_forward_context` 加 MRV2 profile override。修改 `compat/npu/forward_context.py` 时，两条路径都要测。
  - CUDA 空闲 DP rank 走的 dummy-batch 路径会绕过 `_model_forward()`，metadata 在这条路径上是惰性安装的。修改 metadata 的安装位置时，要检查这条路径。
  - `AFDForwardContextMetadata` 的结构和其中的 live connector 引用都不是稳定 API（#86、#88、#105 仍未解决）。不要在对外接口里承诺它们。

- [AFD-I10] 修改控制面 payload 的字段，发送端、接收端和编解码都要同步
  - `AFDControlPayload` 只能携带插件自有的原始数据：整数 stage key、token count 列表、max count，以及 graph、warmup、profile 布尔标志。它经 JSON 编码后，先发长度再发 `uint8` tensor。
    - 不能序列化 vLLM 的 `DPMetadata` 或其他 vLLM 内部对象（`XFER-INV-001`）。
  - 新增字段时（`is_profile` 就是一个例子），以下内容都要一起更新：
    - `P2pNcclAFDControlPlane`（NCCL）和 `CAMP2pAFDControlPlane`（Gloo）；
    - Attention 的所有发送点：非 ubatch、原生 ubatch、padded full-graph、V2 的 capture 和 replay hook；
    - FFN daemon 的 profile、warmup、capture、replay 分支；
    - 如果字段影响形状，还要改 `make_ffn_graph_key()` 或 ACL graph key。
  - 控制面必须先调用 `update_state_from_dp_metadata()` 更新本地 connector 状态，再发送。FFN 必须在进入 `torch.cuda.graph(...)` 或 `torch.npu.graph(...)` 之前完成状态更新，控制面的副作用不能被录进图里。

- [AFD-I11] worker 自动选择和显式指定 worker 路径必须同时可用
  - `worker_cls="auto"` 在上游平台规范化之后，由 `compat/patches/config_validation.py` 映射到 CUDA 或标准 Ascend 的角色 worker。显式指定的 worker 路径和非 AFD 配置不能被改写。
  - 显式 AFD worker 路径仍然接受（兼容旧命令），但不是稳定接口。
  - 不要删掉 NPU worker 里非 SP 场景的 all-to-all 修正。auto 路径在配置规范化时已经做了同样的改写，但显式指定 worker 的旧式启动还依赖 worker 里这份修正作为兜底。
  - `config_validation` 和其他核心 patch 在同一个 best-effort `try` 块里导入，失败时可能只在 debug 日志里出现，映射就静默丢了。因此 worker 初始化遇到隐式或错误的 worker class 时，必须明确报错，不能猜。
  - 没有 `--afd-config` 这个参数。配置只能从 `additional_config["afd"]` 进入（`afd_role` 等兼容别名除外）。

- [AFD-I12] E2E：分清 PR 门禁、每周门禁和只在本地跑的用例
  - PR 门禁用例最多使用 4 个设备，AFD 门禁用例必须是 2A2F。2A1F 用例（包括 README 本地冒烟示例里的 `afd-eager-2a1f`）不能加入 PR 门禁。
    - 向 `.buildkite/cuda/test-ready.yml` 或 `test-merge.yml` 新增 PR 门禁场景时，必须在另一份选择列表中加入相同 ID，并核对该 ID 在 `tests/e2e` 中存在。只约束新增门禁条目的对称性，不把本地或每周场景自动提升为 PR 门禁。
    - 一处说 2A1F 用例 “run outside CI”；
    - 另一处的每周门禁包含 DeepSeek `afd-graph-dbo-2a1f`，以及 Qwen3 MoE 和 Qwen3.6 的用例，其中 Qwen3.6 套件是 2A1F。
    - 修改 CI 选择时，要同步更新 `docs/design/module/e2e_testing.md` 和 `tests/e2e/README.md`，不要让这处矛盾继续扩大。
  - 按通用规则，harness 升级到 `SIGKILL` 就必须判用例失败。通过 `/proc/*/environ` 标记扫描再发 `SIGKILL` 的例外，只适用于 NPU async CAM 场景（`afd-eager-async-cam`、`afd-dsv4-flash-async-cam-dp2tp4-ep8`）。新场景不能沿用这个例外。
  - CI 不能设置 `AFD_GSM8K_LIMIT`，也不能调低 `AFD_GSM8K_THRESHOLD`。DBO 场景需要 12 路并发、至少 24 个样本，并断言至少记录到一次实际运行的双 ubatch 步骤。
  - 门禁用例不能用 `skip` 或 `xfail`。新行为需要单元测试加真实硬件证据；Ascend V2 目前只有单元测试证据，不能当作先例。
  - ^[PR #424]
