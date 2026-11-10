---
name: afd-plugin-rules-init-1
description: AFD plugin 仓库规则（初始化规则 1/2）AFD-I1、I2、I3、I4、I7：connector 注册与 schema、control_plane 判断、connector 构造时机、CPU-safe import、compute_gate_on_attention
metadata:
  scope: 只收 afd-plugin 初始化规则页的前半（AFD-I1、AFD-I2、AFD-I3、AFD-I4、AFD-I7）；AFD-I8…AFD-I12（ModelRunnerV2、metadata、控制面 payload、worker 选择、E2E 门禁）见 afd-plugin-rules-init-2
---
# AFD plugin 仓库规则（1/2）

## 现状

- 本页是源页的第 1 部分（AFD-I1、AFD-I2、AFD-I3、AFD-I4、AFD-I7），后续见 [[afd-plugin-rules-init-2]]（AFD-I8、AFD-I9、AFD-I10、AFD-I11、AFD-I12）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/rules-init.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-10-09
- 来源：
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:afd_plugin/validation.py
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:README.md
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:.buildkite/cuda/test-ready.yml
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:.buildkite/cuda/test-merge.yml

- [AFD-I1] 新增或重命名 connector 时，必须同时更新 factory 注册、配置白名单和 connector 自有 schema
  - 只在 `AFDConnectorFactory` 注册还不够。配置层另有一份硬编码白名单，它不是从注册表推导出来的。名字不在白名单里的 connector，会在配置校验阶段被拒绝。
  - 检查 PR 是否同时更新了以下内容：白名单、README 里 `connector` 可选值的说明、README 的 connector 支持表。
  - 新 connector 必须实现 `parse_extra_config()`，schema 是封闭的，未知字段直接报错。原因是 `compat/npu/feature_validation.py` 会通过 factory 复用同一个 schema 做前置校验，不能在别处另写一套校验。
  - 实现要放进对应的后端包：只用于 GPU 的放 `afd_plugin.connectors.gpu`，只用于 NPU 的放 `afd_plugin.connectors.npu`。
  - factory 的注册方法仍是 draft。不要在文档里把它写成公开扩展契约。

- [AFD-I2] 判断走控制面驱动还是 connector 驱动，只能看 `connector.control_plane` 是否为 `None`
  - 不能用 `isinstance` 或 connector 类名来选择执行路径（`CAP-INV-001`）。调用 `send_dp_metadata_list()`、`recv_dp_metadata_list()` 或 `update_state_from_dp_metadata()` 之前，必须先检查 `control_plane`。
  - GPU 只支持控制面驱动：`GPUFFNModelRunner` 构造时会断言 `control_plane` 不为 `None`；GPU daemon 遇到 `None` 会抛 `NotImplementedError`。所以任何新的 GPU connector 都必须在构造阶段装好 `AFDControlPlane`。
  - `control_plane is None` 的 connector（目前只有 `CAMAsyncAFDConnector`）不能进 FFN graph cache 路径，因为 cache key 依赖 DP metadata。这类 connector 必须保持 eager-only。
    - Attention 在这种情况下会跳过 DP metadata 协调，所以路由和 token 元数据必须随 dispatch payload 一起发送。
  - 控制面对象属于 connector，没有独立的生命周期。不要给它单独加 close 或所有权逻辑。

- [AFD-I3] connector 构造只做轻量工作，跨角色的集合通信必须等权重加载完成后再做
  - 构造函数和 `parse_extra_config()` 里不能创建进程组、communicator、算子注册，也不能加载 CANN 算子。这些都属于 `init_afd_connector()`。
  - Attention 端：`init_afd_connector()` 必须放在 `load_model()` 末尾，并且在 ubatch wrapper 安装之后。
  - FFN 端：`init_afd_connector()` 必须在 `initialize_from_config()` 里调用，位置在空 KV-cache 初始化之后、daemon 线程启动之前。
  - 如果把 rendezvous 提前到 `init_device()` 或构造阶段，两个角色的权重加载就不能再重叠。无论怎么改，rendezvous 都必须在 Attention 显存 profiling 和首次 forward 之前完成。
  - 对未初始化或只初始化了一部分的 connector，`close()` 必须安全，并且之后仍能再次关闭。connector 的改动要附带清理测试，以及重试或重新初始化测试。
  - 缺少原生算子时，要在 connector 初始化时报错，不能在包 import 时报错。

- [AFD-I4] 保持 CPU-safe import 边界：没有 CUDA、vLLM 或 torch_npu 时，默认测试也必须能跑
  - `vllm` 是可选 extra，默认的 `uv run pytest` 要能在没有 CUDA 的环境里运行。
  - 以下模块在 import 时不能引入 torch、vLLM 或 torch_npu：顶层包、通用配置和校验、版本检查、graph policy helper（`v1/worker/cuda_graph.py` 里的 `validate_cuda_graph_mode()`）。
  - `AFDConnectorFactory` 只保存懒加载器。新增 connector 时，不能在 factory 模块顶层 import CUDA 或 Ascend 的具体实现。
  - 只针对 CUDA 的插件注册路径不能 import vLLM-Ascend。Ascend 的 patch 必须等 Ascend 插件完成平台初始化之后再应用。
  - `afd_plugin._C_ascend` 只能在 connector 初始化时由 `ensure_cam_p2p_ops_available()` 懒加载。
  - CUDA 和 Ascend 的 runtime 模块可以直接 import 设备依赖。依赖 NPU 的测试属于 Ascend 环境的测试套件，不属于默认 CPU 测试。

- [AFD-I7] `compute_gate_on_attention` 允许什么值，要同时看 connector、runner 版本和模型
    - `P2pNcclAFDConnector`（CUDA V1）：`true` 和 `false` 都可以。
    - `CAMP2pAFDConnector`：通用字段和 `connector_extra_config` 里的同名字段都必须是 `false`。
    - `CAMAsyncAFDConnector`：文档里的配置要求通用字段为 `true`，开启 `async_moe_ubatching` 时也要求 `true`。
    - 任何 ModelRunnerV2 配对都要求 `false`。
    - Qwen3 MoE 和 Qwen3.5/Qwen3.6 MoE 都拒绝 `true`。
  - 修改其中一个维度的校验时，要核对另外两个维度，不能只在 connector parser 或只在模型层做校验。V2 的限制由 Attention 和 FFN 两个角色共用同一个校验器。
  - 通用字段 `compute_gate_on_attention` 是模型路由的选择开关；CAMP2P 的同名局部字段是算子契约。两者不能互相替代。
  - 同步更新 README 的模型表、connector 表和 Known gaps。
