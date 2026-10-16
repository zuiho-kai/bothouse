# CosyVoice 本机试听实验

关联 Issue #15 / #4。只生成本地合成音频，不接入桥接、Discord、共享记忆或生产语音服务。当前实现用于 Apple Silicon / Python 3.12；它不是新的生产 TTS 后端。

## 安装与下载

从仓库根目录执行：

~~~sh
uv venv .local/cosyvoice/env --python 3.12
uv pip install --python .local/cosyvoice/env/bin/python -r experiments/cosyvoice/requirements.lock
python3 experiments/cosyvoice/prepare.py .local/cosyvoice
~~~

使用社区 mlx-audio-plus 的固定源码提交，运行 CosyVoice3 FP16 转换权重。模型和语音 tokenizer 的固定 revision 写在 prepare.py 中；下载按仓库元数据核验大小与校验值。大文件分段续传，保留分片和失败记录，不自动清理目录。首次运行需要联网下载，下载完成后合成强制离线。

参考音频是 CosyVoice 上游固定提交的公开 zero_shot_prompt.wav 示例，文字为“希望你以后能够做的比我还好呦。”，不是用户录音。来源和文件校验值保存在 .local/cosyvoice/sources.json。只能据此评估这个示例音色，不能假称已确定产品角色声音。

## 生成试听

~~~sh
.local/cosyvoice/env/bin/python experiments/cosyvoice/benchmark.py \
  --backend cosyvoice \
  --model .local/cosyvoice/tts \
  --tokenizer .local/cosyvoice/tokenizer \
  --reference .local/cosyvoice/reference.wav \
  --output .local/cosyvoice/cosy-samples
~~~

默认生成短句两次（首次及预热后）、安慰句、中英混合句。每个 WAV 同时记录生成耗时、首个完整输出段时间、音频时长、MLX峰值分配和进程maxrss。当前未启用流式，首段时间不代表聊天首字或可打断体验。Mac的maxrss单位为字节；MLX分配与RSS不是同一指标，不相加冒充总内存。

重复实验需指定新的输出目录，避免覆盖旧音频。只测短句可加 --cases short。模型加载和生成都在独立进程，不能把首次加载时间说成每次回答延迟。

Qwen对照使用相同脚本、相同文本，在原Qwen依赖环境中执行；显式提供本地模型位置，不读取生产配置：

~~~sh
/path/to/qwen-env/bin/python experiments/cosyvoice/benchmark.py \
  --backend qwen --model /path/to/qwen-model \
  --speaker uncle_fu --output .local/cosyvoice/qwen-samples
~~~

两个后端的示例音色不同；对比的是各自当前可用的体验，不是固定同一说话人的严格模型对照。真人自然度结论需试听，不能由识别回查或自动化测试替代。

固定随机种子不保证跨版本或跨后端逐样本一致。社区 CosyVoice 的 temperature 参数被实现忽略，实际使用其默认采样策略；Qwen 使用 temperature=0.7。加载计时包含导入与初始化，首轮合成还可能包含内核预热，不能把两者当成稳定服务延迟。

## 离线加载边界

社区版默认会自行下载 S3TokenizerV3。实验脚本按固定提交的类接口显式载入本地 tokenizer，再交给原推理路径；不改第三方源码。还会检查说话人编码器权重已经加载，禁止零向量回退冒充有效音色。这里用到社区版私有接口，因此升级时必须重新核验，不直接复制为生产适配器。

结果和采用决定见 [试听记录](../../docs/COSYVOICE_TRIAL.md)。模型、依赖环境、音频和完整日志均留在 Git 忽略的 .local 下。
