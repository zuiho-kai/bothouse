---
name: generation-and-support-rules
description: DOCGEN-1a 至 DOCGEN-1d：serving examples sidebar 的 shared task slug 白名单与 stale generated page 缺口、supported_models recipe 链接与硬件 checkmark 证据、Feature taxonomy 与 BitsAndBytes/GGUF/SVDQuant 边界、shared task example 不得带模型默认
metadata:
  scope: 只收生成文档 URL/navigation 与 supported-model recipe 证据的 DOCGEN 规则；docs 目录入口归 docs-overview，官方设计文档地图归 design-doc-map，repository skill 规则归 repository-skills，模型实际能力回 model/component owner
---
# Generated docs and supported-model evidence rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/generation-and-support-rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, docs；created: 2026-08-10；updated: 2026-09-04
- 来源（sources）：.claude/skills/quantization/references/modelopt-fp8.md；docs/.nav.yml；docs/mkdocs/hooks/generate_examples.py；docs/models/supported_models.md；docs/user_guide/examples/online_serving/diffusers_pipeline_adapter.md；examples/online_serving/diffusers_pipeline_adapter/README.md
  - examples/online_serving/text_to_image/；examples/online_serving/image_to_video/；recipes/README.md；tests/docs/test_generate_examples.py；PR #5969；PR #5987；PR #5998；PR #6045；PR #6049；PR #6074；PR #6162；docs/features/README.md；docs/design/index.md
  - docs/user_guide/diffusion/startup_and_loading.md；docs/user_guide/diffusion_features.md；docs/user_guide/quantization/overview.md；docs/user_guide/quantization/bitsandbytes.md；docs/user_guide/quantization/gguf.md；docs/user_guide/quantization/svdquant.md
- 只有 `DOCGEN-数字字母` 是可审计规则 ID。模型实际能力仍回 model/component owner；本页只拥有生成文档的 URL/navigation 与 supported-model recipe 证据边界。
- [DOCGEN-1a] Serving sidebar 只生成共享 task 入口
  - 触发：增删 serving example、修改 `GENERAL_EXAMPLE_SLUGS`/`is_general_example`、改变 `generate_examples.py` 的扫描/生成顺序，或手改 User Guide → Examples navigation。
  - 强制：`offline_inference` 与 `online_serving` 只有固定 shared-task slug 可生成页面并进入 nav：`image_to_image`、`image_to_video`、`speech_to_video`、`text_to_audio`、`text_to_image`、`text_to_speech`、`text_to_video`、`x_to_text`。过滤必须在 page write 与 nav update 之前执行；
    - model-specific serving source 继续留在 `examples/`，不能重新与 task 入口混排；若要从文档侧发现它，必须由相应 shared task page 显式链接，不能只依赖 source directory 存在。非 serving category 会全部通过 filter，仍按 category/stem 生成 `docs/user_guide/examples/<category>/<stem>.md`。^[PR #5987]
  - 强制：hook 重建 Examples 下的 generated categories，但保留不以 `user_guide/examples/` 开头的顶层 string item（当前 `examples/README.md`）；category 和 item 均按稳定顺序输出。checked-in `.nav.yml` 必须与这套 whitelist 同步，新增 shared task 要同时补 source、slug、shared page 内容与测试。
  - 验收：逐个 whitelist slug 验证 offline/online 中实际存在者会生成且进入 nav，model-specific serving slug 不生成/不入 nav且能从相应 shared page 到达，非 serving category 保持生成；再验证重复 nav rebuild、preserved string 与 source-derived URL。
    - target test 只用 synthetic `text_to_image`/`qwen3_omni` 检查 predicate 两端，没有执行 page generation、nav serialization、完整 whitelist、shared-page link coverage 或真实树 census。`x_to_video_audio` 曾是 DreamID-Omni 与 MagiHuman 唯一共用的 offline task；PR #6357 同时删除其 source、generated page、nav 项和 whitelist entry。
    - 不得恢复该 slug，除非新的共享 task source、页面、nav 和测试一起落地。^[PR #6357] ^[PR #5987]
  - **已知完整性缺口**
    - target 的 `.claude/skills/quantization/references/modelopt-fp8.md` 仍要求运行已删除的 `examples/quantization/check_modelopt_fp8_export.py`。target tests 不做 repository link census，不会发现这种悬空引用；完成清理需更新 skill reference 并增加真实路径存在性检查。
    - 被 filter 掉的 model-specific generated Markdown 仍作为 tracked file 留在 `docs/user_guide/examples/`，hook 既不刷新也不删除；quickstart、design 与 feature 文档仍有直接链接。因此当前链接可达不等于内容会随 source 更新。需要明确迁移链接到 shared task page，或给 stale generated pages 定义删除/刷新策略及 link-integrity test。
    - `diffusers_pipeline_adapter.md` 直接证明该边界：它已被 serving whitelist 排除却仍可访问并需手工修补。source README 位于 `examples/online_serving/diffusers_pipeline_adapter/`，其中 `../../../docs/user_guide/diffusion/attention_backends.md` 按 source base 正确；
      - 相同字面路径若复制到 `docs/user_guide/examples/online_serving/` 会解析成不存在的 `docs/docs/...`，rendered page 必须用 `../../diffusion/attention_backends.md` 或经过显式 absolute rewrite。不得假设 source-relative link 可原样搬到另一个输出目录。^[PR #5998]
    - 验收 tracked stale/generated page 时，link checker 必须分别以 source 与 rendered file 的目录为 base，并跑 clean strict MkDocs 覆盖不在 nav 的可达页面；只测试 generator predicate 或只检查 source README 不足。该修复报告 strict build 通过但未增加自动 link regression，因此后续手工同步仍可能再漂移。
      - attention backend 段落未改，不能把 link-only diff 当 Diffusers adapter runtime 新证据。
- [DOCGEN-1b] Recipe link 与硬件 checkmark 必须共享可审计证据
  - 触发：修改 `docs/models/supported_models.md` 的 Recipe 或 hardware 列、增加 recipe，或发布 `recipes.vllm.ai` 页面。
  - 强制：Recipe 列是 model row → deployment recipe 的直接映射；有已确认 published page 时优先链它，否则链 repository recipe，未审计 row 写 `—`。commands、参数和验证详情只由 recipe 文件拥有，supported-model table 不复制。只有已审计 recipe 明示的硬件才能据此改该 row 的 hardware checkmark；unlinked row 继续保留原 implementation-support metadata。
  - 验收：逐个 linked row 检查 model identity、published/repository fallback、目标存在性和 recipe 的显式硬件证据；未 linked rows 的硬件列不随本轮 audit 改动。#5969 审计的变化范围仅是 Qwen3-Omni、Qwen-Image、Qwen-Image-2512、Qwen3-TTS CustomVoice、Higgs Audio V3 TTS 的 NVIDIA，以及 MiniMax H3 的 NVIDIA+AMD；这不是其他 row 的平台支持 census。^[PR #5969]
- [DOCGEN-1c] Feature taxonomy 只拥有可发现性，不生成 support 事实
  - 触发：修改 Features nav/index、design taxonomy、compatibility matrix，或把内容迁到新 guide。
  - 强制：User Guide 按 Runtime and Stage Execution、cross-model Quantization、Diffusion Acceleration、Experimental 分组，Custom Pipeline/ComfyUI 归 Integrations；design 定义内部合同，user guide 定义启用/兼容入口，recipe 绑定模型/硬件。Communication 留在 Developer Guide；未稳定的 Pipeline Parallelism 可 direct-link 但不进入主导航。
    - 迁移必须让新页入 nav，并保留旧 heading anchor。
  - 验收：strict MkDocs + link/nav census；兼容表逐项回 live owner。HunyuanImage3/Helios step 边界分别是 grouped 仅 TORCH_SDPA、仅 `max_num_seqs=1`；HSDP 与 Ulysses/CFG 可组合但与 TP 不兼容；local layerwise offload 与 multi-device DLO 分表。docs-only build 不证明 runtime；
    - overview 移除 GGUF 只同步 core 导航归属，保留的 GGUF guide、OOT plugin 说明与实现/测试证据仍须独立核查。^[PR #6045] ^[PR #6074]
  - SVDQuant guide must say that it consumes an offline serialized NVFP4 checkpoint, enumerate the checkpoint tensor contract, and distinguish its SM103-compatible-kernel loading contract from real-kernel quality or performance validation.
    - Adding it to the Quantization nav does not establish a model matrix, another GPU target, or fused-kernel support.
    - The merged commit adds only the dedicated user guide/nav entry; the review request to update `docs/design/feature/quantization.md` and `docs/user_guide/quantization/overview.md` remains an unresolved thread, so those broader matrices cannot be treated as synchronized evidence. ^[PR #6162]
- [DOCGEN-1d] shared task example 不得把模型默认伪装成通用合同
  - 触发：修改 shared T2I/I2V README、Python client、Gradio 或 launch script。
  - 强制：名称与说明按 task 而非某个默认模型表述；通用 client 的 size、steps、CFG、seed 未显式提供时省略，让 server/model default 生效。模型专属 curl recipe 可保留，但必须标清范围。canonical task envelope 的代码 owner 见 [[rules-image-task-envelope]]（EXEC-6a；源锚点 #exec-6a-shared-image-example-先建-canonical-envelopemodel-extra-只做特化变换）。
  - 验收：README/CLI/UI/server script 名称一致；optional 字段省略与显式零/空分别测试；shell `bash -n`，canonical CPU tests，至少一个真实模型 task smoke。^[PR #6049]

## 决策与踩坑

- [DOCGEN-1a] 禁止：靠 `model_display_names.yml` 把 model-specific slug 留在 sidebar；它仍只负责被构造的 `Example` 标题校验，不覆盖 filter。不得恢复已删除的 quantization 特殊路由：target 已移除 `EXAMPLE_NAV_TARGETS`/Features → Quantization → Generated Examples；未来非 serving quantization source 会按通用 category 进入 Examples，除非重新设计明确合同。
- [DOCGEN-1b] 禁止：把 recipe 中仅用于 platform delta/config 的提及当成运行验证；因为另一个同架构 row 有 recipe 就传播硬件结论；把空 hardware cell 解读为已证明不支持；为避免外链而复制 recipe 命令到 supported-model table。
- [DOCGEN-1c] 禁止：从任一文档层或 nav presence 单独推出 production support；把 quantization 缩成 diffusion-only；把已迁到 OOT plugin 的 GGUF 重新包装成 core-owned 主导航 feature，或因它同时从主导航和 overview 消失就宣称 runtime/guide/tests 已删除；漏掉已有 core 实现、测试与 guide 的 BitsAndBytes。
  - BitsAndBytes 的 CUDA method presence 不等于所有 NVIDIA 型号或模型都已验证：当前 diffusion 明确验证范围只有 Z-Image-Turbo，其他 diffusion、Omni/TTS、多 stage 组合仍按未验证处理。
- [DOCGEN-1d] 禁止：在 shared client 默认发送 Qwen-specific CFG/尺寸/steps，或因脚本默认 model 是 Qwen 就把 UI 宣称为 Qwen-only；不得把 runner/pipeline synthetic smoke 写成 released-weight quality 证据。
