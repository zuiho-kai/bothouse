# CosyVoice 本机试听

日期：2026-10-16。关联 Issue #15（本机试听）及 #4（语音验收）。当前是独立实验，尚未替换生产 Qwen3-TTS。

目标：先让用户听到同文样本，再决定是否值得接入；不以模型宣传或自动转写证明自然度。输入是公开示例音色与固定中文文本，输出是本地 WAV、耗时和可复现脚本，反馈来自真人试听与文字回查。

## 已核对条件

- 本机 Apple M3 Pro、18 GiB统一内存，macOS 26.6.2，Python 3.12.13。
- CosyVoice使用社区MLX移植 mlx-audio-plus，源码提交4c9ec6a8489e790b5ba8964ab1f1d63150476f9f；不是上游PyTorch/CUDA运行性能。
- 转换模型：mlx-community/Fun-CosyVoice3-0.5B-2512-fp16，revision 18ccb7fbd7246e8cd3420d02f5dd28595cc0fcd9。
- S3TokenizerV3 revision b143914b3e912278104824da706edc9c2d317c4e；参考音频来自CosyVoice提交074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc的公开示例。
- 现有Qwen环境不包含CosyVoice3实现；本次新建独立环境，运行代码和模型下载固定版本。代码入口为[实验说明](../experiments/cosyvoice/README.md)。

## 测量方法

两种后端顺序执行，非流式合成；短句重复一次以分开首次运行和预热后结果。每条文字、WAV和指标由同一脚本保存。不同模型的示例音色与采样策略不同，不是固定说话人的严格模型实验。加载时间包含Python导入、权重及辅助组件初始化；TTS生成时间不包含语音识别、聊天模型或播放。

| 文本 | Qwen生成 / 音频时长（秒） | CosyVoice生成 / 音频时长（秒） |
| --- | --- | --- |
| 短句首次 | 7.131 / 6.800 | 5.827 / 4.640 |
| 短句预热后 | 3.232 / 6.800 | 3.140 / 4.640 |
| 安慰句 | 2.928 / 6.720 | 4.618 / 7.160 |
| 中英混合句 | 3.815 / 7.360 | 6.194 / 6.480 |

Qwen为本机既有Qwen3-TTS 0.6B 8bit、uncle_fu，加载4.397秒，24kHz输出；进程记录MLX累计峰值5,688,155,293字节，maxrss 868,843,520字节。两项不是同一口径，不能相加；MLX峰值跨本轮各句累计。声音样本和原始指标位于本实验worktree的.local/cosyvoice/qwen-samples/。

CosyVoice加载25.010秒，24kHz输出；MLX累计峰值4,038,288,154字节，maxrss 912,605,184字节。/usr/bin/time -l另报进程peak memory footprint：CosyVoice 10,723,872,176字节，Qwen 7,475,530,080字节。不能因为MLX分配较小就宣称总内存更低。各自只有一次进程、三种文本，加载包含首次依赖导入；不是统计稳定的性能排名。

CosyVoice结果在.local/cosyvoice/cosy-samples/：00-short.wav为首次，01-short.wav为预热后，02-conversation.wav为安慰句，03-mixed.wav为中英混合句；同目录metrics.json保存逐句指标。真实运行日志cosy-run-with-torch.log、qwen-run.log保留完整计时；sources.json保存模型与参考音频校验值。

## 失败与限制

- 生产mlx-audio 0.5.9缺少CosyVoice3；另建环境，使用固定社区源码。旧版PyPI依赖解析有冲突，源码安装与uv pip check通过。没有升级生产环境。
- HuggingFace默认XET和单连接下载过慢；改用可续传HTTP分段下载，复用已有前缀并按完整LFS SHA256校验。下载时间不是推理性能；分片和失败日志保留于.local/cosyvoice/。
- 本机识别回查最初因旧环境缺少ffmpeg、soundfile失败；改用标准库wave读取PCM并传16kHz数组。Qwen三条回查基本还原正文，专名“青柠”存在同音转写，不能凭识别证明发音或自然度合格。
- CosyVoice首次完整加载失败：其cosyvoice2包入口提前导入转换工具，间接需要未声明的torch；仅在实验环境补装torch 2.14.1并固定到依赖清单，未改第三方推理源码。失败见cosy-run.log，补齐后完整生成退出0。
- CosyVoice本机回查：安慰句和中英混合句内容匹配；短句“青柠七号”被识别成“请您7号”。这可能涉及发音或识别歧义，需要真人听短句，不能写成所有文本验收通过。回查均在本机进行。
- 两套音频均验证为非空、有限数值、24kHz PCM16，依赖检查和脚本语法检查通过。未测流式首包、打断、真人麦克风或聊天端到端延迟；没有修改生产语音配置、重启服务或发送Discord消息。

## 当前决定与下一步

已交付可播放的CosyVoice3样本和同文Qwen对照，完成Issue #15的独立试听范围；主观自然度由用户试听，Issue #4仍需真实语音验收。当前保持生产Qwen3-TTS。

本机这组样本没有显示CosyVoice整体速度优势，先判断音色是否明显更自然，再决定是否接入。若用户认可，再做独立适配器与常驻加载/流式的专项验证；本次未实现这些能力。跨入口记忆与多人语音均不由本次TTS实验证明。

## 来源

- 上游模型与示例：[QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice/tree/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc)。
- 社区运行实现：[mlx-audio-plus](https://github.com/DePasqualeOrg/mlx-audio-plus/tree/4c9ec6a8489e790b5ba8964ab1f1d63150476f9f)。
- 转换权重：[模型卡](https://huggingface.co/mlx-community/Fun-CosyVoice3-0.5B-2512-fp16/tree/18ccb7fbd7246e8cd3420d02f5dd28595cc0fcd9)。
