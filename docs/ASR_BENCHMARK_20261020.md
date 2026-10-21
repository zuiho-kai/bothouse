# ASR 离线计时（2026-10-20）

本机合成语音复现了接近5秒的首次识别：**4.807秒**；同句热态3次为 **0.579–0.599秒**。
历史那次5.2秒没有分段数据，不能直接断言它就是冷启动；这里证明冷启动足以产生相似延迟。

## 可复现方法

工具：[benchmark_asr.py](../companion/tools/benchmark_asr.py)。本机 say 生成 Tingting 单声道16kHz PCM WAV，不播放、不录音、不调用生产服务、不读取私人对话。
同一个新Python进程使用现有本地 whisper-large-v3-turbo 模型；Speech.transcribe_timed 走生产代码。全部Go/Python重回归完成后运行，其他生产进程仍在运行，未控制整个系统负载。

~~~sh
HF_HUB_OFFLINE=1 /path/to/voice-python companion/tools/benchmark_asr.py \
  --model /path/to/local/whisper-large-v3-turbo/snapshot \
  --output /tmp/conest-asr-benchmark.json
~~~

模型快照：a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb。
冷启动指新进程、空的MLX模型缓存；不代表系统文件缓存也冷。

| 输入 | 时长 | 首次总耗时 | 热态默认（3次） | 关闭时间戳（热态3次） |
|---|---:|---:|---|---|
| 你能听到我说话吗？ | 1.747秒 | 4807ms | 599 / 579 / 584ms | 580 / 566 / 590ms |
| 请告诉我现在的工作进度。只需要简短回答，不要执行任何任务。 | 6.321秒 | 未测 | 685 / 679 / 674ms | 642 / 653 / 658ms |

第一轮分解：校验1ms、队列0ms、setup 1423ms、inference 3382ms。
setup 是首次导入MLX Whisper及本地模型路径检查；inference 同时包含惰性模型加载、首次GPU工作与真正识别，**这3382ms不能全部算作解码**。
热态各轮校验0–1ms、队列0ms、setup 0ms。两个句子的汉字内容均正确，标点有变化。

## 决策

- 首要验证进程/模型缓存是否复用，而非更换模型。晨间启用 #132 计时后，比较第一次与后续真实麦克风请求的 setup/inference/queue。
- 可把预热安排在服务启动、设备就绪之前，但需单独评估启动耗时和常驻内存；本轮不改启动行为，也不重启8796。
- 关闭时间戳的中位数收益：短句约5ms，长句约26ms。样本只有两句，收益小，**不修改生产解码参数**。
- 此测量不包含设备上传、VAD等待、模型回答、TTS、播放，不代表端到端语音延迟。多个请求争锁、噪声与温度回退仍需真实计时。

合成WAV SHA256：短句21253c5dc319eddfde5116e5dfd071037990d3aef74a1bd6e0c26126d22179f0；长句a042feab31bb894f07dbaadbfe4660d0074a139ceed1a0042e3d5b776cbbf4d7。
原始结果在操作者本机 /tmp/conest-asr-20261020.json；正式交付摘要在本文件，不含真实录音或凭据。
