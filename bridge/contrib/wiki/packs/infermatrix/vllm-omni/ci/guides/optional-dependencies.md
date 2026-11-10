---
name: optional-dependencies
description: "可选依赖测试指南（PR #5037）：新增 quantization/kernel/backend 可选包时的 import 顺序、sys.modules 假模块与真实 kernel smoke 的分工、Tensor.cuda 等 patch 的验证，以及依赖缺失 / 硬件不满足 / 均满足的三层验收"
metadata:
  scope: 只收可选依赖未安装、硬件不满足与真实 kernel 三种情形下测试如何分层和验收；镜像与动态库问题归 ci-environment-gotchas-1，分级与 marker 定义归 test-tiers
---
# 可选依赖测试

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/guides/optional-dependencies.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-07-20；updated: 2026-07-20
- 来源（sources）：PR #5037
- 置信度（confidence）：high
- 新增 quantization、kernel 或 backend 可选包时，先画出 import 顺序：任何顶层 import 若发生在 skip marker、availability check 或假模块建立之前，无依赖环境会在 collection 阶段失败。`mocker.patch("pkg.symbol", create=True)` 只能创建属性，不能让不存在的 package 变得可导入。^[PR #5037]
- 无依赖单测可以在目标模块 import 前向 `sys.modules` 注入满足 import contract 的最小假模块；真实 kernel smoke 则继续使用 availability/CUDA marker，两者不能互相冒充。patch `Tensor.cuda`、descriptor 或 bound method 时必须验证 `self` 绑定和真实返回 shape，并实际执行使用该 fixture 的目标测试，不能只断言 mock 创建成功。^[PR #5037]

### 三层验收

1. 依赖完全缺失：目标模块可收集，并产生约定的 skip 或明确错误。
2. 依赖存在、硬件不满足：不会误跑真实 kernel，平台限制与文档一致。
3. 依赖和硬件均满足：真实 smoke 命中实现，而不是假模块或 mock 分支。
- 运行时支持范围还必须与 API surface guide（源链接 `../../../../general/review/guides/code-taste-api-surface.md`） 中的 alias/hardware claim 规则一致；镜像和动态库问题转到 [[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（CI environment gotchas）。
