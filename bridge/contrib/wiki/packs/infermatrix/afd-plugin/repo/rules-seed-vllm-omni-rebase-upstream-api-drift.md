---
name: rules-seed-vllm-omni-rebase-upstream-api-drift
description: 上游 API 漂移与兼容边界（afd-plugin）AFD-I13、I14、I16、I17、I18、I19、I23：版本 pin 与守卫、复制型 patch、别名重绑、best-effort 导入、CPU-safe、vLLM-Ascend 基线、显式 worker 路径
metadata:
  scope: 只收 afd-plugin 面对上游 vLLM / vLLM-Ascend API 漂移时的兼容边界规则（AFD-I13、I14、I16、I17、I18、I19、I23）；仓库级规则归 afd-plugin-rules，初始化与 E2E 门禁归 afd-plugin-rules-init
---
# 上游 API 漂移与兼容边界（afd-plugin）

## 关键事实

- 源页：`knowledge/repos/afd-plugin/rules-seed-vllm-omni-rebase-upstream-api-drift.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-09-30；sources: 无
- [AFD-I13] vLLM 目标版本写在多处，注册期只告警：改 pin 时所有守卫要一起改
  - 目标版本 `0.26.0` 同时写在三类位置：`pyproject.toml` 的 `vllm` extra（`vllm==0.26.0`）、`afd_plugin/compat/vllm.py` 的版本检查、README 与设计文档里的支持声明。PR 改了其中一处，其余位置必须跟着改。
    - 版本守卫有变化时，还要补 package 兼容测试 `tests/unit/package/test_package.py`。
  - 插件注册调用版本检查时用的是 `strict=False`，版本不匹配只打 warning，然后继续运行。因此“新版本上插件能注册”或“单测能通过”都不算支持证据。在签名不同的上游上跑通的单测，也不算兼容证据。
    - `config_validation.py` 和 `async_dp_forward_context.py` 放行三种情况：目标版本、dev 版本、缺失版本元数据。
    - `async_dp_engine.py` 的一般 async 绑定沿用 target/dev 守卫，但其中复制的 coordinator 只在版本恰好是 `0.26.0` 时生效。更新的 dev 版本会保留原生 coordinator。
  - 所以 bump pin 的 PR 必须显式更新这个 exact 守卫及其测试。否则 async-DP Attention 的行为会悄悄变掉，而且不会报错。

- [AFD-I14] 没有版本守卫的复制型 patch 只靠 pin 和评审兜底：基线一变就要从新上游重新拷贝函数体
  - 以下 patch 没有 patch-local 版本守卫：
    - `afd_plugin/compat/patches/engine_core.py` 直接给类属性赋值，也没有 saved-original 哨兵。
    - `afd_plugin/compat/patches/npu/force_load_balance.py` 复制了上游函数体，同样没有版本守卫或重载守卫。
    - `npu/ascend_platform.py` 和 `npu/mla_graph.py` 也没有版本守卫。
  - 任何改变 vLLM 或 vLLM-Ascend 基线的 PR，都要按这个顺序处理：
    - 在 PR 中写明上游文件、symbol、版本或 commit、签名。
  - 全局替换会影响每个加载了插件的进程，所以复制出来的非 AFD 分支也要有回归测试。
    - 例如：`tests/unit/compat/patches/test_engine_core.py` 里的非 FFN 路径，`test_force_load_balance.py` 里的 pass-through 路径。

- [AFD-I16] 靠重绑导入别名生效的 patch：上游新增的 import 点会绕过 AFD 分支
    - `async_dp_forward_context.py` 替换 `vllm.forward_context.set_forward_context`，并重绑已知的、已经导入的 worker 别名，防止调用方继续持有旧函数。
    - `async_dp_engine.py` 同时替换 `vllm.v1.engine.utils.launch_core_engines` 和它被导入后的 client 别名。
  - 如果升级后上游在新的模块里导入这些 symbol，新别名不会被重绑。结果是 AFD async-DP 静默退回原生 `DPMetadata` 协调，或退回原生引擎启动流程。
    - 在新基线里 grep 这些 symbol 的全部导入点。
    - 同步更新 `test_async_dp_forward_context.py` 和 `test_async_dp_engine.py`。
  - `async_dp_engine.py` 会在 spawn 子进程里通过插件自有的进程 target 重新应用 loop。新增的重绑点也要覆盖 spawn 导入路径。

- [AFD-I17] 核心 patch 是 best-effort 分组导入：运行时 fail-fast 检查是唯一兜底，不能删
  - `async_dp_engine`、`async_dp_forward_context`、`config_validation`、`engine_core` 在同一个 `try` 里导入。
  - 任一个失败只打 debug 日志，然后继续注册模型。中途失败会留下一个不完整的补丁集：前面的已经装上，后面的被跳过。
  - 部分应用能被发现，全靠运行时的 fail-fast 检查：
    - Attention/FFN 初始化时遇到下列情况会直接失败：AFD config 缺失、角色不匹配、worker class 是隐式的（即 `auto` 没有被解析掉）或错误的。
    - FFN 收到 scheduler 驱动的 `execute_model()` 调用时会 fail fast。如果 `engine_core` 没有生效，这就是最后一道防线。
  - 不得把这些检查当成“不可达代码”删掉，也不得降级成 warning。
  - 往这个 best-effort 块里新增 patch 时，必须同时提供一个显式检查，让受影响的运行时在执行前就能发现问题（PATCH-INV-004），而不是静默产出错误结果。

- [AFD-I18] CPU-safe 与 Ascend 延迟导入：注册期和公共模块不得引入设备栈
  - `vllm` 是可选 extra。CPU 或 macOS 环境必须能用默认的 `uv run pytest` 跑 import/config 测试。
  - 以下模块必须保持 CPU-safe：顶层包、公共配置和校验、版本检查、graph policy helper。其中 `validate_cuda_graph_mode()` 在模块导入时不能 import torch 或 vLLM。
  - `AFDConnectorFactory` 用的是 lazy loader，导入 factory 时不得带出 CUDA 或 Ascend 实现。
  - Ascend 原生算子要等 connector 初始化时才加载。算子缺失应该在 connector 初始化时报错，而不是在导入包时报错。
  - 纯 CUDA 的插件注册不得导入 vLLM-Ascend。Ascend patch 必须等 Ascend 插件完成平台初始化之后再应用，入口是 config facade、worker runtime facade，以及 FFN worker 构造时导入的 force-load-balance。
  - 把 Ascend patch 挪到 `register_afd` 或模块顶层的 PR 应该拒绝。
  - runtime facade 只有在 wrapper 真正装上之后才缓存“成功”，这样早期导入 vLLM-Ascend 失败时还能重试。修改 facade 时要保留这一点。

- [AFD-I19] vLLM-Ascend 基线只是一个源码 commit（`80d8c194f`），不是包依赖；v0.19.1rc1 的资产不能当 v0.26 的证据
  - `pyproject.toml` 没有声明 vLLM-Ascend 依赖。兼容证据只有两样：源码 commit `80d8c194f`，以及对应的 NPU 验证记录。这个 commit 同时记在 README、`compatibility_and_patches.md`、`execution_platforms.md` 三处。
  - 如果 NPU patch 或 runtime 针对的 vLLM-Ascend 源码快照变了，这三处要一起更新，并附上精确的 commit 和受影响路径的 NPU 单元/E2E 证据。
  - 仓库没有已发布的 v0.26 vLLM-Ascend 容器 tag。不得在 PR 或文档里把某个 tag 或容器写成权威 pin，也不得复用旧的 v0.19.1rc1 镜像作为 v0.26 的运行环境。
  - `CAMAsyncAFDConnector` 的 legacy PCP8 recipe 要求 `release/v0.19.1rc1`。而在 v0.26 上，基于 PCP 的 model-runner-v1 部署不受支持，CAM async 也不支持 prefill/decode 上下文并行。
    - 所以引用这个 recipe 得到的结果，不能作为 v0.26 CAM async 的支持证据。
  - NPU 单元测试要在 Ascend 开发环境里跑。默认的 CPU `uv run pytest` 通过，不构成 NPU 证据。

- [AFD-I23] 显式 worker 路径仍被接受：自动映射和 worker 侧的兜底修正都要保留
  - README 有两条承诺：
    - 省略 `--worker-cls` 时，自动选择对应角色的 worker。
    - 显式指定 AFD worker 路径仍然被接受，但不是稳定接口。
  - 自动选择由 `config_validation.py` patch 完成：它在上游平台归一化之后，把初始的 `worker_cls="auto"` 映射成对应的 worker。显式路径和非 AFD 配置不会被重映射。
  - 因此，用显式 worker 路径启动时，会绕过配置期上游对默认 worker 的重写。
  - 对这类旧式启动来说，唯一的兜底是 NPU worker 在设备初始化时做的 non-SP all-to-all backend 修正（选择 `flashinfer_all2allv`，相关逻辑见 `afd_plugin/compat/npu/runtime_config.py`）。不能以“自动选择已经覆盖了”为理由删掉它。
  - 反过来，不得在文档或 recipe 里把显式 worker 类路径写成稳定的启动接口。
  - 新增或修改 worker 类时，要同时更新四种 role/platform 映射及其测试。
