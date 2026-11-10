---
name: 2026-05-19-remote-validation-012
description: "2026-05-19 错题：PR #3606 验证脚本假设 HunyuanImage3 snapshot 下有 deploy.yaml 致 FileNotFoundError；真实 YAML 在仓库 vllm_omni/deploy/hunyuan_image3_ar.yaml 与 hunyuan_image3.yaml"
metadata:
  scope: 只收 2026-05-19 远端路径不能猜、模型 snapshot 不等于 deploy config 所在地这一起事故及按 workload 选 YAML；读本机远端配置归 2026-05-19-remote-validation-010，不同机器路径记忆归 2026-05-20-remote-validation-015
---
# 2026-05-19 — 远端路径不能猜：模型 snapshot 不等于 deploy config 所在地

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-19-remote-validation-012.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-remote-validation-012`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：远端路径不能猜：模型 snapshot 不等于 deploy config 所在地
- 影响范围：repos/vllm-omni/remote
- **症状**：PR #3606 验证脚本假设 HunyuanImage3 snapshot 下存在 `/root/.cache/.../snapshots/<sha>/deploy.yaml`，实际没有，`make_pr3606_config.py` 直接 `FileNotFoundError`。真实 deploy yaml 在代码仓库的 `vllm_omni/deploy/hunyuan_image3_ar.yaml` / `hunyuan_image3.yaml`。
- **根因**：把“模型权重 snapshot”误当成“运行部署配置源”。vLLM-Omni 的 deploy YAML 是仓库代码配置，不是 HF checkpoint 的固定组成部分；不同任务（AR-only / full AR+DiT / DiT-only）还对应不同 YAML。
- **解法**：远端写 config patch 前先查真实路径：

```bash
find <REMOTE_WORK_ROOT> -maxdepth 4 \( -name "*hunyuan*yaml" -o -name "deploy*.yaml" -o -name "*image3*.yaml" \) -print
find /root/.cache/huggingface/hub/models--tencent--HunyuanImage-3.0-Instruct -maxdepth 4 \( -name "*.yaml" -o -name "*.yml" \) -print
```

- 然后按 workload 选 YAML：AR-only profiling 用 `vllm_omni/deploy/hunyuan_image3_ar.yaml`；全链路 img2img/t2i 用 `vllm_omni/deploy/hunyuan_image3.yaml`。
- **怎么避免**：
  1. 远端所有路径先 `ls/find` 实证，尤其是模型 snapshot、deploy config、测试图片、venv。
  2. PR 性能验证脚本里把 `MODEL_CFG` 打印出来，并在启动前 `test -f "$MODEL_CFG"`。
  3. 不要用“应该在 snapshot 里”当路径依据；仓库 config 和 HF checkpoint 是两类资产。
