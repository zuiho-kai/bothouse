---
name: rules-timeline-guides
description: "规则 VLLM-OMNI-PR8838-TIMELINE-GUIDES：/v1/videos 与 /v1/videos/sync 的 timeline_guides manifest 与 guide_files 上传——按 supports_timeline_guides 在读字节前拒绝、零基 upload_index 引用、8 条目 / 16 上传与分模态大小上限、request-scoped 临时文件全路径清理、经 multi_modal_data 的 timeline_guides 键传给 engine（PR #8838）"
metadata:
  scope: 只收 serving 层 timeline guides 的 capability 门禁、上传绑定与临时文件清理这一条规则；video 参考图像素上限（SERV-4r）与 multipart artifact 合同（SERV-4i2）归 rules-request-input-2
---
# 视频 timeline guides 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-timeline-guides.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-13；updated: 2026-10-13
- 来源（sources）：PR #8838
- [VLLM-OMNI-PR8838-TIMELINE-GUIDES] timeline guides 按 capability 前置拒绝、上传以索引绑定并全程清理临时文件
  - 触发：`/v1/videos` 与 `/v1/videos/sync` 新增或修改 `timeline_guides` manifest、`guide_files` 重复上传、`supports_timeline_guides` capability，或 `entrypoints/openai/video/generation/helpers.py` 中 guide 的解析、落盘与清理逻辑。
  - 强制：capability 唯一来源是 diffusion model metadata 的 `supports_timeline_guides`（当前仅 MiniMax H3 别名为真，Cosmos3 等为假）；不支持的模型必须在读取任何上传字节之前返回结构化 400。manifest 每项含 JSON 整数 `frame_index` 与 `image`/`video`/`audio` 至少一项，`image` 与 `video` 互斥，未知键拒绝；上传只能用零基 `upload_index` 引用，manifest 与校验都不得接受客户端路径。
    - 上限为 8 条目、16 个上传，每个上传必须被引用，同一上传可服务多个条目但只能属于单一模态；分模态大小/格式约束（image 30 MiB JPEG/PNG/WEBP/HEIC/HEIF、clip 50 MiB MP4/MOV、audio 15 MiB WAV/MP3/FLAC）必须在校验中强制。
  - 强制：图片在内存解码，clip/audio 写入 request-scoped 临时文件，并在成功、错误、取消和 async job 启动前缺失等所有退出路径删除。serving 层原样透传 `frame_index`（含负值，负值的 N+index 解析属模型侧），guides 以 `multi_modal_data["timeline_guides"]` 传给 engine，结构与离线 API（#8460）一致，不得写入 `sampling_params.extra_args`。
    - 协议负载保存在私有 `_timeline_guide_input`，不新增公共 `timeline_guides` 字段，使 WebSocket `session.start` 像对待其他未知键一样忽略该输入。
  - 验收：成功路径测试在 `/v1/videos` 与 `/v1/videos/sync` 两个端点参数化，断言 guides 按原顺序到达 `multi_modal_data["timeline_guides"]`（image 为解码对象且同上传复用得到同一实例，video/audio 为临时文件路径，`frame_index` 含负值原样保留）、`extra_args` 不含 `timeline_guides`，并等待临时文件在请求结束后消失；
    - 无 capability 模型返回 400（detail 说明不支持）以及 manifest 缺失、非法 JSON、空列表和错误类型等校验用例当前仅覆盖 `/v1/videos/sync`，不得据此宣称双端点的拒绝行为均已验证。模型侧打包与组合限制（clean conditions、FL2VA keyframes、`quality=lossless` 等）见 [[minimax-h3-rules-1]]、[[minimax-h3-rules-2]]、[[minimax-h3-rules-3]]（MiniMax H3 规则）。^[PR #8838]

## 决策与踩坑

- [VLLM-OMNI-PR8838-TIMELINE-GUIDES] 禁止：读取上传字节后才按模型拒绝；接受路径引用、未被引用的上传或跨模态复用同一上传；把 guide 媒体塞进公共协议字段或 `extra_args`；在任何退出路径泄漏 guide 临时文件。
