---
name: ci-incidents-overview
description: "vLLM-Omni CI 错题入口表：2026-04-22 至 2026-05-29 共 19 篇 ci-and-testing 错题（GEBench 参数、dummy guard、HF baseline 对比、PR #3055 / #3332 / #3723 / #3766 / 3474 / 3734 review 与测试漏项）的日期、标题和页面"
metadata:
  scope: 只收源目录 repos/vllm-omni/ci/incidents 索引页的错题对照表；每篇错题的症状、根因和解法归表中所指页面，CI 指南入口归 ci-guides-overview
---
# vLLM-Omni CI 错题

## 现状

| 错题 | 查看哪里 |
|---|---|
| 2026-04-22 — GEBench test 未传 --samples-per-type | [[2026-04-22-ci-and-testing-09]]（2026-04-22-ci-and-testing-09） |
| 2026-04-25 — CI dummy guard 未实际执行导致 property 运行时错误 | [[2026-04-25-ci-and-testing-10]]（2026-04-25-ci-and-testing-10） |
| 2026-05-04 — "DiT-AR resize 字节相等" 测试拿 vllm-omni 自己副本当 ground truth | [[2026-05-04-ci-and-testing-11]]（2026-05-04-ci-and-testing-11） |
| 2026-05-04 — "AR 输出对齐"被偷懒成 "AR 输入 prompt prefill 对齐" | [[2026-05-04-ci-and-testing-12]]（2026-05-04-ci-and-testing-12） |
| 2026-05-04 — 写 IT2I AR-vs-HF 对比测试时 HF baseline 抄了 benchmark 脚本的输入 | [[2026-05-04-ci-and-testing-13]]（2026-05-04-ci-and-testing-13） |
| 2026-05-04 — IT2I yaml 已跑通仍绕去 i2t.yaml single-stage hang 8 分钟 | [[2026-05-04-ci-and-testing-14]]（2026-05-04-ci-and-testing-14） |
| 2026-05-08 — 拿到"测一下 PR #3055"任务，自己手写 end2end 调用脚本而不用 PR 自带 pytest 用例 | [[2026-05-08-ci-and-testing-15]]（2026-05-08-ci-and-testing-15） |
| 2026-05-08 — 把 PR scope 内的"功能门"误读成"测试盲点"，建议跑 PR scope 外的路径 | [[2026-05-08-ci-and-testing-16]]（2026-05-08-ci-and-testing-16） |
| 2026-05-08 — PR #3332 review 三连：把 exploration-mode 残留带进了独立 smoke test PR | [[2026-05-08-ci-and-testing-17]]（2026-05-08-ci-and-testing-17） |
| 2026-05-08 — GEBench Qwen3-VL judge 给"几乎空的图"打 5/5 满分 | [[2026-05-08-ci-and-testing-18]]（2026-05-08-ci-and-testing-18） |
| 2026-05-19 — PR #3723 streaming image edit review 漏掉协议坏路径 | [[2026-05-19-ci-and-testing-06]]（2026-05-19-ci-and-testing-06） |
| 2026-05-19 — 提交前没跑 ruff，CI 被 F841 未使用变量打回 | [[2026-05-19-ci-and-testing-07]]（2026-05-19-ci-and-testing-07） |
| 2026-05-19 — HunyuanImage3 IT2I AR streaming PR 交付复盘 | [[2026-05-19-ci-and-testing-08]]（2026-05-19-ci-and-testing-08） |
| 2026-05-21 — PR #3766 pre-commit 因 ruff format 漏跑失败 | [[2026-05-21-ci-and-testing-04]]（2026-05-21-ci-and-testing-04） |
| 2026-05-21 — PR #3723 reviewer feedback 复盘：streaming public API 不能只按 endpoint 增量做 | [[2026-05-21-ci-and-testing-05]]（2026-05-21-ci-and-testing-05） |
| 2026-05-26 — PR #3766 DiT batching 漏测非齐次 attention metadata | [[2026-05-26-ci-and-testing-03]]（2026-05-26-ci-and-testing-03） |
| 2026-05-26 — PR #3474 GO-1-Air：shape-clean smoke 掩盖新模型语义错配 | [[2026-05-26-ci-and-testing-19]]（2026-05-26-ci-and-testing-19） |
| 2026-05-29 — PR #3734 prefix-cache 修完 runner 后，又漏掉 online serving chat_template 入口 | [[2026-05-29-ci-and-testing-01]]（2026-05-29-ci-and-testing-01） |
| 2026-05-29 — PR #3734 新路径激活主线 dormant typo，第一次修复误判真实 runner abstraction | [[2026-05-29-ci-and-testing-02]]（2026-05-29-ci-and-testing-02） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/_index.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
