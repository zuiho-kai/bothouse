---
name: z-image-rules
description: "Z-Image TeaCache 校准合同：ZIMAGE-1a（系数只用于 Z-Image-Turbo 已校准 checkpoint 与 input relative L1 0.024–0.336 域）与 PR #3283 在线服务只按已验证配置声明（RTX 5880 Ada、fp8 峰值与时延）"
metadata:
  scope: 只收 ZIMAGE-1a 与 VLLM-OMNI-PR3283-ZIMAGE-SERVING 两条规则及快速入口表；Z-Image 的 pipeline 结构说明归 z-image-overview
---
# Z-Image TeaCache 校准合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/z-image/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-25
- 来源（sources）：PR #8408；PR #3283
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| Z-Image TeaCache coefficient、threshold、校准域或 cache hook | ZIMAGE-1a | `vllm_omni/diffusion/cache/teacache/config.py` → `coefficient_estimator.py` → `tests/diffusion/cache/test_teacache_config.py` |

### [ZIMAGE-1a] TeaCache 系数只用于已校准 checkpoint 与输入域

- 触发：修改 Z-Image TeaCache polynomial、threshold、adapter registry 或校准 hook。
- 强制：使用 Z-Image-Turbo 自身拟合系数，不借用 Qwen-Image 系数；现有拟合测量域为 input relative L1 0.024–0.336，threshold 默认 0.2。同 pipeline 类的其他 checkpoint 不自动获得校准保证。DataCollectionHook 初始化时解析并校验 extractor，未知模型在 forward 前失败。
- 验收：测试系数与 Qwen 不同、默认 config/threshold 和 adapter 注册；更换 checkpoint/输入域/threshold 时重做同 workload 的质量与命中率校准，记录域外风险及 hardware/head。 ^[PR #8408]

### [VLLM-OMNI-PR3283-ZIMAGE-SERVING] Z-Image-Turbo 在线服务只按已验证配置声明，加速收益不得外推

- 触发：修改 Z-Image-Turbo 的 serving/recipe 文档、`--omni`、`--quantization`、`--cache-backend` 相关默认值或说明，或 `/v1/images/generations`、`/v1/images/edits` 的行为声明。
- 强制：以已验证面为基准——1x RTX 5880 Ada 48GB（CUDA cu130 栈、vLLM 0.19.0）上 `vllm serve --omni` 在线图像生成与图像编辑均验证通过，`--omni` 必需；未量化峰值 24987 MB，`--quantization fp8` 在全部测试组合把峰值压到约 17.9–19.8 GB，是主要时延杠杆（生成 ~9500ms→~5600ms，编辑 ~34500ms→~8200ms）。
  - recipe 的示例请求显式设置 `num_inference_steps=9` 与 `guidance_scale=0`，recipe 声明 Z-Image-Turbo 为 distilled 少步数模型、默认不启用 CFG。
- 验收：改动服务默认值、量化或 cache 路径时，文档须附同硬件的峰值显存与时延表，并保留“单机参考值，随驱动/预热/尺寸/payload 变化”的限定；涉及步数或 CFG 默认行为的声明须能指回已验证的示例或代码默认值；新增尺寸或硬件先验证再声明；TeaCache 系数校准约束另见 ZIMAGE-1a。 ^[PR #3283]

## 决策与踩坑

- [ZIMAGE-1a] 禁止：把 polynomial 在测量域外的行为当作安全保证，或把 borrowed coefficients 的功能可跑说成可靠加速；从够步数模型的收益外推 distilled 短步数。
- [VLLM-OMNI-PR3283-ZIMAGE-SERVING] 禁止：把 `num_inference_steps=9` 说成引擎或模型的默认步数——它只是 recipe 示例请求显式传入的参数；把 `tea_cache`/`cache_dit` 当作少步数生成的提速项——9 步生成实测 ~9300ms，与基线 ~9500ms 近持平，量级收益只出现在编辑路径（~34500ms→~11000ms）；把仅 `1024x1024`、单机单驱动测得的参考值外推成其他尺寸/硬件的保证。
