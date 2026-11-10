---
name: docs-overview
description: vLLM-Omni 文档入口：RFC 状态、RAT/CCB 模板、官方设计文档地图、generated docs 与 supported-model 规则、repository skill 规则的场景分流表，以及 stable 0.28 / vLLM-Ascend v0.28.0 镜像 / CUDA nightly tag / full-duplex experimental 的发布与安装边界
metadata:
  scope: 只收 docs 目录的查看分流、发布与安装边界说明；RFC、模板、设计文档地图与各规则正文归 rfcs-status、rat-requirement-template、ccb-change-request-template、design-doc-map、generation-and-support-rules、repository-skills；DOCS-1a 归 docs-rules；跨仓库通用文档方法不在此页
---
# vLLM-Omni 文档

## 现状

### 什么时候查这里

- 编写或核验 vLLM-Omni 文档、RFC 和仓库专有公开说明。

### 不放什么

- 跨仓库通用的文档方法；先看 `general/docs/`。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 判断 RFC 是否仍在进行 | RFC status（源链接 `rfcs/_index.md`） |
| 查找仓库专有的文档与规划模板 | [[docs-guides-overview]]（documentation guides） |
| 编写或评审 RAT 需求文档 | [[rat-requirement-template]]（RAT requirement template） |
| 对已基线需求发起 CCB 变更申请 | [[ccb-change-request-template]]（CCB change request template） |
| 找上游官方设计文档与其知识树 owner | [[design-doc-map]]（design-doc map） |
| generated example URL/nav、supported-model recipe 与硬件证据 | [[generation-and-support-rules]]（generation and support rules） |
| contributor agent workflow、repository skill catalog 与信任边界 | [[repository-skills]]（repository skill rules） |

### 发布与安装边界

- stable 0.28 文档将 vLLM-Omni `0.28.x` 与 vLLM `0.28.x` 对齐，configuration/env links 指向 v0.28；这只是 release-documentation guidance，不能从 README highlights 推出 runtime/model support。
- NPU A2/A3 installation examples 使用 aligned vLLM-Ascend v0.28.0 images；latest-main 安装仍在该 aligned container 内进行。CUDA nightly `nightly` 是 rolling tag，`nightly-<commit>` 为 reproducible commit tag，文档称只保留 newest 14。各 tag/image 的 live availability 仍须发布时核验。^[PR #6858]
- README 将 full-duplex realtime serving 标为 experimental；公开说明、验收和支持承诺不能把它写成 stable feature。
- [[docs-rules]]（rules） 新增核对：DOCS-1a。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, docs；created: 2026-07-10；updated: 2026-09-22
- 来源（sources）：PR #5715；PR #6029；PR #6858；.claude/skills/readme.md；README.md；docs/configuration/README.md；docs/contributing/README.md；docs/getting_started/installation/README.md；docs/getting_started/installation/gpu/cuda.inc.md；docs/getting_started/installation/npu/npu.inc.md
