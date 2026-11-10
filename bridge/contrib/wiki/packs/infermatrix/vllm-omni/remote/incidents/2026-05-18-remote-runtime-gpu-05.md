---
name: 2026-05-18-remote-runtime-gpu-05
description: "2026-05-18 错题：PR #3626 HunyuanImage3 单测在 vllm 0.21.0 venv 全过，端到端 img2img 却因 OmniARAsyncScheduler 调 _get_routed_experts 的 API 漂移崩溃，换 0.20.2 venv 又撞 flashinfer JIT 失败；解法是 rebase 到 main，并加 venv 健康检查"
metadata:
  scope: 只收 2026-05-18 单测通过但端到端真跑崩（scheduler API 漂移、venv 与仓库 HEAD 版本不一致）这一起事故；vLLM 0.21 依赖安装本身的问题归 2026-05-18-remote-runtime-gpu-02
---
# 2026-05-18 — 端到端 smoke 撞 vllm scheduler API 漂移，单测能过但真跑崩

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/2026-05-18-remote-runtime-gpu-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-18-remote-runtime-gpu-05`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：端到端 smoke 撞 vllm scheduler API 漂移，单测能过但真跑崩
- 影响范围：repos/vllm-omni/remote
- **症状**：本次 PR (#3626 HunyuanImage3 infer_align_image_size) 单测在 `wt-i2t-test-fix/.venv` (vllm 0.21.0) 全过，真跑 `end2end.py img2img` 时 `OmniARAsyncScheduler` 调 `self._get_routed_experts(request)` AttributeError 立刻 die。
  - 换 `vllm-omni-pr3444-online-prompt-align/.venv` (vllm 0.20.2) → DiT forward 时 flashinfer ninja JIT `fused_moe_90` 失败。
- **根因**：
  - 仓库 HEAD 写的代码暗中假设了 upstream vllm 的某个版本（`_get_routed_experts` 是 0.20.x 的；0.21.0 不存在）。
  - "单测过"覆盖的只是被改动的 hot path（mm_processor / sampler / postprocess），不会触碰 scheduler + DiT forward。
  - venv 是别的 PR 留下来的，没人保证跟你 PR 的 vllm 期望一致。
- **解法**：
  1. rebase 到主干（main 当前已对齐 vllm 0.21.0），仓库代码、venv、upstream 三方对齐后端到端通。
  2. 真正修复路径不是改 venv 也不是 stub 接口，是 git rebase origin/main。
- **怎么避免**：
  1. **venv 健康检查脚本**：选 venv 前先跑

     ```bash
     $venv/bin/python -c "
     import vllm; print('vllm:', vllm.__version__)
     from vllm.v1.core.sched.scheduler import Scheduler
     print('_get_routed_experts:', hasattr(Scheduler, '_get_routed_experts'))
     import flashinfer; print('flashinfer:', flashinfer.__version__)
     "
     ```

     - 把"仓库 HEAD 期望调用的 upstream symbol"逐项 hasattr 一遍，3 秒钟决定 venv 配不配。
  2. **单测过 ≠ 真跑过**：单测只覆盖 mm_processor / postprocess 这类窄路径；scheduler + forward + KV transfer + connector 整链路必须真跑一次。声明 PR "已验证"前必须有 end-to-end 真跑证据。
  3. **PR 长时间未 rebase + main 升了 vllm 大版本**：先 `git rev-list --count main..HEAD --left-right` 看 behind 数；behind ≥ 20 且涉及 vllm 主版本变化时，先 rebase 再调试，别拿旧 venv 硬试。
  4. PR 描述里要标注"在 vllm X.Y.Z 上验证过"；reviewer 看到 vllm 版本不匹配可以直接打回。
