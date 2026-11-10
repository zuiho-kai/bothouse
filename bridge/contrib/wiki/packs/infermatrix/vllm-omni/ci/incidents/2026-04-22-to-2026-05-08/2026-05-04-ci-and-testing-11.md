---
name: 2026-05-04-ci-and-testing-11
description: 2026-05-04 CI 错题 inc-2026-05-04-ci-and-testing-11，DiT-AR resize 字节相等测试导入的是 vllm-omni 自己的 HunyuanImage3Processor 副本而非模型 snapshot 的 image_processor.py
metadata:
  scope: 只收 2026-05-04 把 vllm-omni 仓库内副本当官方 ground truth 的错题及从 HF snapshot 用 importlib 加载的解法；AR 输出对齐语义归 2026-05-04-ci-and-testing-12，HF baseline 输入不一致归 2026-05-04-ci-and-testing-13
---
# 2026-05-04 — "DiT-AR resize 字节相等" 测试拿 vllm-omni 自己副本当 ground truth

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-04-ci-and-testing-11.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-04-ci-and-testing-11`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词："DiT-AR resize 字节相等" 测试拿 vllm-omni 自己副本当 ground truth
- 影响范围：repos/vllm-omni/ci
- **症状**：写完 byte-equality 测试 PASS，但用户问"你从哪获得官方的"，发现导入的是 `vllm_omni.model_executor.models.hunyuan_image3.HunyuanImage3Processor`——vllm-omni 自己的 PR 提交记录里的副本
- **根因**：写 "对齐官方 X" 测试时贪图 `from vllm_omni... import` 顺手，没确认导入的对象是否真来自模型 snapshot
- **解法**：改用 `importlib.util.spec_from_file_location` 从 `$HF_HOME/hub/models--<owner>--<name>/snapshots/<hash>/image_processor.py` 加载，相对 import 用 fake parent package 注册（`sys.modules[pkg].__path__ = [snap_dir]`）
- **对未来的提醒**：写 "对齐官方 X" 测试前硬性自检——「git-blame 我导入的 X，commits 是 vllm-omni 仓库的，还是 model-repo 的？」前者一律不能当 official reference
