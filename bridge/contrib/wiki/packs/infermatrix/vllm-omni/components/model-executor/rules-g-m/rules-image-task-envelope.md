---
name: rules-image-task-envelope
description: "image task envelope 合同 EXEC-6a 至 EXEC-6d：shared T2I/I2V example 先建 canonical envelope 而 model_extras registry 只做特化变换（PR #6049）、model_extras 声明 extra_body_params 与 output_tensor_range（PR #6076）、shared offline video consumer 接受 video 与 legacy image 标签（PR #6747）、model_extras resolver 承载按 model 与 revision 的版本策略（LTX 2 / 2.3 / 2.5，PR #6070）"
metadata:
  scope: 只收 image-task-envelope 审查组 EXEC-6a、EXEC-6b、EXEC-6d、EXEC-6c；触发条件与其余审查组的代码路由归 model-executor-rules-1，跨 stage 合同归 rules-bridge-batch-1、rules-bridge-batch-2，执行流归 model-executor-architecture
---
# image task envelope 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-image-task-envelope.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #6049；PR #6076；PR #6747；vllm_omni/model_extras/；PR #6070；vllm_omni/model_extras/registry.py；PR #5614；PR #6353；examples/offline_inference/text_to_video/text_to_video.py；examples/offline_inference/image_to_video/image_to_video.py
  - tests/examples/offline_inference/test_image_task_prompts.py
- 置信度（confidence）：high
- `image-task-envelope` 审查组的 `EXEC-6a`–`EXEC-6d`：shared image/video example 的 canonical envelope、输出 consumer 与 `model_extras` 的模型专有参数声明。触发条件与其余审查组见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor 共享规则） 的 Direct 代码快速入口。
- [EXEC-6a] shared image example 先建 canonical envelope，model-extra 只做特化变换
  - 触发：修改 shared T2I/I2V example、`model_extras` prompt registry 或模型 prompt builder。
  - 强制：task runner 先构造完整 canonical dict：T2I 含 `prompt`、`modalities=["image"]`；I2V 另含 `modalities=["video"]` 与原样 `multi_modal_data`。只有 `negative_prompt is not None` 才写 key，因而显式空字符串必须保留。registry 接收该 dict；无 model-specific builder 时 identity-return，有 builder 时只翻译模型 token/template/mm kwargs。
    - 公共 online serving handler 不参与此离线 seam。
  - 验收：canonical builder 覆盖 omitted/empty/value negative prompt 与 PIL media identity；registry 覆盖 Bagel、Ming、VACE custom path及 unknown identity path；Cosmos3/LingBot pipeline tests继续拥有模型专属 validation。^[PR #6049]
- [EXEC-6b] model_extras 必须声明模型专有参数与输出张量范围
  - 触发：新增或修改 `model_extras` 中模型专有请求参数、输出张量范围，或共享视频导出对不同 pipeline 输出合同的处理时。
  - 强制：按解析后的 `model_class_name` 在 registry 中声明 `extra_body_params` 与 `output_tensor_range`，通过公开 accessor 提供；消费者按整个视频的声明合同统一转换浮点张量，未声明模型保持 `negative_one_to_one` 默认行为。
  - 验收：registry 测试断言目标模型的 extra-body 参数和 `zero_to_one` 范围、普通 pipeline 的默认范围；覆盖单帧与 list-valued 视频的明确范围、混合正负值的统一转换，以及最终视频导出结果。 ^[PR #6076]
- [EXEC-6d] shared offline video consumer 必须接受语义 video 与 legacy image 标签
  - 触发：修改 shared T2V/I2V offline example 的 `OmniRequestOutput.final_output_type` 校验或视频帧消费。
  - 强制：consumer 接受语义 `video` 和兼容旧 pipeline 的 `image`；继续从历史 `images` 字段取得视频帧，并对其他输出类型抛出明确错误。
  - 验收：text-to-video 与 image-to-video 都覆盖 `video`、`image` 通过及 `audio` 拒绝；这些测试只证明 consumer contract，不证明帧生成、后处理或编码行为。^[PR #6747]
- 相关执行流见 [[model-executor-architecture]]（model-executor architecture）；跨 stage 合同见 [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（bridge/batch 规则）。
- [EXEC-6c] model_extras resolver 必须承载模型专有版本策略
  - 触发：`model_extras` 增加模型版本相关的 request、transformer-config 或 media-processing resolver。
  - 强制：按解析后的 `model_class_name` 在 registry 声明 resolver；公开 accessor 必须把真实 `model` 与 `revision` 传给 model-owned hook；共享 config/serving consumer 只调用 accessor，unknown model 保持安全默认值。
  - 验收：覆盖 arbitrary local path、2/2.3/2.5 metadata、Full/distilled pipeline class、unknown class 和 pinned revision；断言 extra-body 声明、transformer subfolder 与 reference-image policy 都经 registry accessor 到达真实 consumer。^[PR #6070]

## 决策与踩坑

- [EXEC-6a] 禁止：pipeline 已负责 validation/normalization 时复制 generic builder；让 registry 从零重建 task modality；用 truthiness 丢空 negative prompt；为每个模型复制 Python example。
- [EXEC-6b] 禁止：把模型专有选项散落到共享 runner 的通用参数或绕过 registry；按每帧当前最小值推断范围；把已是 `[0, 1]` 的模型输出再次按 `[-1, 1]` 映射。
- [EXEC-6d] 禁止：将 `images` frame carrier 改写为生成器、formatter、post-process 或 encoder 的输出类型合同；不得因兼容 `image` 而静默接收 `audio` 等无关 modality。
- [EXEC-6c] 禁止：在共享 serving/data 代码中写 LTX class/version 分支；按 repository basename 猜版本；用 class 名代替 checkpoint metadata；丢弃 pinned revision 或把共享 `LTX2Pipeline` 的策略无条件应用于 2、2.3、2.5。
