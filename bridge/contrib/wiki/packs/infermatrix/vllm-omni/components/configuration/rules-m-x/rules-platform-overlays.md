---
name: rules-platform-overlays
description: "规则 PLAT-1a：deploy YAML platforms overlay 的平台能力按合并后的全部 stage 配置核对（devices 与 TP、parallel_config、backend、显存、eager/capture），XPU 多卡切分、FlashInfer 替换与 Fish top-p eager 随所属 stage 生效，支持声明需可运行入口证据（PR #8409）"
metadata:
  scope: 只收 platform overlay 最终配置合同一条规则（PLAT-1a）；XPU overlay 的 stage 级 enforce_eager pin 归 rules-xpu-eager-pins，最终展开配置为准的通用规则（CONF-3a）归 configuration-rules-3
---
# 部署 platform overlay 的最终配置合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-platform-overlays.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8409
- 置信度（confidence）：high
- [PLAT-1a] 平台能力由合并后的全部 stage 配置与验证共同决定
  - 触发：修改 deploy YAML 的 platforms overlay 或 supported-model 平台标记。
  - 强制：按 platform 合并最终 stage 后核对 devices 数量与 TP、parallel_config、backend、各 stage 显存、eager/capture 与模型输入限制。XPU profile 的多卡切分、FlashInfer 替换及 Fish top-p eager 等约束随所属 stage 生效；支持声明需对应可运行入口的证据。
  - 验收：验证 overlay 选择和最终 stage args，覆盖设备/TP 与 backend 不匹配；实际运行证据绑定具体硬件、checkpoint、head 和入口。 ^[PR #8409]

## 决策与踩坑

- [PLAT-1a] 禁止：从 stock YAML 或单字段推出平台可用；把该 PR 未改动模型说成已验证无需 overlay，或把 YAML 存在当作硬件运行通过。
