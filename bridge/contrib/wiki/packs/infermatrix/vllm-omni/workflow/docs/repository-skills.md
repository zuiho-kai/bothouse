---
name: repository-skills
description: DOCSKILL-1a 至 DOCSKILL-1d：.claude/skills 10 个目录的 catalog 校验（含 vllm-omni-npu-upgrade 与 npu-model-runner-upgrade 名称差异）、skill 不是授权或安全边界、examples Python 新增路径 policy、production-add-diffusion-model 逐行证据矩阵与 L1–L5 映射
metadata:
  scope: 只收 contributor-facing repository skill 的 catalog、信任边界、examples policy 与 diffusion 生产化矩阵规则；docs 目录入口归 docs-overview，review 行为归 review-overview，生成文档规则归 generation-and-support-rules
---
# Repository skill contributor rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/repository-skills.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, docs；created: 2026-09-02；updated: 2026-09-04
- 来源（sources）：PR #6029；PR #6046；PR #6097；.claude/skills/readme.md；.claude/skills/add-diffusion-model/SKILL.md；.claude/skills/add-tts-model/SKILL.md；.claude/skills/diffusion-perf-opt/SKILL.md；.claude/skills/find-simplifications/SKILL.md；.claude/skills/precheck-pr/SKILL.md
  - .claude/skills/precheck-pr/references/checklists.md；.claude/skills/precheck-pr/references/examples-policy.md；.claude/skills/production-add-diffusion-model/SKILL.md；.claude/skills/production-add-diffusion-model/references/api-and-recipes.md
  - .claude/skills/production-add-diffusion-model/references/feature-patterns.md；.claude/skills/production-add-diffusion-model/references/performance-patterns.md；.claude/skills/production-add-diffusion-model/references/production-validation.md；.claude/skills/quantization/SKILL.md
  - .claude/skills/review-pr/SKILL.md；.claude/skills/vllm-omni-npu-upgrade/SKILL.md；.claude/skills/vllm-omni-test/SKILL.md；docs/contributing/README.md
- 置信度（confidence）：high
- 只有 `DOCSKILL-数字字母` 是可审计规则 ID。这里拥有 contributor-facing catalog、组合流程和信任边界；具体 review 行为仍由 [[review-overview]]（review owner） 管理，各 domain 的源码合同仍回对应 model/component owner。
- [DOCSKILL-1a] catalog 必须从目标 revision 的真实 skill 目录生成
  - 触发：增删/重命名 `.claude/skills/*`、修改 frontmatter `name`，或更新 contributor task-to-skill table 与 `.claude/skills/readme.md`。
  - 强制：以目标 revision 的目录与每份 `SKILL.md` frontmatter 为准，分别校验链接路径和 invocation name。
    - `dff28e6` 恰有 10 个目录且都有 `SKILL.md`：`add-diffusion-model`、`add-tts-model`、`diffusion-perf-opt`、`find-simplifications`、`precheck-pr`、`production-add-diffusion-model`、`quantization`、`review-pr`、`vllm-omni-npu-upgrade`、`vllm-omni-test`。
    - `production-add-diffusion-model` 是 Day-0 vertical slice 完成后的生产化 workflow；初始 architecture port、registry wiring 与 basic loading 仍先用 `add-diffusion-model`。NPU 的目录/链接名是 `vllm-omni-npu-upgrade`，frontmatter 与展示的调用名是 `vllm-omni-npu-model-runner-upgrade`，两者不能互换。
    - 旧 catalog 的 `add-omni-model` 与 `generate-release-note` 没有目标目录，不能继续列为可用 skill。
  - 验收：对 catalog/task table 的每行做 link-exists + frontmatter-name 对照，并反向检查所有顶层 skill 目录都被登记。PR #6097 增加 production skill body、四份 reference、agent descriptor 与 readme entry；这些文件是 contributor guidance，不证明 automatic discovery、invocation 或生产行为正确。
    - 报告的 strict MkDocs/pre-commit 只证明文档可构建，且没有 catalog link/frontmatter 或 production-combination 的自动回归。
- [DOCSKILL-1b] skill 是可审查指令，不是授权、执行证明或安全边界
  - 触发：贡献者要求 coding agent 使用 repository skill，组合 domain/test/precheck workflow，或引用 skill 输出作为合并证据。
  - 强制：issue、accepted RFC 或明确 maintainer decision 定义任务权限与预期行为；先选最窄 domain skill，生产行为或 tests/CI 改动再加 `vllm-omni-test`，提交前用 `precheck-pr`。要求 agent 给出精确可运行命令、结果和所有因硬件、权重、credential、dependency 缺失而未运行的检查；人工再检查 diff scope、无关改动、测试、文档以及性能/精度证据。maintainer review 仍不可省略。
  - 信任边界：automatic discovery 取决于具体 agent；手工指向 `SKILL.md` 只提供仓库维护者写入的指令文本，不保证 agent 已安装/识别、会遵守、能调用所需工具或实际执行命令。读取 skill 不会自动扩展用户授权，也不形成 filesystem/network/credential sandbox；执行前仍须审查目标 revision 的 skill、references 与 scripts，按 agent/platform 的权限机制处理副作用和秘密。
  - 验收：交付记录 task authority、选用的 skill 与理由、实际命令/结果、未运行项、diff review 和 reviewer owner；若要声称跨 agent 可发现/执行，必须增加至少一个受支持 agent 的 pinned-version behavioral eval。PR #6029 没有此类 agent eval，因此只建立 contributor guidance。^[PR #6029]
- [DOCSKILL-1c] Python example policy 只审新增路径并共享一份分类合同
  - 触发：`precheck-pr` 或 `review-pr` 遇到在 `examples/` 下新增、复制或重命名的 Python destination path。
  - 强制：从目标 revision 的 merge base 以 `ACR` path census 选出候选，再读取文件行为而不只看文件名；model、checkpoint、vendor 或 family 专属的 prompt、request/output adaptation 与 launch config 必须回 production model module 或 `model_extras`，用户命令和验证证据进 task docs/recipe。两个 skill 必须引用同一份 canonical policy；
    - shared image runner 的生产边界继续服从 [[rules-image-task-envelope]]（EXEC-6a；源锚点 #exec-6a-shared-image-example-先建-canonical-envelopemodel-extra-只做特化变换）。
  - 验收：分别覆盖 add、copy、rename、modify、delete，且 generic-looking model-specific 脚本必须 block；真正 model-neutral、由配置选择模型的 task/protocol entrypoint 可通过。检查两个 skill 的 reference 都解析到 canonical policy，并把结果作为独立 examples-policy 维度报告。^[PR #6046]
- [DOCSKILL-1d] diffusion 生产化必须以逐行证据矩阵而非 Day-0 或 roadmap 声明
  - 触发：使用 `production-add-diffusion-model`，或声称 diffusion model 的 API/limit parity、FP8、DLO、Cache-DiT、attention/operator optimization、batching/step execution、硬件 recipe、性能或生产可靠性已支持。
  - 强制：Day-0 vertical slice 与 production readiness 分开报告。建立至少以 task、API mode、execution mode/capacity、shape/schedule、attention backend、packed layout、cache policy、quantization、offload mode、topology、hardware、dtype、output representation/transport 为 key 的矩阵。
    - 状态只能是 `validated`（精确 row 有可复现 correctness 与 deployment artifact）、`limited`（通过范围、限制及 rejection/fallback 明确）、`unsupported`（稳定 architectural/platform 限制已证明且 fail early），或 `not tested`（默认；没有充分证据）。
    - 每个 `validated` row 记录 model/checkpoint revision、Omni SHA、command、request asset/hash、seed/schedule/shape、raw output artifact、environment 与 result；每个非 `validated` row 也记录 reason/evidence。
  - 强制：Function、Accuracy、Performance、Reliability 是独立 readiness tracks，不是新的编号 CI level；映射到现有 [[test-tiers]]（L1–L5 taxonomy）：Function 为 L1 logic 加 L2 basic offline/online E2E（real-model scenarios 扩展至 L3/L4）；Accuracy 为重点 L3、深入/扩展 L4；Performance 为时间预算允许的 L3 threshold、完整 baseline/regression 的 L4；
    - Reliability 的便宜 rejection/recovery 可更早跑，而长 soak、fault injection 与 stability 属 weekly L5。topology 是相应 level 内的 test case，不重新定义 level。
  - 强制：逐 axis 验证；dense BF16 single-device oracle 有 scoped parity 后才能提升，不能从 import、server startup、platform abstraction、另一 task/card/topology 或 capability 继承支持。
    - direct-checkpoint mmap 的当前 TP1/non-HSDP/non-online-quant restriction 不等于 DLO 全局不支持：TP>1 经 ordinary TP-aware loader 后仍可对 DLO AllGather/no-AllGather 建立独立 scoped row。Day-0 case study、open optimization roadmap 和未来 capability 均只可作待验证线索，不能写成 model support。
  - 验收：PR/recipe 明确 Day-0 已通过的 representative task 和仍未关闭的 production gate；官方 advertised task 的 API/offline/online、strict loading、fixed-reference quality 与 negative validation 分别有证据，recommended deployment row 另有 correctness、isolation、abort/error cleanup、benchmark 与 soak evidence。
    - 所有未验证组合保持 `not tested`，而 Function/Accuracy/Performance/Reliability CI 分别指向 owner、artifact 和可操作 failure output。^[PR #6097]

## 决策与踩坑

- [DOCSKILL-1a] 禁止：只检查显示名称而不解析链接；从文档名称推断存在安装包、hook、agent registry 或 runtime registration。contributor guide 的 GitHub 链接指向可变 `main`；发布审计必须读取 pinned target SHA，不能把未来 `main` 内容倒灌到当前合同。
- [DOCSKILL-1b] 禁止：把“ask it to use”描述成强制 enforcement；把未运行检查写成 pass；用 `precheck-pr` 代替 CI、maintainer review 或 accepted design；因为多个 skill 可组合就让它们越过 issue scope，或假设不同 coding agent 对 `.claude/skills` 有相同 discovery/invocation 语义。
- [DOCSKILL-1c] 禁止：报告仅修改或删除的既有 model-specific example 债务；因文件名看似 generic 就接受内部只实现一个模型合同的脚本；复制 policy 到 reviewer workflow 后分别演化；把 skill blocker 描述为已有 CI gate。
- [DOCSKILL-1d] 禁止：把 roadmap、实现存在、generic bridge 或 framework capability 写成 production support；把 `not tested` work queue 提升为 evidence；把另一硬件、量化/loading lane、cache/offload/topology 或 public streaming 的结果外推到未测组合；把生产 track 或结构性 protocol 当作 latency、throughput、cancellation、accuracy 或 stability verdict。
