---
name: bagel-overview
description: BAGEL-7B-MoT（ByteDance-Seed，main @ 5d44868e 复核）目录入口：AR 类 OmniBagelForConditionalGeneration 与 diffusion BagelPipeline 的注册、bagel / bagel_think / bagel_single_stage 三个 pipeline key 的一句话差异（KV prefill 完即传 vs EOS 后才传 vs 单 DIFFUSION stage）、各入口源码路径、bagel.yaml 共卡配置与 BAGEL_EXTRA_BODY_PARAMS、什么时候查
metadata:
  scope: 只收 BAGEL 的名称、注册、三形态速览、配置差异和目录路由；AR→DiT 数据流与 KV 合同归 bagel-architecture，BAGEL-1 至 BAGEL-5 归 bagel-rules，派生家族入口归 lance-overview
---
# BAGEL

## 现状

- 以下事实在 `main @ 5d44868e` 复核。树内"统一模型多形态部署"的钦定参照（见 [[reference-models]]（reference-models））。

### 名称与范围

- 正式名称 BAGEL-7B-MoT,常用简称 BAGEL（ByteDance-Seed;deploy YAML 本体不 pin checkpoint,头注与 recipe 指向 `ByteDance-Seed/BAGEL-7B-MoT`）。
- AR registry：`OmniBagelForConditionalGeneration` →（`bagel`, `bagel`, `OmniBagelForConditionalGeneration`）;diffusion registry：`BagelPipeline`（post-process 是 identity,pipeline 直接返回 PIL Image）。
  - 注意两套架构名：Omni AR 类是 `OmniBagelForConditionalGeneration`,HF checkpoint/单 stage 形态用 `BagelForConditionalGeneration`。
- 三个 pipeline key,变体差异一句话版（细节见 architecture）: `bagel`（thinker→dit,KV **prefill 完即传**）/ `bagel_think`（同拓扑,KV **EOS 后才传**,给 `<think>` 解码留时间）/`bagel_single_stage`（单 DIFFUSION stage 自足）。deploy 三份 YAML（think 通过 `base_config: bagel.yaml` 只改 pipeline key——继承机制的示范用例）。
- 入口路径：拓扑 `model_executor/models/bagel/pipeline.py`;AR `model_executor/models/bagel/bagel.py`;DiT `diffusion/models/bagel/pipeline_bagel.py`;桥 `model_executor/stage_input_processors/bagel.py`;extra-body `model_extras/bagel.py`。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）（CFGParallelMixin、分布式 VAE）;stage 间连接器默认配置为 SharedMemoryConnector,Mooncake RDMA 是 YAML 中的备选项;多 stage 共卡显存预算见 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Config 规则 CONF-1a）（Bagel 正是案例）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| KV 桥接、3 路 CFG、MoT、变体拓扑 | [[bagel-architecture]]（architecture） | AR→DiT 数据流与 reviewer 陷阱 |
| CFG position ID、step wave、输出画布或复制相位的 SP dispatch | [[bagel-rules]]（rules） | BAGEL-1–BAGEL-5：序列轴、step/packing、有效几何、fallback 清理和 prefill/cache-update 的 local attention。 |

### 配置与 checkpoint 差异

- `bagel.yaml`：A100-80GB 验证;stage 0 `gpu_memory_utilization 0.45` + stage 1 `enforce_eager`,默认单卡共卡（注释说明双卡改法）;`seed 52`。
- extra-body 面：`model_extras/bagel.py` 的 `BAGEL_EXTRA_BODY_PARAMS`（cfg_text_scale/cfg_img_scale/cfg_interval/think/timestep_shift 等）+ t2i/i2i prompt builder,注册在 spec key `"BagelPipeline"` 下。

### 什么时候查这里

- 一个模型要支持多种 stage 拓扑/思考形态时参考其拓扑与 KV 合同;审查 KV-cache 桥接、CFG 伴随请求或 MoT 权重路径改动时先读 architecture。
- 调查 BAGEL image step execution 时先读 BAGEL-3：two-stage 只在 diffusion Stage 1 step，single-stage text 保持完整请求路径；有效 geometry/CFG 兼容性决定能否同 wave。
- [[lance-overview]]（Lance） 的 pipeline 继承自 `BagelPipeline`（`diffusion/models/lance/`,见该页）——改 Bagel 公共面先扫 lance。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/bagel/_index.md`（InferMatrixCopilot@ecfb84d0）；title: BAGEL（统一模型多形态部署参照）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-10-06
- 来源（sources）：PR #6359；PR #7049；vllm_omni/model_executor/models/bagel/；vllm_omni/diffusion/models/bagel/；vllm_omni/deploy/bagel.yaml
