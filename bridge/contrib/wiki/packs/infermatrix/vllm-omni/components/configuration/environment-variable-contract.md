---
name: environment-variable-contract
description: 环境变量合同与诊断边界：environment_variable_inventory.py 分类清单（PUBLIC_OMNI 24 项、model-specific 58 项）、VLLM_OMNI_EVENT_DRIVEN_ORCH、VLLM_OMNI_ASYNC_OUTPUT_TIMEOUT、VLLM_OMNI_SENSENOVA_PAGED_DECODE、FASTVIDEO_VSA_SM100A 的语义，stage env 的应用与恢复、collect_env.py redaction、审查门禁四步
metadata:
  scope: 只收 process 环境变量、stage env 与 collect_env.py 诊断输出的已合并合同和审查步骤；清单与测试同步规则归 rules-environment-variables，typed deploy 字段归 configuration-architecture 与 pipeline-deploy-schema
---
# 环境变量合同与诊断边界

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/environment-variable-contract.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, config, environment；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #6217；PR #6631；PR #5221；PR #6516；PR #6909；vllm_omni/config/environment_variable_inventory.py；tests/config/test_environment_variables.py；collect_env.py

### 什么时候查这里

- 新增、审查或排查 process 环境变量，尤其是 deploy stage `env`、worker 继承和 `collect_env.py` 输出。
- 判断一个从源码搜到的名字是否是稳定公开配置，而不是模型、benchmark、平台或内部开关。
- 先从 [[configuration-overview]]（Configuration index） 选择 owner，再把 env 与 typed deploy 字段的最终值按 [[config-audit-plain-language]]（config audit） 的 producer→consumer 链路核实。

### 已合并的合同

- `environment_variable_inventory.py` 是**分类清单，不是值解析器**：实际 consumer 继续拥有默认值、解析、优先级和读取时机。PR #5221 将 `VLLM_OMNI_EVENT_DRIVEN_ORCH` 加入 `PUBLIC_OMNI`（24 个名称）：只在 `Orchestrator` 构造时读取，默认 `0`；trim/lower 后仅 `1`、`true`、`yes`、`on` 开启，其他值保留 legacy loop。
  - 它同时选择 LLM orchestration 与 serving final-output drain，部署时必须在运行 orchestrator 的 stage-0 进程启动前设置；不是 request-level 开关，且不使 diffusion output 变为无轮询。新公共 Omni 名称必须以 `VLLM_OMNI_` 开头，旧前缀仅为兼容保留。^[PR #5221]
- PR #6631 处理 #6217 合并后的 main 漂移：`VLLM_OMNI_ASYNC_OUTPUT_TIMEOUT` 是公开、实验性、仅环境变量的 float 秒数开关，默认 `600`；diffusion engine 在每次 `step_streaming` 请求路径读取它，非 float 或 `<=0` 时仅 warning-once 并回退默认值。它等待 async output，不是 `VLLM_OMNI_INPUT_WAIT_TIMEOUT_S` 的 full-payload input-coordinator 控制。
  - `ROSVOT_SOURCE_DIR` 已随 SoulX-Singer 支持移除而从 model-specific `deprecate_remove` 清单删除。
- PR #6516 将 `VLLM_OMNI_SENSENOVA_PAGED_DECODE` 加入 model-specific `promote` inventory（33→34），不是 `PUBLIC_OMNI`（仍为 24）。consumer 默认只 literal `"1"` 启用 model-local SenseNova single-sequence paged decode；这不使它成为 scheduler、prefix-cache 或通用 paged-KV setting。^[PR #6516]
- PR #6909 将 `FASTVIDEO_VSA_SM100A` 加入 model-specific `promote` inventory；它为 FastH3 MiniMax-H3 的 FastVideo VSA 选择 native Blackwell SM100a route，`1` 还要求兼容 source-built `fastvideo-kernel` wheel。它不是 public setting，不能从 B300 Triton 或 B200 native observation 推断其他模型、GPU、kernel build 或性能支持。
  - 目标快照为 model-specific 58、promote 35，`PUBLIC_OMNI` 仍为 24。^[PR #6909]
- 公开设置没有全局的 env-vs-CLI/YAML/request 优先级。按每个 consumer 的合同核实：请求可变行为应属于 request schema，稳定 model/stage 行为应属于 typed config，环境变量只适合启动、平台集成、诊断或兼容回退。import/startup 时读取的值必须在启动 CLI/导入前设置；启动后的父 shell 变化不会更新既有 worker。
- stage 的 `env`（以及兼容的 `runtime.env`）仅在启动该 stage/child process 时临时应用：键和值会字符串化，child 可继承，随后恢复父进程旧环境。因此它不能追溯改变已在此前 import 缓存的值，也不应承载 request-varying 语义。日志和诊断只输出键，绝不输出 stage `env` 的值。
- `collect_env.py` 只输出安全的公共 Omni allowlist、注册的 vLLM 名称和选择的平台前缀；显式 redact 的 `HF_TOKEN`、`HUGGINGFACE_HUB_TOKEN`、`OPENAI_API_KEY` 及常见 secret-like 名称不得输出值。为了诊断不完整/损坏的 Omni 安装，清单导入失败时 collector 回退为空清单而仍可报告既有安全信息。
- 静态 drift 测试覆盖可解析的直接 `os` 访问、module 常量、local wrapper、别名、membership 与小写 key，并对 model/benchmark transitional 行做反向文本存活检查；Pydantic 生成的 server-storage 名称单独核实。动态拼接的跨模块 metadata 和 stage `env` 任意键仍不能由扫描可靠推断，必须人工分类。

### 审查门禁

1. 先沿真实 consumer 确认解析、默认、优先级与读取时机；不要把 inventory 或文档表当成运行时实现。
2. 新的稳定公开 Omni 设置同时更新分类、公开参考覆盖和 prefix gate；模型专用、benchmark、platform/external、internal 名称保持各自 owner，不因被读取而自动公开。
3. 对 model-specific name 指定迁移目的（typed config、request scope、external、internalize 或 deprecate/remove）但不要把目的当成已经实现。目标提交的 58 个 model-specific 项为 promote 35、request scope 6、external 0、internalize 11、deprecate/remove 6；#6232 仍按模型族和 owner 跟踪迁移，尚不是现有运行时保证。
   - 该 issue 的旧 seven-item removal checklist 含已退休的 `ROSVOT_SOURCE_DIR`，不能覆盖当前 inventory。
4. 变更 collector 或 stage `env` 时，以真实 worker/inheritance 与 redaction 测试验收；错误安装场景不得因可选清单导入而使诊断工具本身失效。

## 决策与踩坑

### 已知证据限制

- PR #6217 的清单与 CI 防止可静态识别的 drift，但不证明所有动态环境访问均已发现，也不统一历史 consumer 的 precedence。清单是该提交的审阅快照；main 并发演进仍可能引入 drift，因此审查当前分支时必须运行 live scanner，并以当前 source 而非本页的历史计数判断。
