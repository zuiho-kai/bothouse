---
name: feature-audit-integrity-hmac-signing
description: audit_integrity.py 功能概览：--repo-root/--signing-key-env/--key-id/--strict/--audit-map 等 CLI 参数、签名密钥环境变量优先并在假值时回退到工件内 .doc_project_maintainer/project/audit-signing-key.json（不存在则自动生成 token_urlsafe(32) 密钥）、本地 HMAC 无机器/工作区绑定的安全边界与 script_hash 变更使既有审计失效、hmac.compare_digest 仅用于签名而 payload 哈希用 != 比较、promote 写入签名元数据与 verify 仅对 agent_audited 记录重验、verify_agent_record 四种信任结果分级（invalid/suspicious/trusted/promote 专用的 provisional）
metadata:
  scope: 只收该页所述全部内容（CLI 参数与密钥来源、安全边界、校验行为、promote/verify 数据流、信任分级）；实现深读（verify_agent_record 内部分支细节、main 退出码、file_hash 依赖）归 feature-depth-audit-integrity-hmac-signing
---
# 符号审计完整性 HMAC 签名与信任验证（audit_integrity.py）

## 现状

- **密钥来源与命令行参数**
- 通用参数 `--repo-root`（必填）、`--signing-key-env`（默认 `PROJECT_MAINTAINER_AUDIT_SIGNING_KEY`）、`--key-id`（默认 `project-maintainer-local-v1`）、`--strict`；`--audit-map` 对 promote/verify/report 必填（L654–L663）。
  - 签名密钥优先取环境变量，只要其值为假值（包括空字符串）就回退到工件内密钥文件 `.doc_project_maintainer/project/audit-signing-key.json`，该文件不存在时自动生成 `secrets.token_urlsafe(32)` 的 hmac-sha256 密钥（L43、L122–L154）。
  - verify/report 还有 `--batch-reuse-threshold`（默认 1）、`--scope`（默认 `default_health_audit`）、`--report-output`、`--require-closure`（L681–L693）。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L654–L663](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L654-L663),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L122–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L122-L154),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L681–L693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L681-L693)
- **本地 HMAC 的安全边界**
- Inference / 设计推断（非作者历史意图）：
- 工件内密钥文件与被保护数据同存一处（`.doc_project_maintainer/project/audit-signing-key.json`），且环境变量密钥优先于它（L135–L154）；所示代码没有任何机器或工作区绑定，因此能读到密钥的任何一方都可以用当前脚本重新签名记录。脚本自身哈希检查（`script_hash`）在验证时对比的是当前运行的脚本（L466–L468），其效果是脚本变更后既有 agent 审计的信任被判定失效，而不是阻止修改后的脚本重新签名——`promote` 总是用当前脚本哈希和新 HMAC 覆盖记录（L359、L383–L404）。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L135–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L135-L154),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L466–L490](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L466-L490)
- **校验行为与输入检查**
- 恒时比较只用于 HMAC 签名（`hmac.compare_digest`，L487–L488）；payload 哈希本身用普通 `!=` 比较（L484）。`promote` 前置校验入口文档：要求存在带内容的 `Actual Role` 标题且文本包含 `health:` 与 `overall:` 字段，并检查源文件与 JSON 输入存在性/结构（L235–L258、L345–L347）。
  - 验证报告输出状态计数、信任计数、closure 统计、批复用明细与逐记录 `records_detail`，并由 `recommended_action` 给出建议动作（L593–L623、L638–L651）。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L484–L490](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L484-L490),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L235–L258](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L235-L258),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L593–L623](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L593-L623)
- **promote 写入签名元数据，verify 仅对 agent_audited 记录重验**
- `promote` 定位 audit map 中的 symbol 记录后，把 source/symbol/entry_doc 哈希、git HEAD 与状态等信息写入 `record["integrity"]`，对去掉自引用字段后的记录计算 `payload_hash` 并用 `hmac_signature` 生成 HMAC 签名，最后回写 audit map（L384–L408）。
  - 当未提供 `--agent-call-signature-json` 时，状态记为 `script_assessed` 并从记录中删除 `agent_call_signature_batch`（L365、L377–L381）。验证侧 `verify_or_report` 只对 `audit.status == "agent_audited"` 的记录调用 `verify_agent_record`，其余状态走各自的代码路径（L547–L570）。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L384–L408](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L384-L408),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L547–L570](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L547-L570)
- **agent 审计信任分级**
- `verify_agent_record` 实际返回三种信任结果：`invalid_agent_audit`（缺少签名或批次、generated_by/script_hash/payload_hash/签名不符，或 stale 哈希变化，L454–L498）、`suspicious_agent_audit` 与 `trusted_agent_audit`；第四种 `provisional_agent_audit` 是 `promote` 在提供签名批次时的输出代码，不出现在验证路径（L372–L376、L502–L503）。
  - 批次复用超过阈值只有在 invalid/stale 检查都未失败时才使记录返回 `suspicious_agent_audit`（L491–L501）。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L454–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L454-L503),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L372–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L372-L376)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-audit-integrity-hmac-signing.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L654-L663
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L122-L154
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L681-L693
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L135-L154
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L466-L490
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L484-L490
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L235-L258
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L593-L623
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L384-L408
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L547-L570
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L454-L503
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L372-L376
- 源页字段（feature）：audit-integrity-hmac-signing
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py
