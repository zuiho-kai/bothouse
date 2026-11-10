---
name: docs-rules
description: "DOCS-1a：发布 vLLM-Omni 版本时 README 公告、configuration 上游链接、安装兼容、CUDA/NPU 镜像 pin 与 supported-model 声明作为一个文档集合同步更新（PR #5715）"
metadata:
  scope: 只收 docs 目录的 DOCS-1a 发布版本同步规则；生成文档与 supported-model 证据规则归 generation-and-support-rules，repository skill 规则归 repository-skills，目录入口归 docs-overview
---
# vLLM-Omni 文档规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, docs；created: 2026-09-22；updated: 2026-09-22
- 来源（sources）：PR #5715
- [DOCS-1a] release version 与支持声明必须作为一个文档集合更新
  - 触发：发布 vLLM-Omni 版本，更新 vLLM compatibility、安装命令、CUDA/NPU 镜像或支持模型列表。
  - 强制：同一变更同步核对 root README 的发布公告/节奏、configuration 的 upstream 链接、installation compatibility、CUDA package/image pin、NPU branch/image pin 和 supported-model 声明；每处版本都来自本次发布矩阵，而不是从相邻示例复制。
  - 验收：对文档树做 repository-wide 的旧版本/旧分支扫描并逐个归类预期保留项；严格模式构建完整文档，检查内部链接、includes 与导航；从每个公开安装入口回读到同一兼容矩阵。^[PR #5715]

## 决策与踩坑

- [DOCS-1a] 禁止：只更新首页版本而保留旧安装 pin；CUDA 与 NPU 文档指向不同发布代际；链接文字已更新但目标仍是旧 upstream；用一次发布的具体版本号写成永久规则。
