---
name: pipeline-overview
description: Jianghan 数据管线 目录总览：什么时候查这里、不放什么，以及目录内容的入口说明
metadata:
  scope: 只收源目录 repos/jianghan-roleplay-data-pipeline/pipeline 索引页里的使用时机、收录边界和入口说明；具体内容归入口所指的各页
---
# Jianghan 数据管线

## 现状

- 什么时候查这里：
  - 处理 Jianghan 数据管线、阶段交接、QA 或训练材料。
- 不放什么：
  - vLLM-Omni 模型与 CI 内容。

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/_index.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）

### 目录内容

- 遇到什么：理解完整数据管线
  - 查看哪里：[[pipeline-architecture]]（architecture）
- 遇到什么：查看各阶段职责
  - 查看哪里：[[stages]]（stages）
- 遇到什么：查看数据约束与表达机制
  - 查看哪里：[[data-contracts]]（data contracts）
- 遇到什么：查看当前交接和远端卫生
  - 查看哪里：[[handoff]]（handoff）
- 遇到什么：调查历史错误
  - 查看哪里：[[pipeline-incidents-overview]]（incidents）
