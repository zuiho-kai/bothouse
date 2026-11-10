---
name: accuracy-attribution
description: 精度失败先归因 runbook：golden 与硬件绑定（H100 vs H200，SSIM 0.964118，从 CI 工件收割 golden 与重基线政策）、whisper-small ASR 评分器 flake（改用 large-v3，async_chunk 阈值 0.65）、phase vocoder ≥2.0x 音质悬崖这一已知上游 bug
metadata:
  scope: 只收 vLLM-Omni 精度断言失败时的归因顺序与三类非回归原因（golden 硬件漂移、ASR grader、已知上游 phase vocoder 缺陷）的症状、诊断、修法、验证和禁止项；镜像/依赖/超时等环境坑归 ci-environment-gotchas-1 和 ci-environment-gotchas-2
---
# 精度失败先归因：硬件 golden / 评分器 / 已知上游 bug / 真回归

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/guides/accuracy-attribution.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-07-16；updated: 2026-07-16
- 来源（sources）：vllm-omni-rebase-agent@122a9468:agent/skills/fix-accuracy-golden-hardware-mismatch/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-tts-realtime-asr-accuracy-flake-whisper-small/SKILL.md
  - vllm-omni-rebase-agent@122a9468:agent/skills/fix-tts-speed-adjustment-phase-vocoder-quality/SKILL.md
- 精度断言失败时**先归因再动手**：依次排除 (a) golden 与硬件绑定、(b) 评分器（ASR grader）自身、(c) 已知上游 bug，都排除后才当模型回归调试。运营 runbook 以 rebase-agent 仓库为准，本页是知识树沉淀快照（2026-07-16，agent @122a9468；skills 工作树含未提交遥测更新，快照以工作树为准）。

### 1. golden 与硬件绑定（H100 vs H200 决定论差异）+ 重基线政策

- skill 元数据：`fix-accuracy-golden-hardware-mismatch`，modules=[model_executor, benchmarks]，status=active，run_count=1，2026-07-12。
- 症状：严格图像精度测试（SSIM≥0.97/PSNR≥30 对 committed golden）在 rebase 后 **确定性**失败——每次 run、且 online/offline 变体的测量值**完全相同**（例：builds 2674/2683 均为 0.964118/28.2469）；mean/p99 像素差门禁仍过；通常发生在 vLLM/kernel 版本 bump 后，**或 golden 曾在非 CI 硬件上重生成**。例：HunyuanImage3-DIT Accuracy Test。
- 诊断：测量值跨 run 恒等 → 输出是确定性的，这是**对 golden 的数值漂移**不是 flaky；像素差过而 SSIM/PSNR 挂 → 图是对的、golden 来自不同 kernel/硬件。H100 与 H200 在相同 SM90 kernel 上产出**稳定但不同**的结果（HunyuanImage3 实测相差 SSIM 0.9641）。**绝不能**因为两张图对第三张图的 SSIM 距离相等就断言两图相等（0.94899 ≈ 0.9490 谬误——曾浪费一次 golden 提交 d6353b24）。
- 修法（从 CI runner 自身收割 golden）：1) 让 CI job 成败都上传生成图（`.buildkite/test-nightly.yml` HunyuanImage3 job 模式：`set +e` → `pytest -s -v <test> -m full_model --run-level full_model`，`EXIT=$$?` → `buildkite-agent artifact upload "tests/e2e/accuracy/artifacts/**/*.png"` → `exit $$EXIT`）；
  - 2) 用 nightly（或带 `"env":{"NIGHTLY":"1"}` 的 API build—— nightly 层必需；注意定时 nightly 会 cancel 同分支在飞的 API build）跑该 job，经 `GET builds/<n>/jobs/<id>/artifacts` + `/artifacts/<id>/download` 取工件；
  - 3) 提交前验证 provenance：online == offline == 原始输出的 sha1 一致，且 SSIM(工件, 现 golden) 复现 CI 日志的精确值（如 0.964118）；
  - 4) 把工件提为 golden——CI 与自身确定性输出比较 → SSIM 1.0 / PSNR inf，严格阈值成立。
- 验证：下一个 nightly 的精度 job 以 SSIM=1.000000 / PSNR=inf 通过（参考收割：build 2683 工件 sha1 ed597a3b，H100 池跨 builds 2674/2683 确定）。
- **Owner 政策（2026-07-12）**：rebase 分支的 golden 基线必须与 main **逐字节一致**——rebase PR 内不得换二进制资产（owner 曾回滚两次 golden 提交 363f636d）。rebase 期间遇到该失败：归类为已知确定性数值失败，**不**派 debug agent、**不**在 align 分支换 golden；记入待办，rebase 合并后用收割的 CI 工件单独提重基线 PR。

### 2. ASR 评分器flake：whisper-small 听错，不是模型回归

- skill 元数据：`fix-tts-realtime-asr-accuracy-flake-whisper-small`，modules=[online_serving]，status=active，run_count=3，2026-07-11。
- 症状：音频/TTS/realtime 测试（如 `test_qwen3_omni_realtime_websocket`、`*_tts`）断言失败——用 `cosine_similarity_text(...)` 把生成音频的 Whisper 转写与模型自身文本流比较：`AssertionError "Output audio transcript should match model text (sim=0.XXX)"`；**立即重试即过**；
  - whisper 转写对照模型文本明显走样（实例：`sim=0.443, whisper='韦京,他是文化和政治的中心', model_text='北京是中国的首都。它是文化和政治的中心。'`）。
- 诊断：确认评分器是 **whisper-small**（默认：`tests/helpers/media.py::convert_audio_bytes_to_text(..., model_size="small")`）—— small 对短中文 TTS 片段会听错（北京→韦京、丢首句）且非确定；确认 flaky 非回归：重试通过（如 attempt 0 `1 failed` → 重试 `15 passed`），音频 smoke 断言（`len(out_pcm) >= 4096`、`delta_events >= 1`）通过——音频生成正常，只有 ASR 评分在变。
  - 与 Higgs-Audio-V3 "Shhh!" similarity<0.9 flake 同类。
- 修法：精度断言改用 **whisper large-v3** 评分（H200 主机缓存于 `~/.cache/whisper/large-v3.pt`）：`whisper_text = convert_audio_bytes_to_text(wav_out, model_size="large-v3").strip()` ——`convert_audio_file_to_text`/`convert_audio_bytes_to_text` 已把 `model_size` 透传给 `whisper.load_model`，
  - 在备用 GPU（双卡 runner 的 device n-1）spawn 子进程运行。改后再挂才真指向模型。可选：对 async/chunked 模式加有界重跑（codec 步调引入变差）。测试未修好又挡 rebase 时：把这一条断言按已知 ASR flake 处理（重试即过的孤立 sim<阈值不硬停）。
- 验证：2×H100（GPU 0,1）重跑（skill 原文环境 `cd /rebase/vllm-omni` + 本机 venv 解释器）`CUDA_VISIBLE_DEVICES=0,1 /rebase/.venv/bin/python -m pytest -s -v tests/entrypoints/openai_api/test_qwen3_omni_realtime_websocket.py -m "advanced_model and cuda and H100" --run-level advanced_model` →
  - 精度断言通过（实证：large-v3 下 async_chunk + sync `2 passed`，whisper-small 曾在 async_chunk 挂 sim=0.443）。
- 相邻案例（阈值调优，debug-memory #457，key=`async_chunk_cosine_similarity_threshold`，module=online_serving，status=active，run_count=1）：`test_streaming_audio_input_pcm_output_async_chunk[async_chunk]` sim 0.693<0.8—— 模型文本正确（'北京是中国的首都。它是文化和政治的中心'）而 whisper
  - 漏词（'北京是中国,它是文化和政治的中心'——Whisper 转写非确定，即使模型文本正确也可漏 1-2 个词）；**sync 变体逐字匹配通过**；async_chunk 模式因 `send_delay_ms` 分块上传给 codec 质量带来固有变差 → `_assert_realtime_accuracy()` 增加 `threshold` 参数（默认 0.8），async_chunk 用 0.65、sync 保持 0.8（文件 `tests/entrypoints/openai_api/test_qwen3_omni_realtime_websocket.py`）。
  - 注意其 watch-out：复跑可能撞 stage-1 talker 的 CUDA device-side assert（`gpu_model_runner.py:3781, synchronize_input_prep`）——独立的瞬态问题，与阈值无关；若持续出现查 upstream vLLM 变更。^[DM-457]

### 3. 已知上游 bug：phase vocoder ≥2.0x 音质悬崖（不在 rebase 分支本地修；正修走 omni main PR）

- skill 元数据：`fix-tts-speed-adjustment-phase-vocoder-quality`，modules=[input_output, entrypoints]，status=active，run_count=37，2026-06-10 创建 / 07-11 最后使用。
- 状态：**upstream vllm-omni main 的既有缺陷**，等 main 分支 PR（用 PyAV 的 ffmpeg `atempo`/WSOLA 换 phase vocoder）；PR 落地前：**不改** `tests/e2e/online_serving/test_voxtral_tts.py`（不得删 2.0/2.5 档，须与 origin/main 逐字节一致）；
  - **不在** `audio_utils_mixin.py` 重加多段分解——两种变体都试过且都修不到 0.9：2026-06-10 sqrt 分解（0.50→0.75）、2026-06-28 n 次根分解 `MAX_PASS_RATIO=1.4`（到 0.88，仍不足，已回滚）。
- 唯一 skill 声明：2026-06-28 曾出现建议相反做法的重复 skill `fix-audio-stretching-sqrt-decomposition`，已删除——**不要再造**。按非 H100 硬件上该测试的已知/预期基线失败上报，不打补丁。
- 确认适用：失败是 `test_speech_speed` 且 speed≥2.0，ASR 余弦相似度低于 0.9（典型 0.5–0.75；低速档通过）；`_apply_speed_adjustment` 与测试文件对 origin/main `git diff` 为空（有差异则不是本条——查 diff）；查 upstream 修复 PR 是否已落（`_apply_speed_adjustment` 出现 WSOLA/atempo 则本条已过期，重新调试）。

### 相关

- 环境类坑见 [[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（ci-environment-gotchas）；性能证据口径见 [[benchmark-overview]]（benchmark 入口）；模型语义验收见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model-adaptation-guardrails）。

## 决策与踩坑

### 1. golden 与硬件绑定（H100 vs H200 决定论差异）+ 重基线政策

- 禁止：放宽 SSIM/PSNR 阈值吸收漂移（PR #5042 评审已拒——永久削弱质量门）；在与 CI 池不同的本地硬件重生成 golden（H200 对 H100 依旧 ~0.964）；用对第三图等距推断图相等；
  - 用 FLASHINFER_DISABLE_VERSION_CHECK 等 kernel 选择开关"把数值对齐"（skill 原文交叉引用 `fix-flashinfer-jit-cache-version-mismatch`，见 [[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（ci-environment-gotchas） 第 2 条）。^[SK-fix-accuracy-golden-hardware-mismatch]

### 2. ASR 评分器flake：whisper-small 听错，不是模型回归

- 禁止：用 whisper-small 评音频精度；降相似度阈值吞掉整句 ASR 丢失（掏空测试信号——修评分器模型）；把孤立的 sim<阈值当模型回归/硬停 rebase（尤其重试即过、smoke 断言通过时）。^[SK-fix-tts-realtime-asr-accuracy-flake-whisper-small]

### 3. 已知上游 bug：phase vocoder ≥2.0x 音质悬崖（不在 rebase 分支本地修；正修走 omni main PR）

- 复发记录：2026-06-11 与 06-12（第 4 次复发）speed=2.5 similarity=0.499（transcript="with the Blue's Air with the Sun Rose."）；2026-06-28 build #2423 similarity=0.88（"The boy was there in the sun rose."）——当时被 CI 基线匹配 bug 误判为 actionable、错误上了 n 次根分解，修复与重试均已回滚。
  - 测试注解 `@hardware_test(res={"cuda": "H100"})`——只预期在 H100 通过。
- 根因：`_apply_speed_adjustment` 用 torchaudio phase vocoder（Spectrogram → TimeStretch → InverseSpectrogram），≥2.0-2.5x 伸缩产生让 Whisper 无法理解的伪影；判据（trigram-cosine ≥0.9）正好卡在质量悬崖上——upstream CI（H100 + vLLM v0.22.0 release）刚好过线，本环境（L20X + nightly wheel）远低于（0.50）：同一代码、不同环境 → main CI 绿、本地红。
  - 该测试上游当天加入（aa92a3a3 #3738）、从未在非 H100 验证过。已验证的正修（供 main PR）：经 PyAV（**已是 vLLM 依赖**，无需新增）调 ffmpeg 的 `atempo`（WSOLA 系、保音高——440Hz@2.5x 实测不变、幅度干净、为语音变速设计、支持到 100x）；torchaudio.sox_effects 不可用（torchaudio 2.11 移除）、librosa 被 pyproject 禁用。^[SK-fix-tts-speed-adjustment-phase-vocoder-quality]
