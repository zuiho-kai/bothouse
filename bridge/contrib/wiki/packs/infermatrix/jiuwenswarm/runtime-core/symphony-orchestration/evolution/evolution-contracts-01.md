---
name: evolution-contracts-01
description: evolution 源码接口与集成边界 01：jiuwenswarm/symphony/evolution/__init__.py 的模块职责说明与对 aggregate、service 的导入声明
metadata:
  scope: 只收 symphony/evolution/__init__.py 一个文件的静态声明；evolution 其余模块的行为说明归 jiuwenswarm-symphony-evolution
---
# evolution 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/symphony/evolution/__init__.py`**
- 源码对模块职责的说明：Runtime evolution layer for Symphony skill graphs.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.symphony.evolution.aggregate import build_overlay_from_eve`；`from jiuwenswarm.symphony.evolution.service import evolution_status, load_d`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/__init__.py#L1-L13)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/evolution/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
