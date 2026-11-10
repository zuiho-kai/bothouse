---
name: krea2-rules
description: "Krea 2 规则 KREA-1a 至 KREA-2a（PR #4730）：text encoder 与 VAE 显式继承 od_config.dtype、读 vae/config.json 等 config-only 文件不得触发全权重下载、offline / online / HSDP / offload / VAE patch parallel 能力逐项验收；含 Direct 代码快速入口"
metadata:
  scope: 只收 KREA-1a、KREA-1b、KREA-2a 的触发、强制、禁止与验收；名称范围与 pipeline 流程归 krea2-overview
---
# Krea 2 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/krea2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-09-04
- 来源（sources）：PR #4730
- 置信度（confidence）：high
- 只有 `KREA-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| Krea 2、pipeline/transformer | KREA-1a | `diffusion/registry.py::_DIFFUSION_MODELS["Krea2Pipeline"]` → `diffusion/models/krea2/pipeline_krea2.py::Krea2Pipeline`、`krea2_transformer.py::Krea2Transformer2DModel` |
| text encoder/VAE dtype、峰值显存 | KREA-1a | `Krea2Pipeline` 的 component loader |
| `model_index.json`、`vae/config.json`、Hub/cache | KREA-1b | `pipeline_krea2.py` 的 config fetch 与 VAE scale consumer |
| online/HSDP/offload/VAE parallel 支持声明 | KREA-2a | capability 文档/recipe → 实际 offline/online 入口 |

### [KREA-1a] text encoder 与 VAE 显式继承目标 dtype

- 触发：构造或替换 Krea 2 text encoder/VAE loader。
- 强制：两者都显式传递 `od_config.dtype`（或当前 canonical dtype owner）。
- 验收：loader 单测分别断言两个组件的 `torch_dtype`；真实加载记录组件 dtype 与峰值显存。 ^[PR #4730]

### [KREA-1b] config-only 读取不能触发全权重下载

- 触发：计算 VAE scale 或读取 `vae/config.json`、`model_index.json`。
- 强制：使用精确文件获取 helper，只请求所需 config；离线 cache 缺文件时给出具体路径。
- 验收：mock Hub/cache 层断言请求文件集合；config 已缓存时无网络，缺失时错误指向具体 config 而非笼统权重失败。 ^[PR #4730]

### [KREA-2a] offline、online 与并行能力逐项验收

- 触发：supported-model 表、recipe 或 PR 声明 online、HSDP、layerwise offload、VAE patch parallel。
- 强制：offline 与 online 使用各自真实入口；每个并行/offload 勾选项有独立路径证据。
- 验收：online e2e 从公开 endpoint 返回图像；capability matrix 每格绑定当前 head 的命令、环境和结果。 ^[PR #4730]
- 共享 loader 合同见 [[rules-loader-contract]]（Model Executor EXEC-2a；源锚点 #exec-2a-loader-的-dtype-与-config-获取必须显式最小化）；证据分层见 [[model-validation]]（model validation）。

## 决策与踩坑

- [KREA-1a] 禁止：依赖 `from_pretrained` 默认 fp32，再在 pipeline 中事后 cast；会增加峰值显存并产生 dtype mismatch 窗口。
- [KREA-1b] 禁止：调用 snapshot/full-weight 下载模式只为读取一个 JSON，阻塞启动并污染 cache。
- [KREA-2a] 禁止：只有 offline 能跑却宣称 `vllm serve`/images endpoint；用一个分布式 smoke 同时支撑所有能力。
