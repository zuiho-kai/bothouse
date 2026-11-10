---
name: skill-retrieval-contracts-01
description: skill-retrieval 源码接口与集成边界 01：jiuwenswarm/symphony/skill_retrieval/__init__.py 对 SkillTaxonomyRuntime 的导出与模块职责说明
metadata:
  scope: 只收 skill_retrieval/__init__.py 一个文件的静态声明；SkillTaxonomyRuntime 的行为说明归 jiuwenswarm-symphony-service
---
# skill-retrieval 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/symphony/skill_retrieval/__init__.py`**
- 源码对模块职责的说明：JiuwenSwarm adapter for Symphony's optional Skill taxonomy index.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .runtime import SkillTaxonomyRuntime`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/skill_retrieval/__init__.py#L1-L5)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/skill-retrieval/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
