---
name: feature-depth-audit-report-html-renderer
description: render_audit_report 实现深读：main 解析 argv、调用 generate_report、成功时打印输出路径 JSON 并本地返回 0；generate_report 读取两份 JSON 工件、构建模型并自行写出 HTML 文件；resolve_paths 在未给 CLI 参数时从 artifact_root/project 取默认路径；read_json 把缺失/非法/非对象 JSON 统一包成 AuditReportError，main 捕获后打印到 stderr 并本地返回 1；完整性刷新子进程以 repo_root 为 cwd 转发 --scope/--report-output/--signing-key-env/--batch-reuse-threshold，非零退出码时返回失败完整性状态；客户端 innerHTML 渲染依赖对每个字段单独调用 escapeHtml 的取舍；文档化的手动运行步骤（未执行）
metadata:
  scope: 只收实现深读（main/generate_report 分工、resolve_paths 默认值、read_json 校验、子进程转发细节、前端渲染取舍、未执行的手动验收记录）；功能概览归 feature-audit-report-html-renderer
---
# 自包含审计可视化 HTML 报告生成器：实现深读

## 现状

- [[feature-audit-report-html-renderer]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main parses argv, renders report, prints JSON output path and returns 0 locally** main(argv) 解析参数并调用 generate_report；成功时打印 json.dumps({"output": ...}) 并 return 0。这是函数局部返回值，不是进程退出码断言。
- 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546–L555
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L546-L555`）
- **generate_report reads two JSON maps and writes the HTML file itself** generate_report(args) resolves paths, reads coverage-map.json and symbol-audit-map.json, builds the model, and writes HTML to the resolved output path (creating parent dirs) before returning that path;
  - main prints {"output": path} JSON on success.
- 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L512–L528
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L512-L528`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546–L555
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L546-L555`）
- **resolve_paths falls back to artifact_root/project defaults when CLI args absent** coverage-map.json、symbol-audit-map.json、audit-integrity-report.json 和 audit-report.html 默认位于 (artifact_root 或 repo_root/DEFAULT_ARTIFACT_ROOT)/project/ 下，显式参数优先。
- 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L42–L53
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L42-L53`）
- **read_json wraps missing, invalid, and non-object JSON as AuditReportError; main prints to stderr and returns 1** FileNotFoundError、JSONDecodeError 及顶层非 dict 分别抛出带 label 与 path 的 AuditReportError；main 捕获后打印到 stderr 并 return 1（局部返回值），否则正常输出。
- 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L30–L39
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L30-L39`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546–L555
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L546-L555`）
- **Integrity refresh subprocess forwarding default flags with repo_root cwd** The renderer invokes a child process via subprocess.run with cwd=paths["repo_root"], forwarding --scope (value ALL_SCOPE), --report-output,
  - --signing-key-env (argparse default "PROJECT_MAINTAINER_AUDIT_SIGNING_KEY") and --batch-reuse-threshold (default 1); on nonzero returncode it returns a failed integrity state instead of the report.
  - Input maps default under artifact_root/project (coverage-map.json, symbol-audit-map.json) when not overridden.
- 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L208–L227
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L208-L227`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L534–L543
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L534-L543`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L42–L50
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L42-L50`）
- **Client-side innerHTML rendering with per-field escapeHtml: interactive at the cost of safety resting on escaping** 设计推断（非作者历史意图）：
- Inference: the report's applyFilters/sortBy/renderTable callbacks do all filtering, sorting and table assembly in the browser by concatenating HTML strings into innerHTML. Benefit: search, risk/status filtering and click-to-sort re-render without any server round trip.
  - Cost: every interpolated field (name, kind, source, line, auditStatus, trustResult, riskLevel, suggestedAction) must pass through escapeHtml individually — one missed field is an injection path, and correctness depends on fields outside the shown span.
- 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L462–L499
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L462-L499`）
- **Documented manual procedure: run render_audit_report.py and treat HTML as presentation-only (NOT EXECUTED)** 文档中的人工验收步骤（本轮未执行）：
- Documented manual steps, NOT EXECUTED: confirm .doc_project_maintainer/project/coverage-map.json and symbol-audit-map.json exist; run `python <skill-dir>/scripts/render_audit_report.py <repo-root>`;
  - the generator refreshes trust classification via audit_integrity.py report unless --skip-integrity-refresh is passed; expected result is project/audit-report.html, a presentation artifact only, with the JSON maps remaining source of truth.
  - If maps are refreshed afterwards, the report reflects older data.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md:L198–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md#L198-L210)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-audit-report-html-renderer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546-L555
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L42-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L30-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L512-L528
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/SKILL.md:L198-L210
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L208-L227
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L534-L543
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L42-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L462-L499
- 源页字段（feature）：audit-report-html-renderer
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py
