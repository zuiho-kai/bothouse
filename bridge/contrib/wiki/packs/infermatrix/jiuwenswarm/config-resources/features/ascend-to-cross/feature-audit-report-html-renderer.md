---
name: feature-audit-report-html-renderer
description: render_audit_report.py 功能概览：必填位置参数 repo_root、成功时打印 output 路径的 JSON 并返回 0、输入读取失败统一抛 AuditReportError 并以退出码 1 结束的错误契约、normalize_symbol+priority_score 风险评分与单文件 HTML 的交互视图（scope 切换/搜索/过滤/排序/top-10/scope 树）、--coverage-map/--audit-map/--integrity-report-output/--output/--artifact-root 等路径覆盖与 --scope（default_health_audit/all）、safe_json_for_script 转义内嵌与完整性刷新子进程失败时降级为 warning 继续生成报告（integrity_report 为 None 时 trustResult 默认 unverified）的取舍、generate_report 的 JSON 工件到单文件 HTML 数据流、read_json 的运行时输入校验
metadata:
  scope: 只收功能概览（CLI/错误契约、评分与交互视图、路径覆盖、取舍、数据流、输入校验）；实现深读（main/generate_report 分工、resolve_paths 默认值、子进程转发参数细节）归 feature-depth-audit-report-html-renderer
---
# 自包含审计可视化 HTML 报告生成器（render_audit_report.py）

## 现状

- **命令行入口与错误契约**
- 组件以 CLI 脚本暴露：必填位置参数 `repo_root`，输出为单个自包含 HTML 文件；成功时向 stdout 打印 `{"output": <路径>}` 并返回 0（render_audit_report.py:546-555）。输入读取失败（文件缺失、JSON 非法、非对象）统一抛 `AuditReportError`，main 捕获后写入 stderr 并返回退出码 1（22-39, 549-553）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546–L555
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L546-L555`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L22–L39
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L22-L39`）
- **风险评分与交互式报告视图**
- 每个符号经 `normalize_symbol` 合并审计数据与完整性记录，`priority_score` 按信任失败码（如 integrity_mismatch 记 1000）、问题严重度（critical 900…low 200）、审计状态与健康度取最大值定分，映射 high/medium/low/none 风险并生成 dangerReason 与 suggestedAction（82-112, 147-176）。
  - 生成的单文件 HTML 内嵌模型 JSON 与原生 JS，提供 scope 切换、搜索、风险/状态过滤、可点击排序的明细表、top-10 优先视图和按源码路径的 scope 树（462-505）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L82–L112
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L82-L112`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L147–L176
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L147-L176`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L462–L505
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L462-L505`）
- **CLI 参数、默认值与覆盖顺序**
- `repo_root` 是必填位置参数，没有默认值；其余文件路径默认挂在 `<repo_root>/.doc_project_maintainer/project/` 下（coverage-map.json、symbol-audit-map.json、audit-integrity-report.json、audit-report.html），可分别用 `--coverage-map/--audit-map/--integrity-report-output/--output/--artifact-root` 覆盖。
  - `--scope` 仅接受 default_health_audit 或 all，默认前者；`--skip-integrity-refresh` 为开关；`--signing-key-env` 默认 `PROJECT_MAINTAINER_AUDIT_SIGNING_KEY`，`--batch-reuse-threshold` 默认 1，两者仅透传给完整性子进程。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L42–L53
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L42-L53`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L531–L543
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L531-L543`）
- **自包含单文件与部分失败隔离**
- Inference / 设计推断（非作者历史意图）：
- 选择单文件自包含 HTML：模型 JSON 经 `safe_json_for_script` 转义 `< > &` 后内嵌 `<script>`，前端渲染再统一 `escapeHtml`，无需服务器即可离线交互（328-371, 423-428, 456-492）。
  - 代价是完整性刷新的失败隔离只做了一半：子进程非零退出或输出非法 JSON 时继续生成报告并把状态行标为 warning（502-504），此时 integrity_report 为 None，查表为空，所有符号的 trustResult 默认 "unverified"、closureEligible 为 false（179-185, 167-169）——即降级为未验证而非使用旧数据；且 `subprocess.run` 本身未捕获启动异常（217-223）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L365–L371
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L365-L371`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L217–L247
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L217-L247`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L147–L176
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L147-L176`）
- **职责与数据流：JSON 工件到单文件 HTML**
- 该脚本是 Project Maintainer 技能内的独立 CLI 渲染器，职责边界清晰：不产出审计数据，只消费既有 JSON 工件。
  - 数据流为：`generate_report` 先解析路径并读取 coverage-map.json 与 symbol-audit-map.json（512-516），随后可选地以子进程方式调用同目录的 `audit_integrity.py report` 刷新完整性报告（188-216），再把符号记录与完整性记录按 id 合并、评分，组装为 schema 为 `project-maintainer.audit-visual-report.v1` 的模型（147-176, 318-362），
  - 最后经 `safe_json_for_script` 转义后内嵌到无外部依赖的 HTML/JS 模板中写出（374-376, 512-528）。交互层（scope 切换、过滤、排序、scope 树）全部由内嵌原生 JS 在浏览器端完成，Python 侧不做请求处理。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L512–L528
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L512-L528`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L188–L216
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L188-L216`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L318–L362
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L318-L362`）
- **运行时输入校验与完整性子进程检查**
- 该脚本在所示源码中没有独立的自动化测试入口，验证以运行时守卫（runtime guards）形式内建。`read_json` 读取 coverage-map.json 与 symbol-audit-map.json 时捕获 FileNotFoundError 与 json.JSONDecodeError 并校验顶层必须是 JSON 对象，统一转为用户可见的 `AuditReportError`，由 `main` 打印到 stderr 并以退出码 1 结束（30-39, 546-555）。
  - 对完整性刷新子进程 `audit_integrity.py report`，代码检查 returncode 非零和 stdout 非法 JSON 两种失败，均不抛异常而是降级为 `status: failed` 的完整性状态继续生成报告（217-247），浏览器端状态行据此显示警告（502-504）。这些是执行期守卫而非测试；本仓库所示输入中未出现针对该脚本的 pytest 用例或测试文件。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L30–L39
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L30-L39`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546–L555
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L546-L555`）,
  - jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L217–L247
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L217-L247`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-audit-report-html-renderer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L546-L555
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L22-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L82-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L147-L176
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L462-L505
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L42-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L531-L543
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L365-L371
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L217-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L512-L528
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L188-L216
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L318-L362
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py:L30-L39
- 源页字段（feature）：audit-report-html-renderer
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py
