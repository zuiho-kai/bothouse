---
name: wan2-2-overview
description: Wan 2.2 目录入口（main @ 5d44868e）：七个 registry 架构（T2V / I2V / VACE / S2V / 两个 DMD2 / FastVideo WanDMDPipeline）到模块类的映射、pipeline key wan2_2_ti2v、变体速览、import 期 patch_wan_rms_norm 的进程级副作用、Wan VAE spatial shard 合同归 DIFF-3b、wan2_2_ti2v.yaml 与 boundary_ratio 一值两用、distilled LoRA 只接 Wan22Pipeline 与 Wan22I2VPipeline（DIFF-2n）
metadata:
  scope: 只收 Wan 2.2 的名称、registry 映射、变体、配置与 checkpoint 差异及查阅场景；双专家 boundary 合同、DMD2 sanitizer 与变体矩阵归 wan2-2-architecture，共享 diffusion 设施归 diffusion-overview，dreamzero 的 Wan VAE 用法归 dreamzero-overview
---
# Wan 2.2

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 家族覆盖 Wan 2.1/2.2 视频模型（I2V 的可选 CLIP image encoder 即 Wan2.1 式 checkpoint 兼容路径）;标识:家族目录/registry 家族名 `wan2_2`, pipeline key `wan2_2_ti2v`。纯 diffusion(AR registry 无入口)。
- 六个 registry 架构 → 模块/类映射（都在 `diffusion/models/wan2_2/`）：`WanPipeline`→`pipeline_wan2_2.Wan22Pipeline`; `WanImageToVideoPipeline`→`pipeline_wan2_2_i2v.Wan22I2VPipeline`; `WanVACEPipeline`→`pipeline_wan2_2_vace.Wan22VACEPipeline`; `WanS2VPipeline`→`pipeline_wan2_2_s2v.Wan22S2VPipeline`;
  - `WanT2VDMD2Pipeline`（同模块于 pipeline_wan2_2）与 `WanI2VDMD2Pipeline`（pipeline_wan2_2_i2v）与 `WanDMDPipeline`（映射到 `Wan22Pipeline`）——**七个都有 pre+post process 绑定**（DMD2 复用基类函数）。
- 入口路径：registry `vllm_omni/diffusion/registry.py` 与 `vllm_omni/config/pipeline_registry.py`;拓扑 `vllm_omni/model_executor/models/wan2_2/pipeline.py`。
  - pipeline key 只有 `wan2_2_ti2v`——单 `stage_id=0` 的 DIFFUSION/`dit` stage, `final_output_type="video"`;其余五架构走默认单 stage diffusion 兜底,无显式 key;YAML 也不自动加载（无 `default_deploy_config_name`,显式传裸文件名时按 `_DEPLOY_DIR` 解析）。
- 变体速览：I2V = 首帧 latent 通道拼接 + 可选 CLIP 图像编码器（Wan2.1 式 checkpoint）;VACE = 参考图/源视频/掩码条件,单或双专家形态都接受;S2V = 单 transformer,支持 diffusers 与原始格式 checkpoint（T5→UMT5 转换）;两个 DMD2 = 分别继承 T2V/I2V 行为,换 DMD2 调度并禁 CFG；`WanDMDPipeline` 是 FastVideo checkpoint 的三步 flow path，不与 DMD2 mixin 混同。
- import 期副作用：`__init__.py` 调 `patch_wan_rms_norm()` 把所有已加载 diffusers 模块里的 `WanRMS_norm` 换成本仓 `RMSNormVAE`——**进程内任何 diffusers Wan VAE 用户都被影响**（例如 [[dreamzero-overview]]（dreamzero） 用 `DistributedAutoencoderKLWan`）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）（CFG-parallel、SP、PP mixin、分布式 VAE）、`diffusion/models/dmd2/` 蒸馏 mixin。
- Wan VAE spatial height/width gather→trim→reshard 的 empty/partial-tail、rank context 与 attention extent 合同由共享 [[rules-wan-spatial-shard]]（DIFF-3b；源锚点 #diff-3b-trimmed-global-extent-必须可逆地-reshard-为固定-local-shape） 拥有；该 VAE patch 会影响所有复用 Wan autoencoder 的 pipeline，不应只在本家族内修。^[PR #6062]

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 双专家 boundary 合同、DMD2 sanitizer、变体矩阵 | [[wan2-2-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- `wan2_2_ti2v.yaml`：TI2V-5B 单卡默认（A14B MoE 变体自行加 TP）; `vae_use_tiling: true` 常开;不 pin checkpoint。TI2V 与纯 T2V 的区分**只在运行期**由 `model_index.json` 的 `expand_timesteps` 决定,不是不同类。
- 双专家（A14B）自动检测:本地有 `transformer_2/` 或 model_index 有其条目; `boundary_ratio` **一值两用**——既按时间步切换专家（T2V/TI2V 与 I2V 缺省都是 0.875,回退时告警）,又控制部分加载（1.0 只装 transformer_2,0.0 只装 transformer)——省显存开关,评审时别当普通超参改。
- S2V 无捆绑 deploy YAML（flow_shift 3.0 只在代码里）——部署设置 pin 上无文档。
- distilled LoRA 只在 `Wan22Pipeline` 与 `Wan22I2VPipeline` 显式接入；双专家按位置把 high/low-noise 两个具体文件分别融合进 `transformer`/`transformer_2`；DMD2 子类继承该能力，VACE/S2V 不继承。双专家即使因 boundary 少加载一个 target 仍要求两个 path，未加载者 warning 后跳过；
  - 精确门禁见 [[rules-lora-1]]（DIFF-2n；源锚点 #diff-2n-wan-多文件必须逐位置绑定-architecture-declared-transformer）。

### 什么时候查这里

- 审查任一 Wan 变体的专家切换、DMD2 合同或 VAE patch 副作用;本家族同时有 unit、e2e、accuracy（视频相似度对 diffusers CP 基线）与 dfx 套件,改共享 diffusion 设施时适合当回归锚。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/wan2-2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Wan 2.2（七个 registry 架构名:T2V/I2V/VACE/S2V/DMD2×2/FastVideo DMD）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-02
- 来源（sources）：PR #2783；PR #4820；vllm_omni/diffusion/lora/loader.py；vllm_omni/diffusion/models/wan2_2/；vllm_omni/deploy/wan2_2_ti2v.yaml；vllm_omni/diffusion/models/dmd2/mixin.py；tests/diffusion/lora/test_loader.py
