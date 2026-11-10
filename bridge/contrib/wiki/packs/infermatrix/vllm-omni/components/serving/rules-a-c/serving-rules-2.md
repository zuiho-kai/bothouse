---
name: serving-rules-2
description: "Serving 规则第 2 部分，SERV-1a–1k：streaming 首 chunk 前校验、format 单一来源、media decoder 参数、mixed media capability gate、长视频 float→uint8 转换（PR #5732 实测 1201.15→529.47 ms）、TTS word timestamps、voice default 占位、I2V resize ownership、image reference 重定向、speech usage headers、非流式 MP4 编码 dispatcher"
metadata:
  scope: 只收 SERV-1a 至 SERV-1k 的 streaming-format 与 media-ingress 规则；代码地图归 serving-rules-1，metrics 与 artifact readiness 归 serving-rules-3，speech 采样率与 resample（SERV-9b–9d）归 rules-speech-output、SERV-9a 归 rules-engine-lifecycle-2
---
# Serving 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[serving-rules-1]]；第 3 部分 [[serving-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/serving/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-07-20；updated: 2026-10-23
- [SERV-1a] 所有可预判错误在第一个 streaming chunk 前返回
  - 触发：SSE/streaming 接口新增 format、audio、output modality 或 extra-body 参数。
  - 强制：在 streaming/non-streaming 分叉以及发送首个 chunk 前完成合同校验，非法请求返回结构化 4xx。
  - 验收：坏格式在两种模式都得到相同 4xx；测试证明坏请求没有产生任何 SSE chunk，合法请求仍按协议完成。 ^[PR #4718]
- [SERV-1b] 支持格式、默认值和 backend capability 只有一个来源
  - 触发：protocol enum、validator、encoder/backend 分别维护 format/default 列表。
  - 强制：protocol、校验器和执行层引用同一 canonical 常量，并以实际 backend capability 为上限。
  - 验收：每个公开格式都有 encoder smoke；移除格式只改 canonical owner，协议和校验测试同步反映。 ^[PR #4718]
- [SERV-1c] media decoder 参数只在真实入口可达时对外声明
  - 触发：替换 video/image reference decoder、接入 loader registry、新增 backend/fps/frame-selection 参数或改变坏媒体错误。
  - 强制：只有请求/配置入口能把值传到 loader 时才声明参数可配；否则在最近 loader 调用处固定实际值。frame sampling 只消费真正传入的 target metadata；decoder 返回零帧必须继续映射为 `InvalidInputReferenceError`，不能因共享 loader 只记 warning 就返回空 `VideoFrames`。
  - 验收：同一合成视频分别断言 first-N 与 last-N 顺序、数量和 fps；覆盖非法 `keep`、非正 `max_frames`、无效字节与 loader 零帧，且真实 Qwen multimodal/video 请求仍通过公开入口。 ^[PR #5085]
- [SERV-1d] mixed media 必须 capability-gated，request 错误在解码前限界
  - 触发：共享 video serving 接受 mixed image/video/audio、typed URL/data URL 或 multipart upload。
  - 强制：unknown model 默认无 mixed capability；只有 model metadata 明示支持才允许 image+video。multipart 大小/格式等可在字节边界判定的约束必须 bounded-read 并在解码前拒绝；pipeline 的 request-facing validation 使用可跨 worker 保留 client metadata 的错误类型，统一映射为 400。
  - 验收：支持模型的 mixed request 成功，unknown/不支持模型在 engine 前返回 400；multipart oversize/bad format 与 pipeline count/shape 错误保持同一 client-error 合同。typed URL/data URL 是否同样 bounded 必须单独证明；本 pin 的 helper 仍完整读取。
    - 模型专有 allowlist、temp-file 与 input matrix 见 [[minimax-h3-rules-1]]、[[minimax-h3-rules-2]]、[[minimax-h3-rules-3]]（MiniMax H3 rules）。 ^[PR #5752]
- [SERV-1e] 长视频转换只保留必要的全视频 buffer，并逐帧保持旧语义
  - 触发：修改 video output 的 normalize、float→uint8、RGBA strip、mux 或 fragmented encode。
  - 强制：预分配最终 contiguous uint8 video，逐帧 clip/scale/round 写入，禁止先 `np.stack` 全量 float frames 再产生全量转换临时量；这只消除额外副本，原 normalized float frames、最终 uint8 buffer 及上游 device→host 分配仍存在，不能称为 O(1) memory。
  - 强制：所有 frame shape 相同；只有 rank-3 HWC 且 C=4 才去 alpha，二维 width=4 灰度不能截断。mixed float dtype 先用 `np.result_type` 得到 common dtype，再逐帧计算，以保持 legacy stack 的 promotion/rounding/checksum；不得原地改输入。仅当输入是 `np.ndarray`、`uint8`、rank-4 FHWC、last dim=3 且 C-contiguous 时，fast branch identity-return；
    - 其他输入一律回既有 conversion。^[PR #6824]
  - 验收：回归测试禁止 float path 调用 `np.stack`，并覆盖 input immutability、RGBA、width-4 grayscale、mixed float16/float32 与 exact uint8 output。性能证据必须分开报告 conversion 和未改动的 MP4 encode：PR #5732 的可复现实验仅绑定 209×1344×768 float32 RGB、24 FPS、ultrafast、fresh process、3 次 median/RSS 10 ms；
    - conversion 1201.15→529.47 ms、conversion+MP4 1808.96→1235.26 ms、peak RSS 8.874→4.141 GiB、above-resident 5.393→0.660 GiB，两个 hashes 相同。PR body 的 362-frame 与 4×MI300X E2E 是另一组观察，不能混合或泛化。另须断言 exact eligible ndarray 返回同一对象，并以 dtype/rank/channel/contiguity controls 证明其他输入仍转换。^[PR #5732] ^[PR #6824]
- [SERV-1f] TTS word timestamps 必须按 transport capability 显式门禁和传输
  - 触发：公开 `word_timestamps`、forced-aligner CLI/config，或修改 HTTP non-stream、SSE 和 WebSocket speech transport。
  - 强制：服务启动时统一记录 aligner capability；无 aligner 时 `word_timestamps=true` 明确返回 400。HTTP non-stream 将短 JSON 时间戳放入 `X-Word-Timestamps`，超过 4096 bytes 用可检测的 `X-Word-Timestamps-Omitted`；WebSocket 仅在 `stream_audio=true` 且 PCM 合同满足时，在每句音频结束后发送 trailing timestamps frame。
  - 验收：覆盖 non-stream、HTTP streaming、WebSocket、无/有 aligner、短/超限 alignment 和多句音频；分别断言 400、header/frame 内容、超限标记，以及音频在时间戳缺失或超限时仍按合同返回。^[PR #4795]
- [SERV-1g] TTS voice 输入、占位 default 与可用 speaker 必须闭环
  - 触发：修改 OpenAI speech 的 `voice` 输入校验、VoiceID 归一化、可用 voice 列表、上传 speaker 或无 speaker 模型的默认 voice 语义。
  - 强制：协议层同时接受字符串和包含 `id` 的 VoiceID 对象，并在 serving 校验前归一化为小写名称；可用 voice 列表必须统一包含内置 speaker、上传 speaker 和 `default` 占位项。无实际 `default` speaker 时，`default` 请求必须被接受并转换为后端忽略的无 voice 请求；存在同名真实 speaker 时必须优先使用真实 speaker；其他非法名称返回结构化 400。
  - 验收：覆盖无上传 speaker 时的字符串和 `{\"id\": ...}` 请求、未知 voice 的 400、上传前后 `default` 与新增 speaker 的列表和语音请求，以及注册并删除同名 `default` 后占位行为恢复；另需验证同名上传 voice 的实际使用，而不只断言请求成功。 ^[PR #5878]
- [SERV-1h] I2V resize ownership 必须按 checkpoint version 解析
  - 触发：在线视频 API 处理 I2V reference image，且 pipeline 的预处理可能随 checkpoint version 改变。
  - 强制：serving 从 active diffusion `od_config` 取得 `model_class_name`、`model` 和 `revision`，通过 model_extras resolver 判断 resize ownership；只有 LTX-2.5 保留 source geometry 交给 pipeline，LTX-2/2.3 继续在 serving 侧 resize，随后由 pipeline 执行其版本化 conditioning。
  - 验收：用 2、2.3、2.5 checkpoint metadata、Full/Distilled class、pinned revision 和 off-aspect image 覆盖 HTTP I2V，断言 legacy resize、2.5 source geometry、CRF 委托及最终尺寸各自符合合同。^[PR #6070]
- [SERV-1i] image reference 重定向必须遵循媒体 URL 策略
  - 触发：`decode_image_url` 处理 HTTP(S) `image_reference.image_url`，或修改媒体 URL 重定向策略与下载错误映射。
  - 强制：读取 vLLM 的 `envs.VLLM_MEDIA_URL_ALLOW_REDIRECTS` 并传给 HTTPX 的 `follow_redirects`；策略关闭时在收到 3xx 后拒绝请求且不得请求重定向目标；最终非成功 HTTP 状态与网络/请求失败必须分别映射；data URL 继续走本地解码路径。
  - 验收：用确定性的 HTTPX transport 覆盖允许重定向并请求原路径和目标路径、禁用重定向且目标未被请求并在错误中指出 `VLLM_MEDIA_URL_ALLOW_REDIRECTS`、最终 404 与连接失败的错误区分，以及 data URL 不创建 HTTP client；再通过公开 `/v1/videos` image reference 回归验证解码图像进入 engine。该验证不覆盖未修改的 video/audio reference 或 image-edit fetcher。 ^[PR #6122]
- [SERV-1j] 非流式 speech raw-audio 响应通过 headers 暴露 usage
  - 触发：修改 `/v1/audio/speech` 非流式 raw-audio 响应、speech usage 计算或 usage headers，或需要对齐 streaming/batch 的 token 统计语义。
  - 强制：非流式 raw-audio 响应必须复用 `build_speech_usage` 生成的 `SpeechTokenUsage`，在 usage 可用且服务非 diffusion mode 时发送 `X-VLLM-OMNI-INPUT-TOKENS`、`X-VLLM-OMNI-OUTPUT-TOKENS`、`X-VLLM-OMNI-TOTAL-TOKENS`、`X-VLLM-OMNI-INPUT-TEXT-TOKENS` 和 `X-VLLM-OMNI-INPUT-AUDIO-TOKENS`；
    - input 使用 text 与 ICL audio tokens，output 使用生成的 codec/audio tokens，raw audio body 保持不变。
  - 验收：测试非流式请求返回 `200`、raw audio body 未改变且五个 headers 的值与 `SpeechTokenUsage` 精确一致；覆盖 usage 不可用时不生成 headers，并回归 streaming 与 batch 的 usage 语义及 diffusion-mode 的无 headers 行为。^[PR #4499]
- [SERV-1k] 非流式 MP4 编码必须按运行时能力自动选择并保留回退语义
  - 触发：修改非流式 MP4 视频响应的 normalize、frame layout/dtype 判断、mux、raw/base64 输出或 fallback 行为。
  - 强制：公共 dispatcher 先完成一次帧准备和形状校验。共同 direct 条件是所有帧具有相同的正 HWC 形状、3/4 通道和支持的 common dtype（`uint8`、bool 或浮点）。C-contiguous RGB channel view 可直接写入 PyAV GBR planar 帧；strided RGB planes 仅可由 server-owned、`max_workers > 1` 的 converter 接受，并必须复制到其 owned scratch/PyAV planes，保持相同量化语义。
    - 没有 converter 或 `max_workers == 1` 时，strided planes 必须在打开 PyAV container 前以稳定 reason `non_contiguous_rgb_planes` 选择 `legacy_fallback`。raw MP4 和 base64 共用该 dispatcher，不提供 CLI、模型声明或请求级编码策略；流式 fMP4 保持原路径。
  - 强制：converter 的 scratch 是每个 worker thread 的实例本地存储；`iter_frames()` 按 FIFO 产生帧，并且一次调用最多保留 `2 * min(frame_count, max_workers)` 个 pending futures。无论 mux 成功还是抛错，调用方都必须关闭 iterator 以 cancel remaining futures；
    - server `finally` 关闭 video handler，handler shutdown 必须幂等并以 `wait=True, cancel_futures=True` 关闭 executor。日志报告 effective frame-conversion workers（legacy 为 0）。
  - 验收：覆盖无 converter、1 worker、8 workers 的 interleaved routing，及 channel-first-backed direct、非法 shape/dtype fallback、RGB contiguity、GBR plane 与 padded stride、FIFO、future bound、iterator close 后 cancel、reused executor 幂等 shutdown、direct failure 不重试；音频存在时 serving resolver 才以 24 kHz 为缺省。
    - 固定输入下有无音频的 parallel-interleaved/legacy MP4 必须 byte-identical 并通过 ffprobe/完整 FFmpeg decode，raw/base64 传同一 persistent converter，streaming 行为不变。^[PR #6288] ^[PR #6499] ^[PR #6776]

## 决策与踩坑

- [SERV-1a] 禁止：先发送文本成功 chunk，再在 audio/encoder 分支发现参数非法并静默结束；客户端会看到 HTTP 成功但缺失后半段输出。
- [SERV-1b] 禁止：把 backend 不支持的格式列为合法值，再靠中途 fallback；不同文件各复制列表。
- [SERV-1c] 禁止：不得留下没有 caller 传入的 backend/fps 形参或死分支；不得因 registry 存在多 backend 就宣称 vLLM-Omni 已支持运行时选择；不得丢失替换前的非空帧 fail-safe。
- [SERV-1d] 禁止：删除旧互斥 guard 后让所有 diffusion 模型继承 mixed input；用 unbounded `read()` 后再检查；让 plain `ValueError` 穿过 stage worker 变成 500。
- [SERV-1f] 禁止：无 aligner 时静默返回 200 音频；让 `stream=true` 的 HTTP 路径伪装支持该字段；把长 header 静默丢弃；以 in-process sidecar 或离线示例替代 pipeline stage 的真实输出。
- [SERV-1g] 禁止：要求没有可用 speaker 的模型提供一个实际存在的 voice 名称；让 voice 列表遗漏 `default` 或上传 speaker；把 `default` 占位值传入后端作为真实 speaker；仅支持字符串而拒绝合法 VoiceID 对象。
- [SERV-1h] 禁止：以共享 `LTX2Pipeline` class 全局开启 preserve-image-size；按请求目标尺寸或路径名猜版本；跳过 revision；未经版本化回归就让 online 与 legacy offline I2V framing 政策改变。
- [SERV-1i] 禁止：硬编码或绕过媒体重定向策略；策略关闭时仍跟随可能跨主机的重定向；把 HTTP 状态错误与连接失败混为同一诊断；为 data URL 创建 HTTP client。
- [SERV-1j] 禁止：把 usage JSON 塞入 raw-audio body；用原始 stage prefill 长度替代共享 usage 语义；在 streaming headers 已发送后补发尚未确定的最终 totals；宣称 diffusion-mode 路径必然提供这些 headers。
- [SERV-1k] 禁止：为能力探测再次 normalize/copy 视频；在 direct mux 开始后因异常重试 legacy；把非法形状或不支持 dtype 静默送入 planar path；不得把 async route 仍同步执行 mux/base64 或单请求 pending 上限说成全请求 nonblocking、全局并发上限、普遍模型/process/performance 改进。共享 pool 只在一个 API process 内限制 conversion threads；多 process 仍各自拥有 pool。
