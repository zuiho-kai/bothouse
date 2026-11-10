---
name: ci-rules-2
description: vLLM-Omni CI 规则（2/3）OMNI-CI-1a、1b、1c、2a：硬件 lane 真实收集与 MIRROR_HW preset 推导、回归 fence 的 mutation 验证、NIGHTLY/WEEKLY/NON_CRITICAL scheduled lane 与 coverage 所有权、pre-commit 工具 pin 与 ratchet budget
metadata:
  scope: 只收通用 CI 规则 OMNI-CI-1a、1b、1c、2a 及其后的构建产物指引；入口表见 ci-rules-1，OMNI-CI-3a 及之后的规则见 ci-rules-3；构建与版本规则归 rules-build-compatibility
---
# vLLM-Omni CI 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[ci-rules-1]]；第 3 部分 [[ci-rules-3]]
- 源页：`knowledge/repos/vllm-omni/ci/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-08-23；updated: 2026-10-06
- [OMNI-CI-1a] 硬件 lane 必须真实收集并执行目标路径
  - 触发：增加模型、硬件路径、nightly/ready/merge lane，或升级运行时/镜像。
  - 强制：硬件 helper 从 `pyproject.toml` 派生 platform/SKU/`cards_N`，default 为 `cards_1`；Buildkite selector 按 cards count 切分，直接写 SKU marker 被 pre-commit 拒绝。^[PR #6650]
  - 强制：CUDA `MIRROR_HW` 只接受 empty/unset 或不分大小写的 `b200`，否则 upload fail；NPU 忽略它。省略 preset 时从 `-m` 推导：unset 匹配 H100/L4（两者都有时取 H100），b200 只匹配显式 B200；多个正 `cards_N` 取最大值，正 marker 优先于 negation，只有负 card marker 时取该 chip 最大已有 preset，匹配 chip 却没有任何 card marker 才 fail。显式 preset 优先；
    - b200 跳过 H100/L4 preset，不匹配 B200 marker 的 inferred step 也 omit，且 selector 不重写原 `-m`。^[PR #5543]
  - 强制：资源数、pytest marker、pipeline 路由和共享 stage registry 同步；必需依赖、模型初始化或 collection 失败必须让 job 失败，并证明目标测试数大于零且原失败在对应硬件消失。默认 `prepend` import mode 下，whole-tree collection 遇到同名叶子目录时，所有中间父目录必须用 `__init__.py` 保持规范限定包名，不能让不同子树都退化成同一个顶层包。
  - 验收：当前 head 按真实 lane 的 whole-tree/marker scope 记录硬件、依赖版本、collection 数和执行结果，而非只收目标测试文件；同名叶子包必须解析为不同规范名（如 `tests.e2e.accuracy.minimax_h3` 与 `tests.diffusion.models.minimax_h3`）。
    - 注入缺 `__init__.py`、缺依赖、坏 registry 或错误 marker 时 lane 必须红。 ^[PR #3422] ^[PR #5310] ^[PR #5524] ^[PR #5543] ^[PR #5780] ^[PR #5872] ^[PR #6048] ^[PR #6096] ^[PR #6102]
  - MiniCPM-o online suite 的具体矩阵必须从 server args 读取：core 只跑 async chunk，expansion 分别跑 sync/async，duplex 又有自己的共享 server fixture。marker 与 parametrization 只能证明 collection 意图；没有实际 runtime 结果时，不能证明目标硬件行为。
    - 模型专属 fixture 合同见 [[minicpm-o-4-5-rules-3]]（MCPMO-5b；源锚点 #mcpmo-5b-online-serving-ci-必须显式区分-chunk-模式与-duplex-fixture-语义）。^[PR #6056]
  - MiniMax-H3 的 DLO DP2 ready smoke 同样必须把 YAML 注册和实际 runtime 证据分开：`h100_2`、selector、90-minute timeout 与 explicit dependencies 只证明该 job 的配置。用例以 TP=1/DP=2 的 DLO server 发起两条并发 T2VA sync request，并检查 MP4 的 geometry/FPS 和非空可解码 audio；
    - PR 报告的 collection=1 和 local two-card B300 184.97 s 是该精确 workload 的作者报告，不能提升为 Buildkite H100 pass、通用并发可靠性或性能 gate。^[PR #6555]
  - 一个文件同时含 CPU unit 与真实 GPU kernel 时，tier/modality 可以 module-level，但 `cpu` 只给 CPU case；GPU case 用硬件 helper，避免 module `cpu` 把它们送进 Simple shards。专用 AR paged-attention GPU lane 设置 `VLLM_OMNI_AR_FA_REQUIRED=1`：缺可用 FlashAttention 必须 fail，optional local run 才可 skip。
    - READY/MERGE ROCm lane 保持相同完整数值矩阵，CUDA merge 保留对应 lane；job-local AITER/Torch extension cache 和内层 timeout 留出 step cleanup 窗口。
  - 验收对 whole-file 按实际 CPU/GPU selectors 分别 collection，CPU 不收 GPU case、GPU 不收 CPU case；required backend 不可用必须红，不能以所有 GPU case skip 换绿。PR #8346 的精确 matrix 为 57 CPU/16 GPU，数字只资格化该 head，不是未来固定 census。^[PR #8346]
- [OMNI-CI-1b] 回归 fence 必须锚定可观察合同且非空转
  - 触发：新增 bug regression、API guard、route census 或 middleware fence。
  - 强制：从 assembled app/公开 handler 观察行为，只改变目标变量；必需 state 不仅检查存在，还要检查非 `None`。测试须在旧实现或代表性 mutation 上失败，在修复后通过。mock engine 自己抛出的异常只能证明 route 不吞异常；真实 backend 状态与 HTTP mapping 必须另由 live server 触发生产操作验证，不能把 mock-authored type/message 当成 backend contract。
  - 验收：mutation 分别置空 wiring、移除目标 route/method、绕过 inner middleware，fence 均失败；route census 覆盖应用实际暴露的 HEAD/OPTIONS 和依赖 state key。异常路径分别用 CPU mock 证明 route propagation，并用 live assembled app 触发真实 backend condition、核对结构化 status/body 与失败后的 state。 ^[PR #3422] ^[PR #5074] ^[PR #5670] ^[PR #5713] ^[PR #6202]
- [OMNI-CI-1c] scheduled lane 与 coverage owner 必须按完整 gate 矩阵验证
  - 触发：修改 Buildkite bootstrap 的 branch/env/PR-label 条件、L1/L4/L5 workload 归属、`--e2e` 上传、coverage helper，或 docs/skip-mark-only 的 scheduled escape hatch。
  - 强制：`main + NIGHTLY=1` 只拥有 L4 nightly；`main + WEEKLY=1` 上传 L5 weekly，且为 CUDA ready/merge 加 `--e2e` 跑完整 L2/L3 E2E 与 per-mode coverage；`main + NON_CRITICAL=1` 只上传 weekly 的 non-critical E2E group。普通 main merge 与非 main PR labels 必须继续走各自 gate，NPU scheduled nightly 不隐式上传 ready。
    - docs-only/skip-mark-only diff 可以跳过默认 CI，但不能吞掉这些 main scheduled lane。
  - coverage 所有权：CUDA/AMD ready/merge 的 L1 pytest 不附带 `--cov`；weekly CPU job 对 `tests/ -m 'core_model and cpu'` 生成合并报告。`run_cov_split.sh` 只在 `WEEKLY=1 && BUILDKITE_BRANCH=main` 拆分 offline/online coverage 与 artifact；其他调用必须保持一次 combined pytest、无 coverage。
    - 为 whole-tree collection 移动测试或延迟导入 example 时，仍须保持原 marker 与测试语义。
  - 禁止：把 `nightly-test` label 当 weekly CPU coverage gate；让 `NIGHTLY=1` 顺带占用 L2/L3；用 pipeline 已上传推断嵌套 group 一定执行；通过 `pytest --collect-only | grep ...` 枚举文件却不传播 collection 失败或不检查结果非空。PR #6311 的旧 weekly TTS 动态循环曾有这个 fail-green 缺口；当前显式 family inventory 与失败传播见下述 PR #8239 合同。
  - 验收：对 docs-only、CI-level-only、普通 main、三种 schedule env、CUDA/NPU 与每个 PR label 逐项渲染 bootstrap，并断言 child upload、`--e2e` 和 group-level `if`；coverage helper 分别验证 weekly-main 拆分上传与其他环境 combined/no-cov。任何动态 collection 都要让 import error、零 selection 和单文件失败使 job 红。^[PR #6311]
  - 长 TTS weekly sweep 可按模型 family 拆分为有界 step，保持一文件一 pytest process、原 env/selector/run-level；显式 file list 循环累积任何失败并最终非零退出。新增文件要审计全部 family inventory，不能保留旧 collect-only pipeline 的 fail-green 行为。
  - tier/cadence 迁移按 case 而非整个 module：MiniCPM continuous-window 为 full_model，在 CUDA/NPU duplex nightly 跑并从 broad sweep 排除，另两 window case 仍 advanced_model；π0.5 标 slow 后属于 weekly YAML 的 `NON_CRITICAL=1` group，不能仅凭文件名声称 `WEEKLY=1` 会执行它。验收同时渲染 group `if`、marker 与去重路径；
    - 静态 wiring 不提供 full-checkpoint pass。^[PR #8239]
- [OMNI-CI-2a] CI 工具、schema 和 hook 是可复现供应链
  - 触发：修改 pre-commit/Buildkite schema、下载 lint 工具、SPDX/import 检查或 stability marker。
  - 强制：固定工具版本并校验摘要；声明本地与 CI 强制 hook 矩阵；路径跨 Windows/POSIX 归一化；源码头使用项目 SPDX 标识且覆盖 `.sh`；marker 参数 shell-quote 并有明确默认值。
  - CI 测试插件若与既有环境依赖不兼容，必须在受影响 lane 精确 pin 到已验证版本，并记录失效的解析版本、冲突符号/依赖和解除条件；不能把 lane 的临时 pin 误写成运行时支持或项目依赖合同。
  - 验收：当前 main schema/pre-commit、DCO 和 marker collection 通过；篡改摘要、Windows 路径、shell header 或非法 stability 参数分别被对应 gate 拒绝。 ^[PR #3422] ^[PR #6273] ^[PR #6293] ^[PR #6303] ^[PR #6343]
  - pre-commit ratchet 不能把债务下降当成 hook 失败：`actual > budget` 才返回 1，相等静默通过，`actual < budget` 必须返回 0 并打印收紧上限的 reminder。passing hook 需 `verbose: true` 才能让提示可见；hook 的 `files` 还必须包含 checker 自身，使 budget 修改也会触发审计。下降后未及时收紧会留出 slack，被检测分支只要不超旧上限就可回增；直接提高 budget 也只会通过并打印 slack notice，所以“上限只能下降”仍由 reviewer 审核。
    - 手写 repo-wide constant 还使 verdict 受 merge order 影响，不是 merge-base-relative 合同。现有 unit test 另外直接断言 count 等于 budget，所以下降但未改 constant 时 hook 会通过，而该 test 若被收集仍会失败；两者应统一为同一非递增语义。^[PR #6008]

### 构建产物与 release rebase

- 镜像与checkout版本、容器startup资源、辅助grader负载、Python支持范围及无VCS wheel合同，见[[rules-build-compatibility]]（构建与版本规则）（`OMNI-CI-2e`, `OMNI-CI-2j`, `OMNI-CI-2k`）。

## 决策与踩坑

- [OMNI-CI-1a] 禁止：初始化失败后 skip-green；用 CPU 静态检查代替 CUDA/NPU 执行；只改模型目录而漏掉共享 registry/路由；把临时硬件硬编码留到合并。marker 名不等于实际硬件：某目录只有 `core_model and cpu` lane 时，GPU-dependent case 也应使用该 lane selector，再用 CUDA availability skipif 作硬件门；标成无人选择的 `cuda` 会得到零 collection。
- [OMNI-CI-1b] 禁止：绑定可搬迁私有符号或单个 router；用恒真类型断言、错误参数的提前失败、宽泛 `>=400`、不同文本或长度冒充目标分支证据。
- [OMNI-CI-2a] 禁止：下载浮动 `stable`；让 rebase 静默回退 hook/marker；未引用包含 `: ` 的 YAML command；用测试名后缀代替硬件 marker。
