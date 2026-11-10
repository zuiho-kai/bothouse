---
name: compatibility-rules
description: AFD compatibility 规则 AFD-3a、AFD-3b、AFD-I5、AFD-I6，覆盖 patch upstream-first 可移除、上游 API drift 直接暴露、vLLM 基线升级审计、临时符号替换 finally 还原
metadata:
  scope: 只收 afd_plugin/compat 的 patch 与上游适配审查规则（AFD-3a、AFD-3b、AFD-I5、AFD-I6）；patch 生命周期归 compatibility-architecture，版本支持声明归 afd-plugin-rules
---
# AFD compatibility 规则

## 现状

- 这些规则从 [[afd-plugin-rules]]（仓库规则）迁入最近 owner，保留原有稳定 ID。
- patch 生命周期见 [[compatibility-architecture]]（architecture），版本支持声明见 [[afd-plugin-rules]]（仓库规则）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/compatibility/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin, components, compatibility, review；created: 2026-08-06；updated: 2026-09-30
- 来源：
  - afd-plugin@a432692:AGENTS.md
  - afd-plugin@a432692:afd_plugin/compat/**
  - afd-plugin@a432692:docs/design/module/compatibility_and_patches.md
- 置信度（confidence）：high

- [AFD-3a] patch 必须 upstream-first 且可移除
  - 触发：新增 patch、修改已有 patch 或升级 vLLM/vLLM-Ascend。
  - 必须记录精确 upstream file/symbol/version/signature，优先复制对应版本函数，并保持签名和返回类型。
  - AFD 差异必须用 `# ### PATCH START: ...` / `# ### PATCH END: ...` 标出；函数上方必须说明 patch reason、行为变化和 upstream/移除条件。
  - 禁止在便利的全局 hook 中放置本应属于 AFD model、worker 或 connector 的功能。
  - 验收：AFD 和 non-AFD 分支、初始化/失败/shutdown 及需要时的 reload/idempotence 都有 focused tests，并写明移除路径。
- [AFD-3b] 上游 API drift 必须直接暴露
  - 触发：访问 vLLM/vLLM-Ascend 结构、添加 fallback 或选择 original-function delegation。
  - 必须直接访问预期上游函数和字段，让静态检查和原始错误暴露缺失/改名。
  - 禁止用宽泛 `getattr`、`hasattr`、`Any`、`object` 或 `_original_*` delegation 掩盖 drift。只有 `AGENTS.md` 明确允许的超大/不适合内联函数例外才可 delegation，且必须就地解释。
  - 验收：当前 pinned signature 对齐，故意缺失字段不会被 fallback 吞掉，保存的 original 不会在 reload 时被 wrapper 覆盖。
- [AFD-I5] 升级 vLLM 或 vLLM-Ascend 基线时，需要同步修改多个文件并做完整审计
  - vLLM 目标版本出现在三个地方：`pyproject.toml` 的 extra pin、`afd_plugin/compat/vllm.py` 的版本检查、README（Overview、Known gaps、GPU installation）。三处必须一致。
  - 插件注册用 `strict=False` 调版本检查，版本不符只告警。不能把“注册成功”当作新版本受支持的证据（`PATCH-INV-003`）。
    - `engine_core.py` 和 `npu/force_load_balance.py` 没有 patch 内的版本守卫，只能靠 review 把关。
    - `async_dp_engine.py` 里复制的 coordinator 只在 `0.26.0` 精确版本下生效，守卫要跟着更新。
    - `attention_model_runner.py` 里规避 DBO metadata cache 的代码：等 vLLM #48659 进入 pin 的版本后删除。
    - 连接器进程组用到的私有 PyTorch 和 vLLM 符号。
  - `pyproject.toml` 没有声明 vLLM-Ascend 依赖。刷新 Ascend 侧时，必须引用确切的 vLLM-Ascend 源码 commit（当前是 `80d8c194f`），同步 README 的 Ascend 基线表，并附上 NPU 单元测试和 E2E 证据。
- [AFD-I6] 临时替换上游符号的代码必须在 `finally` 里还原，并登记到兼容文档
  - 这类临时替换包括：包装 `create_forward_context`、在 `Worker.init_device()` 期间替换 runner 符号、包装 V2 capture 的输入准备、安装 full-graph replay hook、给 DBO 临时关闭 metadata cache。它们都必须在 `finally` 里恢复符号和 runner 状态，异常路径也要恢复。
  - 需要有测试覆盖恢复逻辑和错误路径。参考 `test_attention_model_runner.py` 对 DBO 规避代码的覆盖。
  - 新增的这类替换要写进 `docs/design/module/compatibility_and_patches.md` 的 scoped adaptation 列表，否则升级审计会漏掉它。
  - 需要在整个进程生效的替换，应放到 `afd_plugin/compat/patches/`，并走 patch 审查流程。反过来，AFD 自己的功能不要借全局 hook 藏进 patch 模块。
  - 保存了原函数的 patch，在模块重载时不能用自己的 wrapper 覆盖已保存的原函数。
