---
name: feature-depth-video-coarse-scan-frame-extraction
description: analyze_video.py 实现深读：slug 候选视频选择、CLI 与互斥批次旗标、choose_fps 自适应、ffprobe/ffmpeg 与 PIL 依赖、审核 JPEG 字节预算失败、SKILL.md 手工流程（未执行）
metadata:
  scope: 收 analyze_video.py 的实现细节（slug 路径、CLI、抽帧频率、外部依赖、字节预算取舍、手工验证记载），来源另含 SKILL.md；功能概览归 feature-video-coarse-scan-frame-extraction
---
# 视频粗扫抽帧与审核批次门控（analyze_video.py）：实现深读

## 现状

- [[feature-video-coarse-scan-frame-extraction]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **slug 路径：候选视频须为非 .part 文件，全不合格时回退首候选并仅在不存在时退出** main 中 slug 目标按 video.mp4、downloads/video.mp4、downloads/video.* 顺序取第一个 is_file() 且非 .part 的候选；无合格候选时回退 candidates[0]，仅当该回退路径不存在时 sys.exit(1)。
  - 随后依次 probe_duration、choose_fps、extract_frames、build_review_frames，帧数为 0 则 sys.exit(1)，最后写入 current_batch=1 状态并打印第 1 批路径。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L343–L354](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L343-L354),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L359–L396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L359-L396)
- **CLI：target 必填，--title/--slug 可选，两个互斥批次旗标触发提前返回** 接受位置参数 target（视频 URL 或 slug）；--title 默认 None（L356 回退为 slug 的下划线替换为空格）；--slug 默认 None（URL 时经 common.resolve_work_slug_for_url 解析）。--current-review-batch 与 --next-review-batch 属互斥组，命中任一即调用 _show_or_advance_review_batch 并 return，不下载不抽帧。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L307–L323](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L307-L323),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L325–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L325-L330),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L356–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L356-L356)
- **抽帧频率默认由时长自适应：min(BASE_FPS, MAX_FRAMES/时长)** choose_fps 无可调参数，短视频用 BASE_FPS，长视频按 MAX_FRAMES/时长降频，使总帧数逼近上限；main 中 fps=choose_fps(duration)，interval=1/fps 仅用于日志展示。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L86–L88](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L86-L88),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L359–L371](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L359-L371)
- **ffprobe/ffmpeg 经 subprocess 调用，PIL 用于审核 JPEG 编码** probe_duration/extract_frames 以 subprocess.run 调用外部 ffprobe/ffmpeg（timeout=common.OPERATION_TIMEOUT_SECONDS），FileNotFoundError 与非零返回码被转换为 RuntimeError（超时异常未被捕获）；_encode_review_jpeg 用 PIL Image 打开、转 RGB、LANCZOS 缩放并保存 JPEG。二者不在系统内时脚本无法工作。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L52–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L52-L74),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L127–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L127-L146),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L152–L175](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L152-L175)
- **审核 JPEG 代理压低模型读取体积，代价是每帧/每批字节预算超限即 RuntimeError 失败** 设计推断（非作者历史意图）：
- 受益：原始 frames/ PNG 保持不变，审核走 480x270/384x216、quality 50-60 的 JPEG 代理以控制读取体积（推断自常量与注释）。成本：_encode_review_jpeg 四次尝试后仍超过 REVIEW_MAX_BYTES=45*1024 会抛 RuntimeError，build_review_frames 在任一批字节总和超过 REVIEW_BATCH_MAX_BYTES=225*1024 时抛 RuntimeError，阻断完成。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L43–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L43-L49),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L152–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L152-L188),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L203–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L203-L210)
- **SKILL.md 记载的手动验证流程（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 给出具体命令：analyze_video.py "<video_url_or_slug>" --title "..."，并说明短视频 0.5fps、长视频均匀覆盖且总帧数最多 90、每批最多 5 帧，首次只打印第 1 批审核帧路径，完成后追加 --next-review-batch 获取下一批。这是文档记载的手动流程，本次未执行；未提供覆盖该脚本的自动化测试证据。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/SKILL.md:L144–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/SKILL.md#L144-L152)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-video-coarse-scan-frame-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L86-L88
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L359-L371
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L307-L323
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L325-L330
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L356-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L52-L74
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L127-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L152-L175
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L43-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L152-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L203-L210
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L343-L354
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L359-L396
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/SKILL.md:L144-L152
- 源页字段（feature）：video-coarse-scan-frame-extraction
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py
