---
name: tooling-rules
description: "OMNI-TOOL-1a 至 3a：ComfyUI video node 的 frame/references task 路由与 multipart 字段（PR #5756）、MiniMax H3 本地路径 partition lookup、离线 text-to-image 示例 NumPy 转 PIL 保存（PR #6031）、inductor divisibility 全局 runtime patch 的单调自熄证明（PR #5976）"
metadata:
  scope: 只收 apps 与 tooling 的 OMNI-TOOL 规则及 Direct 代码快速入口；目录职责分流归 tooling-overview，服务端 handler 归 serving 组件页
---
# Apps 与 tooling 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/tooling/rules.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni apps 与 tooling 规则；type: rule；tags: vllm-omni；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #5756；PR #5976；PR #6031；apps/ComfyUI-vLLM-Omni/comfyui_vllm_omni/nodes.py；apps/ComfyUI-vLLM-Omni/comfyui_vllm_omni/utils/api_client.py；apps/ComfyUI-vLLM-Omni/comfyui_vllm_omni/utils/models.py；apps/ComfyUI-vLLM-Omni/comfyui_vllm_omni/utils/types.py
  - examples/offline_inference/text_to_image/text_to_image.py；vllm_omni/patch.py；tests/diffusion/test_inductor_divisibility_patch.py；tests/e2e/features/comfyui/test_comfyui_integration.py；tests/examples/offline_inference/test_text_to_image.py
- 置信度（confidence）：high
- 只有 `OMNI-TOOL-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则 | 第一批源码 |
|---|---|---|
| ComfyUI video node、frame/reference、multipart payload | `OMNI-TOOL-1a` | `nodes.py` → `utils/types.py` → `utils/api_client.py` |
| ComfyUI model path、partition、params builder | `OMNI-TOOL-1b` | `utils/models.py` → `utils/api_client.py` → integration test |
| offline T2I NumPy output、PIL、artifact save | `OMNI-TOOL-2a` | `text_to_image.py::{_normalize_images_for_save,main}` → README example test |

### [OMNI-TOOL-1a] reference 输入状态与 multipart 字段必须一起验证

- 触发：修改 ComfyUI video node 的 `frame`、`references`、task 选择或上传字段。
- 强制：无输入路由到 `t2va`，仅 `frame` 路由到 `fl2va`，仅 `references` 路由到 `ref2va`，并在发请求前拒绝 frame/reference 同时存在。Ref2VA 只接受“一张图像 + 一段音频”或“一到两个纯视频”；不得把 video 与 image/audio reference 混用。
- payload：frame/image 使用 `input_reference`，audio 使用 JSON `audio_reference`，每段 video 分别追加一个 `input_references`；model task 必须通过 `extra_params` 到达参数 builder。
- 验收：公开 node 到 API client 的测试分别覆盖三条 task 分支、互斥/数量错误，以及最终 `multimodal_data` 和请求参数；只测 validator helper 不算端到端证据。 ^[PR #5756]

### [OMNI-TOOL-1b] model lookup 不得丢失本地路径中的 partition

- 触发：增加 model family、`/FL2VA` 或 `/Ref2VA` partition，或修改参数 builder dispatch。
- 强制：lookup 同时支持 Hub ID 和任意父目录下以 `MiniMax-H3/FL2VA|Ref2VA` 结尾的本地路径；归一化路径时必须保留 family/partition 后缀，不能只取 basename。builder 调用必须使用其 keyword-only `extra_params` 合同。
- MiniMax H3 的 `flow_shift` 保持顶层字段，`audio_flow_shift` 和 `task` 放在 `extra_params`；内部 `type` 只在 model dispatch 完成后移除。
- 验收：Hub ID、本地绝对路径及两个 partition 都命中同一 model spec，并断言 builder 收到正确 keyword 和最终字段层级。PR review 曾直接发现 basename lookup 与错误 builder keyword，因此这两项必须作为回归 fence。 ^[PR #5756]

### [OMNI-TOOL-2a] NumPy image 只在离线示例的 artifact 边界转为 PIL

- 触发：修改共享 text-to-image 示例的 output selection、fallback extraction、输出类型或最终 artifact 保存。
- 强制：示例先按既有优先级选择非空 `output.images`、`request_output.images`，否则调用共享 extractor；确认结果非空后，才逐个把直接 `np.ndarray` 元素经 Diffusers `numpy_to_pil` 转换并展平返回的 PIL list，既有非 ndarray 元素原样保留，随后才逐图 `.save()`。这是离线 artifact adapter，不改变 producer、production serving 或共享 `extract_images_from_outputs()` 合同；
  - 当前已证明的 NumPy producer 是 LingBot T2I 的非空 `list[np.ndarray]`。
- 验收：至少覆盖 `[0,1]` HWC float ndarray 转换后的可保存性、尺寸/mode，以及 PIL passthrough；mixed list、batched ndarray、非法 shape/dtype、bare ndarray 和 direct tensor 应作为明确回归矩阵。PR #6031 的单张 L20X 前后对照用 checksum 固定的 LingBot 1.3B revision，证明相同请求由保存处 `AttributeError` 变为 320×192 RGB PNG；
  - 它是有界的 LingBot E2E artifact 证据，不证明共享 utility、在线 serving 或其他 producer。目标提交没有新增 helper 自动化测试，README full-model case 也不能替代上述类型矩阵。^[PR #6031]

### [OMNI-TOOL-3a] 全局 runtime patch 必须是单调、可自熄的窄证明

- 触发：上游 torch/vLLM 升级后需要 monkey-patch 编译器、allocator 或其他进程级对象。
- 强制：先用 canonical probe 判断上游是否已具备能力；wrapper 只能增加经严格数学/类型条件证明安全的结果，其余全部委托原实现，并带幂等标记。当前 inductor divisibility 补丁只接受不超过 20 个符号的 polynomial，且 `cancel(numerator/denominator)` 必须得到整数系数 polynomial。
- 验收：覆盖原方法 True、可精确因式消除、非整系数/零分母/非 polynomial/符号上限、重复安装，以及“上游已能证明”时不替换方法。真实 FLUX FP8 smoke 另行验证图编译。^[PR #5976]

## 决策与踩坑

- [OMNI-TOOL-2a] 禁止：把非空 NumPy list 直接当作 PIL 保存；为修示例而全局强制 production output 为 PIL；把此 helper 推广为任意 array/tensor/object 的通用 coercion。bare ndarray 在现有 selection 的 truthiness 判断仍可能报 ambiguous truth value；direct tensor 与其他不支持 `.save()` 的对象会原样通过 normalization，仍可在保存处失败。
- [OMNI-TOOL-3a] 禁止：吞掉 lazy compile error 后长期静默 eager fallback；对 FloorDiv/ModularIndexing 或非 polynomial 猜测；补丁安装失败时改变原方法。
