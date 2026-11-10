---
name: 2026-04-25-ci-and-testing-10
description: 2026-04-25 CI 错题 inc-2026-04-25-ci-and-testing-10，只跑 compileall 没执行新增测试，object.__new__ 裸实例写 HunyuanImage3Pipeline 只读 property device 报 AttributeError
metadata:
  scope: 只收 2026-04-25 CI dummy guard 未实际执行导致 property 'device' 无 setter 这一起错题；同类的 stage_durations property 问题记在 2026-05-04-ci-and-testing-14，错题总表归 ci-incidents-overview
---
# 2026-04-25 — CI dummy guard 未实际执行导致 property 运行时错误

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-04-25-ci-and-testing-10.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-25-ci-and-testing-10`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：CI dummy guard 未实际执行导致 property 运行时错误
- 影响范围：repos/vllm-omni/ci
- **症状**：`AttributeError: property 'device' of 'HunyuanImage3Pipeline' object has no setter`
- **根因**：只跑了 `compileall`，没让新增测试函数实际执行；`object.__new__` 绕过初始化后直接写只读 property
- **解法**：`monkeypatch.setattr(HunyuanImage3Pipeline, "device", property(lambda self: torch.device("cpu")), raising=False)`
- **提醒**：`compileall` 不算行为验证；用 `object.__new__` 时先确认属性不是只读 property
