---
name: 2026-05-04-ci-and-testing-14
description: 2026-05-04 CI 错题 inc-2026-05-04-ci-and-testing-14，hunyuan_image3_it2i.yaml 已跑通仍换去 i2t.yaml 导致 orchestrator init hang 8 分钟，另记 stage_durations 只读 property 无 setter 的 AttributeError
metadata:
  scope: 只收 2026-05-04 绕离已跑通的 IT2I yaml 的错题（解法是在 ar2diffusion bridge 处 monkey-patch 捕获）和同页记录的 stage_durations property 问题；device property 的同类问题归 2026-04-25-ci-and-testing-10
---
# 2026-05-04 — IT2I yaml 已跑通仍绕去 i2t.yaml single-stage hang 8 分钟

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-04-ci-and-testing-14.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-04-ci-and-testing-14`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：IT2I yaml 已跑通仍绕去 i2t.yaml single-stage hang 8 分钟
- 影响范围：repos/vllm-omni/ci
- **症状**：用户证明 `hunyuan_image3_it2i.yaml` 端到端 OK（生成猫图），我换去 `hunyuan_image3_i2t.yaml` 跑 AR-only 对比测试，那 yaml 在本环境 hang 在 orchestrator init 8+ 分钟没动
- **根因**：换 yaml 前没问"我能不能在已跑通的路径上加 hook"。i2t 看起来"逻辑更干净"——美学优于实用
- **解法**：保持 IT2I yaml 不变；monkey-patch `vllm_omni.model_executor.stage_input_processors.hunyuan_image3.ar2diffusion` 在 bridge 处捕获 stage 0 `engine_outputs`（AR 生成的 cumulative_token_ids）
- **对未来的提醒**：用户说"X 已跑通"后，**不能在不显式解释为什么换的前提下绕路**。换路径 = 承担新路径全部 init/dep 风险，「代码整洁度」对用户没有价值
- **症状**：`AttributeError: property 'stage_durations' of 'HunyuanImage3Pipeline' object has no setter`
- **根因**：`stage_durations` 只读 `@property`，getter 依赖 `_profiler_lock`（只有 `setup_diffusion_pipeline_profiler` 才初始化）；`object.__new__` 裸实例两个问题叠加
- **解法**：加 `@stage_durations.setter`（懒初始化）；getter 加 `hasattr` 守卫
- **提醒**：新增 Mixin property 先问：测试能不能直接赋值？这是同类问题第二次
