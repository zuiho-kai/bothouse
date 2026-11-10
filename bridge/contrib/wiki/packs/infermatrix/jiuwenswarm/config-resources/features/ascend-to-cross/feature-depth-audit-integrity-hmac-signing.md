---
name: feature-depth-audit-integrity-hmac-signing
description: audit_integrity 实现深读：verify_agent_record 对 agent_audited 记录做签名/哈希比对并归类 invalid/stale/suspicious/trusted（函数局部返回值）、main 按 command 分派且 verify_or_report 在 verify 模式下按 invalid/stale/suspicious/closure 未通过分别返回 1/2/3/4（report 模式恒 0，非进程退出码断言）、add_repo_key_arguments 的必填与默认常量参数、verify_agent_record 依赖 verify_or_report 传入的 signing_secret 与 hmac.compare_digest、无签名或缺 batch_hash 直接判 invalid_agent_audit 的守卫、按当前脚本哈希验证换取可检测篡改但正常脚本更新也会使旧记录失效的取舍、SKILL.md 记载的 preflight ensure-key 手动步骤（未执行）
metadata:
  scope: 只收实现深读（verify_agent_record/main 分派、参数常量、依赖与守卫、取舍、未执行的手动验收记录）；功能概览归 feature-audit-integrity-hmac-signing
---
# 符号审计完整性 HMAC 签名与信任验证（audit_integrity.py）：实现深读

## 现状

- [[feature-audit-integrity-hmac-signing]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **verify_agent_record：对 agent_audited 记录做签名与哈希比对并归类信任结果** verify_or_report 遍历 audit.status == "agent_audited" 的记录调用 verify_agent_record；
  - 该函数在记录缺 integrity.signature 或缺 batch_hash 时直接返回 "invalid_agent_audit"，否则比对 payload_hash 与 hmac_signature(secret, payload_hash)（hmac.compare_digest），任一 mismatch/untrusted_script_hash 置 invalid 并返回 "invalid_agent_audit"、closure_eligible=False；
  - 仅哈希类不一致（symbol/source/entry_doc_hash_changed）单独标记 stale，batch 重用超阈值标记 suspicious。这是函数返回值，不代表进程退出码。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L444–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L444-L503),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L537–L560](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L537-L560),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L175–L176](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L175-L176)
- **main 按 command 分派，verify_or_report 在 verify 模式返回 0-4 区分退出码** main(argv) 解析后分派 ensure-key/promote/verify/report；AuditIntegrityError 被捕获并以 JSON 打到 stderr 后 return 1。verify_or_report 在 verify_mode 下按 invalid/stale/suspicious/closure 未通过分别返回 1/2/3/4，report 模式恒 return 0。此返回值仅是函数局部返回值，不证明进程退出码。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L697–L712](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L697-L712),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L625–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L625-L635)
- **add_repo_key_arguments：--repo-root 必填，签名密钥参数默认取常量** 解析器要求 --repo-root 与 --audit-map 必填；--signing-key-env 默认 DEFAULT_SIGNING_KEY_ENV、--key-id 默认 DEFAULT_KEY_ID、--strict 为 store_true 开关；这些默认常量的具体值不在所示行内。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L654–L663](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L654-L663)
- **verify_agent_record 依赖 verify_or_report 传入的 signing_secret 密钥与 hmac/hashlib 实现** verify_or_report 通过 signing_secret(args.signing_key_env, root, args.key_id) 取得密钥（L523），并作为 secret 传入 verify_agent_record（L548–L551）；
  - 该函数用 hmac_signature 以 HMAC-SHA256 计算 integrity.payload_hash 的期望签名（L487，定义见 L175–L176），并用 hmac.compare_digest 与记录中 signature 比较（L488）。同时依赖本脚本自身的 file_hash：integrity.script_hash 与 script_hash() 不一致时追加 untrusted_script_hash 并置 invalid=True（L466–L468）。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L520–L554](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L520-L554),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L175–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L175-L180),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L466–L490](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L466-L490)
- **无签名或缺 batch_hash 的记录直接判 invalid_agent_audit** verify_agent_record 开头两个守卫：integrity 非 dict 或无 signature 返回 ("invalid_agent_audit", ["unsigned_agent_audit","invalid_agent_audit"], False)；batch 缺 batch_hash 返回 missing_agent_call_signature 分支。此类记录不计入 closure eligible。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L452–L458](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L452-L458)
- **按当前脚本哈希验证记录：换取篡改可检测，代价是脚本变更即失效** 设计推断（非作者历史意图）：
- 验证将记录内 script_hash 与当前运行的 script_hash() 比对，不一致即标记 untrusted_script_hash 并置 invalid（L466–L468），随后 L496–L498 返回 "invalid_agent_audit"。推断（非作者意图）：好处是脚本被改动后既有审计记录降级为不可信；成本是正常脚本更新也会使旧记录失效，且所示片段未含恢复路径。SKILL.md L62 本身将该密钥定位为非防篡改安全边界。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L466–L468](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L466-L468),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L496–L498](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L496-L498),
  - [jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md:L60–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md#L60-L62)
- **文档化的 preflight ensure-key 步骤（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md L58–L61 记录：在 preflight 运行 `python <skill-dir>/scripts/audit_integrity.py ensure-key --repo-root <repo-root>`，默认密钥记录为 `.doc_project_maintainer/project/audit-signing-key.json`（PROJECT_MAINTAINER_AUDIT_SIGNING_KEY）；当环境变量缺失时脚本加载该工件密钥并在首次使用时创建，预期结果是后续 audit 命令前密钥已就绪。
  - 标注：NOT EXECUTED，本次仅复述文档，未运行。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md:L57–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md#L57-L61)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-audit-integrity-hmac-signing.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L697-L712
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L625-L635
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L654-L663
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L452-L458
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L520-L554
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L175-L180
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L466-L490
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L444-L503
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L537-L560
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L175-L176
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L466-L468
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py:L496-L498
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md:L60-L62
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md:L57-L61
- 源页字段（feature）：audit-integrity-hmac-signing
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py
