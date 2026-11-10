---
name: rules-build-compatibility
description: CI 构建产物与 Python 支持合同 OMNI-CI-2e、2j、2k：release rebase 时 base image、/dev/shm 与 grader 卡数对齐（v0.28、v0.31、NPU 四 image、XPU VLLM_VERSION 示例），requires-python 最低版本的安装导入与 fixture 生命周期，无 VCS wheel 的 runtime package data 完整性
metadata:
  scope: 只收 Dockerfile/base image 版本对齐、Python 支持范围和 wheel package data 三条构建类 CI 规则；ROCm Dockerfile canary 归 rules-amd，XPU release image 构建（OMNI-CI-3c）归 ci-rules-3，其余通用 CI 规则归 ci-rules-2
---
# CI 构建产物与 Python 支持合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/rules-build-compatibility.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8459；PR #7956；PR #7985；pyproject.toml；requirements/common.txt；tools/check_wheel_package_data.py；.github/workflows/build_wheel.yml；PR #8528；PR #5976；PR #6606；PR #6674
- 置信度（confidence）：high
- 入口与其他规则见 [[ci-rules-1]]、[[ci-rules-2]]、[[ci-rules-3]]（CI 共享规则）。
- [OMNI-CI-2e] release rebase 的 image、容器资源与实际辅助负载必须成套对齐
  - 触发：升级 vLLM/torch base image，或新版本在 startup 增加资源检查、编译缓存与 warmup 行为。
  - 强制：正式 release 直接使用同版本 base image 的自洽依赖集；只有目标是未发布 SHA 时才恢复 wheel 重装及其 torch/CUDA/NumPy ABI 修复。容器显式满足新 startup check（共享内存等），硬件数同时计入测试辅助模型：主模型占卡时，Whisper 等 grader 需要 spare accelerator 才能避免 CPU 超时。
  - v0.28 对齐的 release-boundary example：CUDA/CI/ROCm base image 与 installed vLLM 都指向 `v0.28.0`；CI Dockerfile 在官方同版本 image 出现后移除临时 wheel reinstall，而不是把旧 0.27 image 上的 ABI repair 带入 release。文档安装 pin 也必须同步；非 release SHA 才恢复明确的 wheel/ABI block。^[PR #6606]
  - NPU v0.28 对齐要求 `Dockerfile.npu`、`.npu.a3`、`.npu.ci`、`.npu.ci.a3` 四个既有 image 一起继承 matching `vllm-ascend:v0.28.0` 并显式设置 `VLLM_TARGET_DEVICE=npu`，同时保留 spawn multiprocessing。该四-image 合同不能从 CI image 成功外推为 production、全模型或性能兼容。^[PR #6674]
  - v0.31 对齐时 CUDA/CI/ROCm 使用官方同版 release image；CI dependency resolution 后检查 installed vLLM exact version，GPU job 开始时再验证 usable CUDA、FlashInfer 与 `vllm._C_stable_libtorch` 导入。Omni 版本 override 使用 `VLLM_OMNI_VERSION_OVERRIDE`，避免通用 setuptools-scm override 污染 dependency source build 的真实版本；
    - CPU image builder 的 version check 不能替代 GPU runtime check。保留原 accuracy thresholds，failed ASR 音频 artifact 只用于诊断，不能降低请求/ASR 断言。^[PR #8459]
  - 验收：image tag 与目标 release 一致；startup 通过共享内存 preflight；目标 lane 证明实际 grader device；每个残余失败独立记录，尤其数值/质量回归不能由 API 兼容测试替代。^[PR #5976]
  - XPU Dockerfile 的 `VLLM_VERSION` 默认、Intel CI build env 与安装文档显式 build arg 必须与同一 checkout 目标 release 对齐；PR #8528 把三者对齐到 v0.31.0，是该 source 的 release example，不证明所有模型/XPU hardware 兼容。审计 default 和 explicit override，不能依赖文档命令碰巧修正旧 Docker 默认；published base/fallback 的来源合同仍保留。^[PR #8528]
- [OMNI-CI-2j] 声明的 Python 范围必须同时支持安装、导入与 fixture 生命周期
  - 触发：修改 `requires-python` 所覆盖版本的依赖、typing/dataclass 表达式或 test teardown。
  - 强制：在最低声明版本验证 `.[dev]` 解析和真实受影响模块导入。3.10 的 field-less `DuplexCommand` mixin 用显式 `__slots__ = ()`，避免 `dataclass(slots=True)` 重复继承字段，与另一 slotted wire base 合成时产生 layout conflict；实例仍不得获得 `__dict__`。
    - `Self` 与 `Concatenate[int, ...]` 使用 backport，后者须声明 `typing_extensions>=4.13`，因 4.12.x 在 3.10 仍重新导出不接受 trailing ellipsis 的 `typing.Concatenate`。
  - 强制：dev PyAV 按 Python 分支解析（本 source 的 3.10 为 17.1.0，3.11+ 为 18.0.0），`tomllib` fallback 的 `tomli` 在 `<3.11` 显式声明；缺 TOML parser 不得静默改变 marker。TestClient 已关闭所属 loop 后，清空 final-output task 引用，只 cancel/await 仍在运行的 task。
  - 验收：最低版本重现旧安装/导入失败后修复通过，并与新版本对照 command construction、payload、pickle 与无 `__dict__`；验证 dependency markers、typing import 和 finished/running task cleanup。原 source 未新增 3.10/3.11 CI job，仍须分别记录真实版本的测试结果与无关硬件失败。^[PR #7985]
- [OMNI-CI-2k] runtime package data 必须在无 VCS 构建与安装后完整
  - 触发：增加 runtime-owned YAML、audio/model asset、JIT source、chat template，或调整 wheel data policy。
  - 强制：`pyproject.toml` 显式枚举 runtime data families，并关闭隐式 `include-package-data`，使 Git file finder 不决定运行时 payload。清除旧 build/egg-info 后构建 VCS wheel；另从 `git archive` 构建无 `.git`、无缓存 `SOURCES.txt` 的 wheel，并安装到独立 target tree。
  - 强制：比较两种 wheel 的完整 `vllm_omni/**` 文件集合；源端 deploy、distributed csrc、Covo speaker prompt、Step-Audio assets 与 chat templates 的非 Python 文件须同时存在于 archive ZIP 和 installed tree 且可读取。新增 runtime data family 时同步 inventory/checker。
  - 验收：归档构建能重现旧缺文件，修复后 source inventory 无遗漏、VCS/archive package member sets 相同，installed files 可读；删一项 package-data 或引入 VCS-only 文件必须失败。packaging-only 证据不需要模型运行，但不能提升为 inference、JIT 编译或跨平台 runtime pass。^[PR #7956]

## 决策与踩坑

- [OMNI-CI-2e] 禁止：在 release image 上保留补偿旧 image 的依赖手术；用 Docker 默认 `/dev/shm`；只按被测模型卡数配置 lane 而忽略 grader；把部分 nightly green 当全部兼容问题已关闭。
- [OMNI-CI-2j] 禁止：仅在 3.12 静态通过就声称最低版本支持；依赖传递安装碰巧给出足够新的 backport；对已完成、所属 loop 已关闭的 future 再从 pytest loop `gather`；把 scoped 修复说成新增版本 CI lane。
- [OMNI-CI-2k] 禁止：从源码文件存在推断已安装包可用；仅验证 VCS wheel；让旧 egg-info 掩盖遗漏。该 checker 比较集合和存在/可读性，不提供所有 member 的字节一致或模型运行证明。
