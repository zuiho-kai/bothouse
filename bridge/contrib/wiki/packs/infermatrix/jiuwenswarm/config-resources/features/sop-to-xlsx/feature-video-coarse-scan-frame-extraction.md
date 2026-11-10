---
name: feature-video-coarse-scan-frame-extraction
description: analyze_video.py 视频粗扫抽帧与审核批次门控：命令行入口、URL/slug 输入、90 帧上限与审核 JPEG 代理预算、批次门控数据流、常量与运行时校验、超时未捕获
metadata:
  scope: 只收 analyze_video.py 的功能概览（入口、行为、取舍、流水线、常量、运行时校验与错误路径）；实现深读归 feature-depth-video-coarse-scan-frame-extraction
---
# analyze_video.py：视频粗扫抽帧与审核批次门控

## 现状

- **入口与调用方式**
- 命令行入口 `python analyze_video.py <video_url_or_slug> [--title] [--slug]`，target 为 http(s) URL 时下载视频，为 slug 时直接复用 `work/<slug>/video.mp4` 或 `downloads/video.*`。另有互斥的 `--current-review-batch` 与 `--next-review-batch`：前者仅重印当前审核批次，后者确认当前批次后前移游标，均跳过下载与抽帧。正常流程结束时初始化 `current_batch=1` 并打印第一批；
  - 抽帧为 0 帧或找不到视频时以 `sys.exit(1)` 退出。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L307–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L307-L330),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L349–L354](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L349-L354),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L371–L375](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L371-L375)
- **支持的行为**
- 支持两种输入（URL 自动经 `common.resolve_work_slug_for_url` 复用 stage01 的 slug 后经 `common.download_video` 下载；slug 本地查找已完成的视频文件，跳过 `.part`）。超限帧通过 `_uniformly_cap_frames` 均匀抽样至 90 帧并重命名为连续的 `frame_NNNN.png`。审核代理采用四档递降编码尝试（480x270/q60 → 480x270/q50 → 384x216/q60 → 384x216/q50），任一档满足 45KB 即返回，否则在最小档仍超限时抛错。
  - 依赖外部 ffmpeg/ffprobe 与 `common` 模块（work 路径、下载、slug 解析）。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L91–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L91-L117),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L152–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L152-L188),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L325–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L325-L348)
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 单阶段粗扫（不做细扫）换取流程简单与成本可控：用降低帧率 + 90 帧均匀上限覆盖全片，代价是长时间视频的时间分辨率下降。审核帧与原始帧分离（低分辨率有损 JPEG 代理仅供模型查看，PNG 原帧保留供最终 Skill 使用），并以每批 5 帧、字节预算（45KB/帧、225KB/批）约束模型单次上下文，代价是增加了状态文件与批次门控逻辑。门控是提示式的：输出文本明确要求 agent 只读所列文件、不扫目录，属约束引导而非硬性隔离（此句为推断，依据输出文案）。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L11–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L11-L18),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L265–L287](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L265-L287)
- **粗扫抽帧流水线与批次门控数据流**
- 正常流程按 probe_duration → choose_fps → extract_frames → build_review_frames 顺序执行：ffprobe 读取时长，按 min(0.5fps, 90/时长) 选定帧率，ffmpeg 抽帧并经 _uniformly_cap_frames 均匀截断到 90 帧重命名为 frame_NNNN.png；随后生成低分辨率 JPEG 审核代理帧，并把 {current_batch, batch_size, total_frames} 持久化到 work/<slug>/review_batch_state.json。
  - 批次门控为提示式：_print_review_batch 只打印当前批次（每批至多 5 帧，末批可更少）的精确文件路径并要求 agent 不扫描目录，--next-review-batch 经 _load_review_state 校验后前移游标。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L359–L396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L359-L396),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L120–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L120-L149),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L249–L304](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L249-L304)
- **常量、命令行参数与外部超时**
- 抽帧与审核预算为脚本内模块常量：BASE_FPS=0.5、MAX_FRAMES=90、BATCH_SIZE=5，审核代理 480x270 主档 / 384x216 回退档、JPEG 质量 60/50、单帧上限 45KB、每批上限 225KB。命令行提供 --title、--slug 以及互斥的 --current-review-batch/--next-review-batch。外部 ffmpeg/ffprobe 子进程的超时取自 common.OPERATION_TIMEOUT_SECONDS，不在本脚本内定义。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L38–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L38-L49),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L307–L323](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L307-L323),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L62–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L62-L69)
- **运行时校验与错误路径**
- 本脚本无独立测试入口；所示证据中的验证均为运行时自检。ffprobe 返回非零、无法解析的时长或非正时长均抛 RuntimeError（L73–L83）。审核帧编码与批次预算在构建时强制执行：单帧四档尝试后仍超 45KB 抛错（L183–L187），每批超过 225KB 抛错（L203–L210）。批次门控读取时校验状态文件存在与 batch_size 匹配（L230–L246），打印批次时复核文件数与状态一致且批次号在范围内（L249–L259）。主流程对找不到已完成视频（L352–L354）与抽帧为 0（L373–L375）以 sys.exit(1) 退出。
  - 注意：ffprobe/ffmpeg 子进程仅捕获 FileNotFoundError 并在 returncode 非零时抛 RuntimeError；超时（common.OPERATION_TIMEOUT_SECONDS，L62–L69、L134–L141）未被捕获，会以 subprocess.TimeoutExpired 向上传播。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L73–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L73-L83),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L178–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L178-L210),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L230–L259](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L230-L259),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L352–L375](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L352-L375)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-video-coarse-scan-frame-extraction.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L307-L330
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L349-L354
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L371-L375
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L91-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L152-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L325-L348
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L11-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L265-L287
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L359-L396
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L120-L149
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L249-L304
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L38-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L307-L323
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L62-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L73-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L178-L210
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L230-L259
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py:L352-L375
- 源页字段（feature）：video-coarse-scan-frame-extraction
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py
