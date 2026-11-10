---
name: vllm-gr-overview
description: vLLM-GR 仓库入口（JiusiServe/vllm-gr）：repository identity、baseline commit、supported vLLM versions、边界与 components 入口
metadata:
  scope: 只收源目录 repos/vllm-gr 根索引页的仓库身份、版本基线、收录边界和入口说明；各 source owner 归 components 下各页
---
# vLLM-GR repository entry

## 现状

### When to use this entry

- Repository: `JiusiServe/vllm-gr`; aliases `vllm-gr` and `vllm_gr`.
- Default branch: `main`.
- Source map baseline: `a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee`.
- The baseline supports vLLM `0.22.1` and vLLM-Ascend `0.22.1rc1`; inspect the target revision's own constraints before validation.
- This repository implements generative recommendation inference, including OneRec beam/catalog paths, Pangu passthrough and GPU/NPU execution.

### Outside this entry

- Repository-independent review procedures belong to general review（源链接 `../../general/review/_index.md`，不在本 pack 内）.
- vLLM-Omni model and diffusion assumptions belong to that repository and do not apply here.
- This map describes the pinned main branch; new transports and APIs must be verified from the reviewed head.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/_index.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-GR repository entry；type: index；tags: vllm-gr；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:README.md

### Contents

- Task：Select a source owner and focused tests
  - Entry：[[components-overview]]（Components）
  - Boundary：EngineCore, BeamProc, serving, attention and packaging
- Direct owner signals and source scopes are declared in `_routes.yaml`; adapter aliases and briefing live in `adapters/vllm_gr/manifest.yaml`.
