---
name: ci-guides-overview
description: vLLM-Omni CI 指南入口表：按遇到的问题指向 ci-gotchas、test-tiers、buildkite-structure、ci-environment-gotchas、optional-dependencies、accuracy-attribution 六篇指南
metadata:
  scope: 只收源目录 repos/vllm-omni/ci/guides 索引页的“遇到什么查哪里”对照表；各指南正文归表中所指页面，CI 目录总入口归 ci-overview-1
---
# vLLM-Omni CI 指南

## 现状

| 遇到什么 | 查看哪里 |
|---|---|
| JSON 配置、pipeline 和 perf CI 特有问题（仓库配置坑） | [[ci-gotchas]]（CI gotchas） |
| 测试分级 L1–L5 与 pytest markers | [[test-tiers]]（test tiers） |
| Buildkite 管线布局与队列→硬件映射 | [[buildkite-structure]]（buildkite structure） |
| 镜像/依赖/管线/超时等环境坑 runbook | [[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（CI environment gotchas） |
| 可选依赖未安装、硬件不满足与真实 kernel 的分层测试 | [[optional-dependencies]]（optional dependencies） |
| 精度失败先归因（golden/评分器/上游 bug/回归） | [[accuracy-attribution]]（accuracy attribution） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/guides/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, ci；created: 2026-07-10；updated: 2026-07-20
