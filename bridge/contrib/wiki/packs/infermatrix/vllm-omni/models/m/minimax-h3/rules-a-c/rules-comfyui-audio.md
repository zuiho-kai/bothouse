---
name: rules-comfyui-audio
description: "MiniMax-H3 ComfyUI audio_mode：VLLM-OMNI-PR9226-H3-AUDIO-LOCK，下拉默认 native 且默认值不进请求、非 native 值（lock_source）写入 extra_params，supplied-audio Music Video 模板的 Ref2VA 分镜与 Trim Audio Duration 总音轨合同（PR #9226）"
metadata:
  scope: 只收 ComfyUI audio_mode 与 supplied-audio MV 工作流规则；节点 schema 变更后重存 bundled 工作流归 rules-comfyui-workflow-schema，ComfyUI frontend 路由与 multipart 字段归 tooling-rules
---
# MiniMax-H3 ComfyUI audio_mode 与 supplied-audio MV 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-comfyui-audio.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-24；updated: 2026-10-24
- 来源（sources）：PR #9226
- [VLLM-OMNI-PR9226-H3-AUDIO-LOCK] ComfyUI H3 audio_mode 必须默认省略并绑定单一驱动音频
  - 触发：修改 `apps/ComfyUI-vLLM-Omni` 中 MiniMax-H3 Video Params 的 `audio_mode` 下拉、`_minimaxh3_params_builder` 的 extra_params 组装、Video References 的音频 reference 计数、H3 example workflow 模板或 supplied-audio Music Video workflow。
  - 强制：`audio_mode` 下拉默认 `native`；`_minimaxh3_params_builder` 的实现合同是 pop `audio_mode` 时缺省即 `native`，任何不等于 `native` 的值都写入 `extra_params`（当前下拉唯一非默认选项是 `lock_source`，但转发条件是“非 native”，不是“等于 lock_source”），因此默认值不进入请求，既有 graph 与请求 payload 保持不变。
    - `lock_source` 语义按本 PR shipped 文档：恰好的单一音频作为驱动音轨进入 target audio latent（crop/zero-pad 到 shot 时长并在采样期间保持固定），不计入 `<Audio N>` reference 计数；非恰好一个音频时的拒绝由 server 执行。向已发布节点新增 widget 后，所有 shipped H3 模板必须带新 widget 值（如 `"native"`）重存，因为 ComfyUI 按 position 恢复 widgets。
    - MV 模板中每个 shot 是 Ref2VA：共享 character/style image 作 `image_1`（`<Picture 1>`）、同一 track 的连续 124 帧 slice 作 `audio_1`；
    - Concatenate Video 的 `complete_audio` 不是直连整条原始 track，而是同一 supplied track 经 Trim Audio Duration 从相同起点裁剪到全部 shot 总时长（模板 3 shot 即 3 × 5.1667 s = 15.5 s）的输出，用于替换各 shot 生成的音频（要求 ComfyUI >= v0.36.0）。
  - 验收：builder/integration 测试断言默认 `native` 被省略、非 `native` 值进入 `extra_params` 并出现在发往 server 的请求中；
    - `test_h3_music_video_workflow.py` 结构测试须保持每个 shot 均为 Ref2VA、由同一 track 的连续 124 帧（5.1667 s @ 24 fps，满足 H3 `17k+5` 帧约束）slice 驱动、shot 时长与 sampling/H3 设置跨 shot 共享，并断言 Concatenate Video 的 `complete_audio` 输入来自裁剪 supplied track 的 Trim Audio Duration 节点、其时长等于全部 shot 的总时长，
    - 而不是各 shot 生成的音频（CI markers `core_model and cpu`）。未来 PR 若声称 ComfyUI 客户端实现了 exactly-one-audio 拒绝，必须附带客户端拒绝测试，不得以 forwarding 测试充当。^[PR #9226]

## 决策与踩坑

- [VLLM-OMNI-PR9226-H3-AUDIO-LOCK] 禁止：让默认值改变既有请求 payload；把 `lock_source` 驱动音频当作普通 `<Audio 1>` reference tag 计数；新增 widget 却不重存使用该节点的 shipped 模板；在 shot 边界重新生成音频、留下音轨接缝，或以各 shot 生成的音频拼接充当最终音轨。
  - 不得把“客户端在请求发出前 fail-fast 拒绝非恰好一个音频”写成已存在的行为或验收项：所示 diff 未建立客户端校验，shipped 文档写明由 server 拒绝，`test_video_references.py` 的新增只检查 forwarding。
