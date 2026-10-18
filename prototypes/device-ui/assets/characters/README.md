# 用户提供的角色动画素材

2026-10-18 累计导入15段原视频，另新增2段正方形裁切版（共17段）。15段原始视频字节保持不变，仅在仓库副本中按可见动作命名；下载目录原文件未改名。原文件名、SHA-256、尺寸、帧率与音轨数见 [manifest.json](manifest.json)。

## 命名与检查范围

- 角色目录沿用用户提供的 gpt、claude、deepseek，不改运行时 bot 绑定。
- 每段均匀抽取12帧，按观察到的主要动作命名；这是动作分类，不是逐帧或无缝循环验收，因此文件名不承诺 loop。
- 所有视频均有1条音轨，尚未试听或判断是否静音。接入界面时应禁用素材音轨，让实际TTS承担回答；原始归档没有转码或移除音轨；新增正方形版经过裁切重新编码，保留1条音轨。
- GPT两段宽屏素材动作相近，保留v1/v2；目前未从GPT这批抽帧确认专用说话动画。DeepSeek已补充用户指定的思考动画（带问号）。
- 思考视频带问号；不同视频背景、人物比例和边缘质量不完全一致。尚未进行466×466圆屏裁切、首尾衔接和设备性能验收。
- 本次只归档，未替换原型中的旧图集，未接入语音服务或固件。

## GPT正方形版（优先用于1:1预览）

从1280×720居中裁为720×720：左右各去掉280像素，不缩放；保留10秒时长、24fps和音轨。用macOS AVFoundation最高质量导出，逐段12帧目视检查头发、龙角和脸部未被新裁切截断；未做逐帧、无缝循环或圆屏验收。宽屏原片仍保留，转换参数与来源哈希见manifest。

- [正方形版本1](gpt/idle-blink-square-v1.mp4) · [抽帧预览](previews/gpt-idle-blink-square-v1.jpg)
- [正方形版本2](gpt/idle-blink-square-v2.mp4) · [抽帧预览](previews/gpt-idle-blink-square-v2.jpg)

放大检查可见微笑和口部变化；此前宽屏缩略图的“未见明显连续说话”仅是粗略分类，不作为状态映射验收。实际映射需观看视频确认。

## 原始素材目录

| 视频 | 动作观察 | 尺寸 / 时长 | 抽帧预览 |
| --- | --- | --- | --- |
| [claude/idle.mp4](claude/idle.mp4) | 闭嘴正视，轻微表情变化 | 720×720 / 4.04s | [12帧](previews/claude-idle.jpg) |
| [claude/happy.mp4](claude/happy.mp4) | 闭眼张嘴微笑后复位 | 720×720 / 4.04s | [12帧](previews/claude-happy.jpg) |
| [claude/listening-nod.mp4](claude/listening-nod.mp4) | 闭嘴低头点头后复位 | 720×720 / 4.04s | [12帧](previews/claude-listening-nod.jpg) |
| [claude/speaking.mp4](claude/speaking.mp4) | 多次张闭嘴 | 720×720 / 4.04s | [12帧](previews/claude-speaking.jpg) |
| [claude/thinking-question.mp4](claude/thinking-question.mp4) | 侧看歪头，画面出现问号；不符合此前无符号的生成要求 | 720×720 / 4.04s | [12帧](previews/claude-thinking-question.jpg) |
| [deepseek/happy.mp4](deepseek/happy.mp4) | 闭眼张嘴笑后复位 | 720×720 / 4.04s | [12帧](previews/deepseek-happy.jpg) |
| [deepseek/idle.mp4](deepseek/idle.mp4) | 闭嘴正视，轻微姿态变化 | 720×720 / 4.04s | [12帧](previews/deepseek-idle.jpg) |
| [deepseek/speaking.mp4](deepseek/speaking.mp4) | 多次张闭嘴，伴随头部变化 | 720×720 / 4.04s | [12帧](previews/deepseek-speaking.jpg) |
| [deepseek/listening-nod.mp4](deepseek/listening-nod.mp4) | 闭嘴低头点头后复位 | 720×720 / 4.04s | [12帧](previews/deepseek-listening-nod.jpg) |
| [deepseek/thinking-question.mp4](deepseek/thinking-question.mp4) | 用户指定思考；歪头侧看，头顶出现问号后复位 | 720×720 / 4.04s | [12帧](previews/deepseek-thinking-question.jpg) |
| [gpt/listening-nod.mp4](gpt/listening-nod.mp4) | 闭眼低头点头后复位 | 720×720 / 4.04s | [12帧](previews/gpt-listening-nod.jpg) |
| [gpt/thinking-question.mp4](gpt/thinking-question.mp4) | 歪头侧看，出现问号；不符合此前无符号的生成要求 | 720×720 / 4.04s | [12帧](previews/gpt-thinking-question.jpg) |
| [gpt/idle-blink-wide-v1.mp4](gpt/idle-blink-wide-v1.mp4) | 抽帧可见眨眼，未见明显连续说话；横屏两侧留白较多 | 1280×720 / 10.00s | [12帧](previews/gpt-idle-blink-wide-v1.jpg) |
| [gpt/idle-blink-wide-v2.mp4](gpt/idle-blink-wide-v2.mp4) | 抽帧可见眨眼，与版本1动作相近；保留两个来源 | 1280×720 / 10.00s | [12帧](previews/gpt-idle-blink-wide-v2.jpg) |
| [gpt/idle-blink-closeup.mp4](gpt/idle-blink-closeup.mp4) | 闭嘴眨眼；顶端发丝有裁切，边缘可见杂色，需复核 | 544×544 / 6.04s | [12帧](previews/gpt-idle-blink-closeup.jpg) |

## 来源与许可

素材由用户生成并提供，参考本项目此前采用的 fywdy / chatgpt-chibi-pets 角色。各文件的具体生成工具、版本和提示词没有完整记录；仅凭原文件名不认定生成服务。作为基于参考角色的衍生素材归档，保留原作者 fywdy 署名、美术 CC BY-NC 4.0 约束和[上游非官方声明](../../UPSTREAM-NOTICE.md)，不声称原创角色或官方授权。详见[素材来源](../../README.md#素材来源)。

本目录未包含生成母图。后续审核先查看视频与抽帧，再按 [素材规格](../../ASSET_BRIEF.md) 选择、裁切和验证；原视频保留作为可追溯来源。
