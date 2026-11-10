---
name: afd-plugin-overview
description: AFD plugin 仓库知识入口（总览）：仓库和适用范围、什么时候查这里、不放什么，以及目录内容的入口说明
metadata:
  scope: 只收源目录 repos/afd-plugin 根索引页里的仓库身份、适用范围、使用时机、收录边界和入口说明；具体规则与架构归入口所指的各页
---
# AFD plugin 仓库知识入口

## 现状

### 仓库和适用范围

- 上游仓库：`vllm-project/afd-plugin`。
- 默认分支：`main`。
- 知识镜像基线：`a432692ed7d5dd6437a4755b530ee7aaf2685dad`，对应 vLLM `0.26.0`。
- 适用范围：AFD 插件的注册与配置、Attention/FFN 角色运行时、connector/distributed、模型集成、CUDA/Ascend 平台机制和上游兼容 patch。
- 仓库自己的 `AGENTS.md`、`.agents/skills/run-e2e/SKILL.md`、CI 和当前代码保持权威；这里保存可路由的 owner 知识。

### 什么时候查这里

- 修改 `afd_plugin/**`、`csrc/**`、打包文件或 AFD GPU/Ascend 运行路径。
- 调查插件注册、Attention/FFN 角色运行、connector、模型包装、平台机制或兼容补丁。
- 为 AFD changed files 选择最近 owner 和 focused tests。

### 不放什么

- 换到其他仓库仍成立的方法放 general（源链接 `../../general/_index.md`，不在本 pack 内）。
- vLLM-Omni 的模型、远端、benchmark 或 rebase 经验放 vllm-omni（源链接 `../vllm-omni/_index.md`，不在本 pack 内）。
- 不复制 AFD 仓库完整 README、AGENTS 或 E2E skill；运行细节以目标仓库当前文件为准。
- 不记录本机 checkout 路径、硬件账号、模型 cache 或凭据。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin；created: 2026-08-05；updated: 2026-10-09
- 来源：
  - afd-plugin@a432692:README.md
  - afd-plugin@a432692:docs/design/module/index.md

### 目录内容

- 遇到什么：开始任何 AFD review 或 issue answer
  - 查看哪里：[[afd-plugin-rules]]（仓库规则）
  - 说明：仓库身份、支持边界与验证门禁
- 遇到什么：理解系统边界和端到端数据流
  - 查看哪里：[[afd-plugin-architecture]]（仓库架构）
  - 说明：Attention/FFN、connector、模型与平台关系
- 遇到什么：按源码路径找最近 owner
  - 查看哪里：[[components-overview]]（组件入口）
  - 说明：七个 owner、源码边界与 focused tests
- 遇到什么：修改注册、配置、CPU-safe import 或 worker 选择
  - 查看哪里：[[plugin-boundary-overview]]（plugin-boundary）
  - 说明：normative 插件边界和专项规则
- 遇到什么：新增或刷新 monkey patch
  - 查看哪里：[[compatibility-overview]]（compatibility）
  - 说明：版本补丁、非 AFD 路径与移除条件
- 遇到什么：核对 connector/graph/DBO 当前支持组合
  - 查看哪里：[[execution-platforms-architecture]]（execution-platforms）
  - 说明：v0.26 CUDA/Ascend 平台现状
- 默认 briefing 只加载本入口和仓库规则；深层 owner 页面由 changed-file route 或 `doc_search` / `doc_read` 按需读取。
- [[afd-plugin-rules-init-1]]（AFD plugin 初始化与 E2E 门禁规则）：保留 AFD-I8 的文档/平台边界，GPU MRV2 DBO 按目标版本转入平台规则。
- 上游 API 漂移与兼容边界（afd-plugin）：[[rules-seed-vllm-omni-rebase-upstream-api-drift]]
- 每次审查 AFD PR 都先套用的通用审查规则。AFD 特有的门禁再看本仓库的规则页。（源链接 `../../general/review/rules.md`，不在本 pack 内）
- 以下情况先读这页，判断是否应该先改上游：新增或刷新 compat patch、从 vLLM/vLLM-Ascend 复制函数，或在插件里重写上游逻辑（MoE routing、DP metadata、graph capture、EngineC
  - （源链接 `../../general/review/guides/upstream-first-for-algorithm.md`，不在本 pack 内；链接文字在源页即截断于 `EngineC`）
