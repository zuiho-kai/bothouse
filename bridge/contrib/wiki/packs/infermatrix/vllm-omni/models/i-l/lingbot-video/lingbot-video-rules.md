---
name: lingbot-video-rules
description: "LingBot-Video 规则 LBV-1a 至 LBV-2b（PR #5311 #5976 #6049 #7037）：output modality 与单图 cardinality 决定 T2I / T2V / TI2V、一次 normalization 的帧数 4n+1 与尺寸来源优先级及 preset 方向风险、TI2V 的 VLM 与 VAE 共享几何对齐与 posterior sample RNG 顺序、modality key 与 HTTP 400 跨 image / video formatter 保留；含 Direct 代码快速入口"
metadata:
  scope: 只收 LBV-1a、LBV-1b、LBV-2a、LBV-2b 的触发、强制、禁止与验收；入口摘要与当前公开范围归 lingbot-video-overview
---
# LingBot-Video 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/lingbot-video/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-08-10；updated: 2026-10-06
- 来源（sources）：vllm_omni/diffusion/models/lingbot_video/request_utils.py；vllm_omni/diffusion/models/lingbot_video/image_condition.py；vllm_omni/diffusion/models/lingbot_video/pipeline_lingbot_video.py；vllm_omni/entrypoints/openai/serving_video.py；vllm_omni/model_extras/lingbot_video.py
  - vllm_omni/model_extras/registry.py；examples/offline_inference/text_to_image/text_to_image.py；examples/offline_inference/image_to_video/image_to_video.py；tests/diffusion/models/lingbot_video/test_request_utils.py；tests/diffusion/models/lingbot_video/test_image_condition.py
  - tests/diffusion/models/lingbot_video/test_pipeline_lingbot_video.py；tests/entrypoints/openai_api/test_image_server.py；tests/entrypoints/openai_api/test_video_server.py；PR #5311；PR #5976；PR #6049；Issue #5883；PR #7037
- 只有 `LBV-数字字母` 是可审计规则 ID。共享请求传播与错误一致性先应用 [[rules-request-input-1]]（SERV-4c/4d；源锚点 #serv-4c-入口接受必须闭环到每个生产消费者），本页只写 LingBot 专有语义。

### Direct 代码快速入口

| 信号 | 规则 | 第一批源码 |
|---|---|---|
| modalities、caption、negative prompt、size、duration、frames | LBV-1a/1b | `request_utils.py::{resolve_lingbot_mode,normalize_lingbot_request}` |
| reference image、center crop、VLM/VAE、clean prefix、RNG | LBV-2a | `image_condition.py::{prepare_ti2v_image_condition,apply_clean_prefix}` → pipeline denoise loop |
| image/video output key、HTTP 400、n>1 | LBV-2b | `pipeline_lingbot_video.py::{forward,get_lingbot_video_post_process_func}` |

### [LBV-1a] mode 由 output modality 与单图 cardinality 唯一决定

- 触发：修改 modalities、prompt envelope、reference media 或 T2I/T2V/TI2V prompt builder。
- 强制：`modalities=["image"]` 且无输入图是 T2I；`["video"]` 无图是 T2V、恰好一图是 TI2V。image output 不接收参考图，TI2V 不接收多图；reference video/audio 均拒绝。modality 缺失且无图仅作 legacy T2V fallback，并 `warning_once`；有图却缺 modality 必须拒绝，不能猜 I2V。shared task example 必须写显式 modality；
  - `model_extras` 不再复制 LingBot generic T2I/TI2V builder，单图 cardinality 与其余 validation 由 pipeline normalization 拥有。prompt 可是 plain string 或 mapping。mapping 的 `caption` 为标量字符串时保持原文，为结构时做紧凑 JSON；没有 `caption` 时去除 runtime fields 后把其余结构序列化。空 caption、空结构或不可序列化值 fail closed。
- 验收：三种 mode、缺失 modality fallback/拒绝、多图与异类 media、plain/structured/empty caption 都覆盖；`negative_prompt` 优先级为 sampling `extra_args` 显式 key > prompt envelope 非 `None` 值 > mode default。显式空字符串与省略不同，禁止用 truthiness 合并。

### [LBV-1b] 一次 normalization 产出 pipeline 的完整 consumer view

- 触发：修改 frame/fps/duration、尺寸、steps/guidance/shift/output type 或来源优先级。
- 强制：帧数来源为 model-specific `extra_args/prompt` 的 `num_frames` > sampling 中非 sentinel 的 `num_frames` > `seconds|duration × fps` > default。视频帧向上对齐 causal VAE 的 `4n+1`；T2I 固定 1 帧且拒绝 duration 或非 1 显式帧数。`seconds` 与 `duration` 同时出现拒绝；显式 `num_frames` 胜过 duration。
  - fps/steps 必须正整数，guidance 非负有限数，shift 正有限数，output type 只允许 `pt|np|latent`。尺寸来源互斥：`width+height`、`size=WIDTHxHEIGHT`、或成对 `resolution+ratio` 三选一，结果必须是 16 的倍数。解析先对每一种尺寸字段做 source merge：online `/v1/videos` 的 `sampling.extra_args` 优先于 prompt mapping，offline prompt mapping 仅作 fallback；
  - 合并后再按表示优先级选择 `width/height` > `size` > `resolution+ratio`。两条入口必须复用同一个 resolver，不能把某来源整体覆盖另一来源而丢掉未冲突字段。
- 验收：覆盖全部来源与冲突、`4n+1` 边界、非法数值和 output type，以及 in-tree preset map。当前 preset 还有方向一致性风险：表声明 value 顺序为 `(height,width)`，但例如 `16:9` 映射 `(832,480)`，经 resolver 返回标准 `(width,height)=(480,832)`，实际是 portrait；`9:16` 同理反向。现有测试冻结了该值，不能证明 ratio 名与标准 width:height 语义一致；
  - 修复需覆盖全 preset、direct resolver、离线 builder 和两个在线 endpoint 的最终尺寸。sampling sentinel 的不对称也必须先统一 omitted 表示再修改。另须用同字段冲突值断言 extra_args 胜过 prompt，并用跨表示冲突冻结 merge 后的 `width/height` > `size` > `resolution+ratio`，同时保留只有 prompt 的 offline control。
  - Canonical envelope 的共享 ownership 与 identity/custom builder 测试见 [[rules-image-task-envelope]]（EXEC-6a；源锚点 #exec-6a-shared-image-example-先建-canonical-envelopemodel-extra-只做特化变换）。^[PR #5976] ^[PR #6049]

### [LBV-2a] TI2V 的 VLM 与 VAE 必须共享一次几何对齐及同一 RNG 顺序

- 触发：修改 TI2V preprocessing、VLM/VAE conditioning、VAE posterior、generator 或 denoise loop。
- 强制：reference image 先做保持宽高比的 resize + center crop，得到目标 H×W；同一 aligned tensor 同时派生 Qwen3-VL image input 与 VAE clean latent，禁止两条 conditioning path 各自 resize。VAE posterior 必须用请求 generator 的 `latent_dist.sample(generator)`，并发生在初始 noise latent 生成前；
  - 这是官方 TI2V parity 的 RNG 合同，换成 `mode()` 会同时改变 clean prefix 与后续噪声流。clean temporal prefix 在初始 latents 写入一次，并在**每个** scheduler step 后重新写回；sequential CFG、batched CFG 与 CFG-disabled 都必须覆盖。shape 要求 `[B,C,T,H,W]` 且 batch/channel/spatial 匹配，prefix T 不能超过总 T。
- 验收：直接断言 center crop、两条 conditioning path 复用同一几何、RNG 消耗顺序与三种 CFG 路径的逐 step reinjection。在线 `/v1/videos` 的共享入口目前会先把 reference image 拉伸到请求尺寸，模型内部收到后已丢失原始宽高比，因而上述 center-crop 不能恢复原图几何；这是跟踪中的 serving 边界，不得把 pipeline 单测的 aspect-preserving 结果宣称为在线端到端行为。

### [LBV-2b] modality key 与 client error 必须跨 image/video formatter 保留

- 触发：修改 pipeline return、postprocess、image/video formatter、batch/output count 或异常映射。
- 强制：pipeline 返回 `DiffusionOutput(output={"image": value})` 或 `{ "video": value }`；postprocess 必须要求二者恰好一个、按 output type 转换而不丢 key。decoded keyed image/video 的 `[0,1]` tensor 必须转为 NumPy FP32 路径，避免 video API 将 floating tensor 当作 `[-1,1]` 再归一化；即使 keyed `output_type=pt` 也如此。
  - bare pt tensor 与 image/video latent 保持既有 tensor 行为。T2I decode 必须恰好一帧并移除 frame 轴；latent output 保持 tensor。`num_outputs_per_prompt != 1` 与 normalization 的 TypeError/ValueError 在 pipeline `forward` 统一转为 `OmniClientError`，使 image/video 路径都返回 HTTP 400；不要只在 image API 加不对称 guard。
  - 内部 `_generate` 的 image/mode 防御检查不是公开入口校验的替代品。
- 验收：同时覆盖 formatter 的 image/video key、T2I 单帧 shape、TI2V input cardinality、最终 image size limit、frame-count precedence 和 n>1 的 400；FP32/BF16 与 omitted/pt/np 的黑、中灰、白须穿过真实 API frame conversion 后保持原 `[0,1]` 值，不能只测全白；bare pt 与 latent identity control 保持。^[PR #7037]
  - PR 所报 H200 单次耗时、峰值显存与 bitwise parity 缺少本知识树可复跑的命令/产物，不能作为性能或精度 gate。

## 决策与踩坑

- [LBV-1a] 禁止：依据是否带图猜 output modality；用 truthiness 合并 negative prompt；让 video/audio reference 或多图进入 pipeline。
- [LBV-1b] 禁止：在 serving 再造 dimension resolver/model-specific width/height alias；把 sampling `num_frames=1` 当成可靠的显式单帧 video——它当前是 image API 的“省略”哨兵，因此会落到默认 81 帧，而 model prompt/extra 的 1 仍是显式值。
- [LBV-2a] 禁止：换用 posterior `mode()`；只在 denoise 前写 prefix；让 VLM/VAE 分别 resize；把内部 `_generate(cfg_parallel_group=...)` 参数当成生产 serving 已暴露 CFG parallel 的证据。
- [LBV-2b] 禁止：postprocess 丢掉 modality key；让 n>1 成为 500；以内部防御性 ValueError 代替公开 request normalization。
