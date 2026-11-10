---
name: diffusion-rules-upstream-compat
description: "Diffusion upstream 兼容规则 DIFF-RELEASE-FP8-1a、DIFF-4k、4l、4q、4s：online FP8 用 DiffusionFp8Config、serialized checkpoint 用 upstream Fp8Config（PR #8459）；API shim 归单一共享 owner 且 accuracy 两侧同 attention backend、regional compile wrapper 保留 forward 签名（PR #5976）；LoRAConfig 从 vllm.config.lora 导入（PR #6287）；Triton 经 vllm.triton_utils 导入（PR #6273）"
metadata:
  scope: 只收 diffusion 侧随 vLLM/torch 上游 API 变化的兼容规则；system-runtime 审查组的 DIFF-4a 至 4h 归 rules-system-runtime-1，DIFF-4i 及之后归 rules-system-runtime-2
---
# Diffusion upstream 兼容规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-upstream-compat.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-10-06
- 来源（sources）：PR #8459；PR #5976；vllm_omni/diffusion/compile.py；vllm_omni/diffusion/layers/fused_moe.py；vllm_omni/diffusion/models/diffusers_adapter/pipeline_diffusers_adapter.py；vllm_omni/quantization/_copy_missing_attrs.py；tests/diffusion/test_compile.py；tests/e2e/accuracy/test_qwen_image.py
  - PR #6287；PR #6273
- 置信度（confidence）：high
- [DIFF-RELEASE-FP8-1a] online FP8 与 serialized checkpoint 必须由不同 config 接纳
  - 触发：升级 upstream quantization API、diffusion `fp8` factory 或 checkpoint config reconciliation。
  - 强制：未序列化 BF16/FP16 权重的既有 `fp8` 入口使用 `DiffusionFp8Config` 对接 native `OnlineQuantizationConfig`，保留 linear/MoE 的 per-tensor static weight spec 与 ignored layers；checkpoint 已 serialized 时使用 upstream `Fp8Config`，磁盘 metadata 可经现有 reconciliation 替换 online config。method 名仍为 `fp8`，不能因此混用 config。
  - 强制：online compatibility config 只接纳 dynamic activation；拒绝 serialized flag、block-wise weight size 与 store dtype。upstream online shorthand 经 canonical resolver 生成 `QuantizationConfigArgs`；显式 native args 保持原对象，无可用 args 时报错。
  - 验收：online/serialized 两路、ignored layers、显式 args identity、无 args 与非法 options；GPU 用真实 BF16 weights 执行 native online kernel，模型质量与不同 FP8 layout/HSDP 另按对应 owner 合同验证。^[PR #8459]
- [DIFF-4k] upstream API shim 与 accuracy backend 必须按能力而非名字对齐
  - 触发：vLLM/torch bump 删除或重命名 MoE/quant/platform API，或 kernel hub 没有当前 image build。
  - 强制：机械 shim 迁入 Omni 单一共享 owner（如 `copy_missing_attrs`、`is_interleaved`），全部 caller 同步；MoE 使用 live factory 名，XPU op priority 使用 live provider 名。accuracy comparison 两侧必须走同一 attention capability chain；hub backend 不可用时 server/reference 一起降到 SDPA/native。
  - 验收：import/调用者 census 无旧 symbol；shared helper 保留 tensor attrs；backend probe 对可用/不可用分支断言两侧匹配，阈值只按实际 backend 分支选择；quant quality 两臂都 eager。真实硬件 accuracy 仍是必要证据，单测不能证明质量门通过。^[PR #5976]
- [DIFF-4l] regional compile wrapper 必须保留被检查 callable 的签名
  - 触发：包装 regional-compiled `forward`，或升级会用 reflection 发现 DiT block 的 Cache-DiT。
  - 强制：保留参数名和 return annotation；编译 callable 必须仍能被 `inspect.signature` 识别为原 `forward` 合同。兼容修复若只剩签名透明性，compile failure 必须继续显式暴露。
  - 验收：打开/关闭 Cache-DiT 都能匹配目标 block；测试冻结参数名与 return annotation，并让真实 lazy compile error 失败而非静默降级。^[PR #5976]
- [DIFF-4q] 内部 diffusion LoRA 导入必须避开兼容包初始化
  - 触发：修改 diffusion LoRA 的 `LoRAConfig` 导入、ROCm 启动补丁或可能在 `vllm_omni` 初始化期间加载 diffusion registry 的依赖图。
  - 强制：内部 diffusion 模块必须从 canonical upstream 路径 `vllm.config.lora` 导入 `LoRAConfig`；`vllm_omni.config.lora` 仅保留为对外兼容 re-export，并避免在 diffusion 模块初始化期间触发 `vllm_omni.config.__init__`、pipeline registry 或尚未完成初始化的 diffusion 模块。
  - 验收：ROCm 启动/pytest collection 在 diffusion 模块完成初始化前不再出现 circular-import；断言两个导入路径解析为同一 `LoRAConfig` 类，并回归 LoRA manager/utils 的正常导入及 CUDA/XPU 初始化路径。^[PR #6287]
- [DIFF-4s] diffusion Triton kernel 必须通过 vLLM 兼容入口导入
  - 触发：修改 diffusion Triton kernel 或其第三方 Triton 导入路径。
  - 强制：diffusion 代码统一从 `vllm.triton_utils` 导入 `triton` 与 `tl`，并保持现有 kernel 装饰器和调用语义。
  - 验收：静态检查确认无直接 Triton 导入，并在支持的 CUDA 环境执行目标 kernel 的导入与定向回归；非 CUDA fallback 仍需独立验证。^[PR #6273]

## 决策与踩坑

- [DIFF-RELEASE-FP8-1a] 禁止：向新版 serialized-only `Fp8Config` 传 online 用法；为了构造成功静默忽略 activation/block/store 选项；把 native kernel smoke 当作量化音视频质量已合格。
- [DIFF-4k] 禁止：从已删除 upstream 私有 helper 导入；只让一侧 fallback；用 compile-vs-eager LPIPS 判断 quantization 质量，或因 fallback 放宽所有 backend 的 gate。
- [DIFF-4l] 禁止：用无签名的通用 `*args, **kwargs` wrapper；把已撤回的常驻 eager fallback 写成 active 行为；以进程能启动替代 Cache-DiT block discovery 验证。
- [DIFF-4q] 禁止：假设导入兼容包的子模块不会执行父包初始化；在 ROCm platform patch 已进入 diffusion registry 时重新引入该兼容导入；把此修复泛化为改变 `LoRAConfig` 类型或配置语义。
- [DIFF-4s] 禁止：直接从 `triton` 或 `triton.language` 导入，或把导入检查通过误认为真实 kernel 已完成跨平台验证。
