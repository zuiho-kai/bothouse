---
name: 2026-05-04-ci-and-testing-13
description: 2026-05-04 CI 错题 inc-2026-05-04-ci-and-testing-13，IT2I AR-vs-HF 对比测试的 HF baseline 抄了 scripts/bench/bench_ar_hf.py 的 i2t 风格输入，与 Omni 侧 IT2I 输入对不上，token 对比无意义
metadata:
  scope: 只收 2026-05-04 对比测试两侧输入没有从同一 regression intent 派生的错题；对齐语义被简化归 2026-05-04-ci-and-testing-12，换 yaml 绕路归 2026-05-04-ci-and-testing-14
---
# 2026-05-04 — 写 IT2I AR-vs-HF 对比测试时 HF baseline 抄了 benchmark 脚本的输入

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-04-ci-and-testing-13.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-04-ci-and-testing-13`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：写 IT2I AR-vs-HF 对比测试时 HF baseline 抄了 benchmark 脚本的输入
- 影响范围：repos/vllm-omni/ci
- **症状**：HF baseline JSON 用 prompt=`"Describe the content of the picture."` + 随机噪声图（i2t 风格）；Omni capture 用 prompt=`"Add a cute orange cat..."` + 方块图（IT2I 风格）。两边输入对不上，token 序列对比无意义
- **根因**：我直接抄了 `scripts/bench/bench_ar_hf.py` 的 PROMPT + image setup。那是个**测 AR 速度的 benchmark 脚本**，输入随便挑一个 "能跑通就行" 的；不是 IT2I 回归场景的输入。我问的问题是 "what setup runs HF AR" 而不是 "what setup mirrors the IT2I intent we're regressing"
- **解法**：对比测试两侧 input 必须从**同一个 intent 描述**派生（用 IT2I 编辑 prompt + IT2I 风格条件图 + bot_task=think + sampling=greedy），不能一边从 benchmark 脚本抄一边从产品 yaml 抄
- **对未来的提醒**：写比对测试前先写一句话 "本测试要 regress 的场景是什么"，然后两边 input 都从那句话派生。任何便利模板（benchmark/sample/example 脚本）的输入都要重新评估，"它能跑通"≠"它跟我的 regression intent 同一个分布"
