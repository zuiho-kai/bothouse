---
name: config-resources-overview-1
description: config-resources 入口索引（1/2）：32 个 skill 脚本与资源子目录链接及以 feature- 开头的功能页链接
metadata:
  scope: 只收 config-resources 的子目录链接与功能页链接；以 feature-depth- 开头的实现深读页链接归 config-resources-overview-2
---
# config-resources（1/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 1/2 部分；第 2 部分 [[config-resources-overview-2]]
- 理解本 owner 的源码职责、接口和集成边界时查这里。源码接口记录是静态契约；功能语义、配置和取舍沿功能页查证。通用审查方法不放在这里。
- [[advanced-daily-report-analyzers-overview]]（advanced-daily-report-analyzers）
- [[advanced-daily-report-collectors-overview]]（advanced-daily-report-collectors）
- [[advanced-daily-report-generators-overview]]（advanced-daily-report-generators）
- [[advanced-daily-report-overview]]（advanced-daily-report）
- [[agent-creator-scripts-overview]]（agent-creator-scripts）
- [[agent-group-creator-scripts-overview]]（agent-group-creator-scripts）
- [[ascend-auto-trace-scripts-overview]]（ascend-moe-optimizer-auto-trace-scripts）
- [[ascend-trace-analyzer-analyzers-overview]]（ascend-moe-optimizer-trace-analyzer-analyzers）
- [[ascend-trace-analyzer-overview]]（ascend-moe-optimizer-trace-analyzer）
- [[baoyu-image-gen-scripts-overview]]（baoyu-image-gen-scripts）
- [[cross-channel-history-scripts-overview]]（cross-channel-history-retrieval-scripts）
- [[delayed-restart-app-overview]]（delayed-restart-app）
- [[docx-pro-scripts-overview]]（docx-pro-scripts）
- [[dynamic-memory-cli-scripts-overview]]（dynamic-memory-cli-scripts）
- [[financial-document-parser-overview]]（financial-document-parser）
- [[gitcode-api-scripts-overview]]（gitcode-api-scripts）
- [[harmonyos-dev-suite-scripts-overview]]（harmonyos-dev-suite-scripts）
- [[huawei-cloud-maas-setup-scripts-overview]]（huawei-cloud-maas-setup-scripts）
- [[local-doc-ocr-scripts-overview]]（local-doc-ocr-scripts）
- [[openjiuwen-deepsearch-scripts-overview]]（openjiuwen-deepsearch-scripts）
- [[plugin-creator-scripts-overview]]（plugin-creator-scripts）
- [[ppt-creation-components-overview]]（ppt-creation-components）
- [[ppt-creation-scripts-overview]]（ppt-creation-scripts）
- [[project-maintainer-scripts-overview]]（project-maintainer-scripts）
- [[rsi-program-dataset-creator-scripts-overview]]（rsi-program-dataset-creator-scripts）
- [[skill-creator-normal-assets-overview]]（skill-creator-normal-assets）
- [[skill-creator-normal-eval-viewer-overview]]（skill-creator-normal-eval-viewer）
- [[skill-creator-normal-scripts-overview]]（skill-creator-normal-scripts）
- [[skill-gen-4-enterprise-doc-scripts-overview]]（skill-gen-4-enterprise-doc-scripts）
- [[skill-omni-creation-scripts-overview]]（skill-omni-creation-scripts）
- [[swarmskill-creator-scripts-overview]]（swarmskill-creator-scripts）
- [[xlsx-scripts-overview]]（xlsx-scripts）
- [[knowledge-config-resources]]（内置日报技能：采集、报告接口与模型配置） — 说明接口、配置与集成边界，关联源码和维护者文档。
- [[feature-agent-template-layered-validation]]（Agent 模板分层校验器（validate_template.py / validate_hot_load_worker.py））
- [[feature-arxiv-visual-extraction-1]]、[[feature-arxiv-visual-extraction-2]]（extract_arxiv_visuals v2.2 — arXiv 论文 Figure/Table 检测与高清导出）
- [[feature-ascend-chrome-trace-generator]]（Chrome Trace JSON 生成器（trace_collector））
- [[feature-ascend-trace-analysis-pipeline-1]]、[[feature-ascend-trace-analysis-pipeline-2]]（ascend-moe-optimizer-trace-analyzer CLI 主流程）
- [[feature-ascend-trace-auto-instrumentation]]（instrument_operator.py：TRACE_POINT 自动埋点改写脚本）
- [[feature-ascend-trace-compile-safety-checker]]（插桩编译安全静态检查器（check_compile_safety.py））
- [[feature-ascend-trace-instrumentation-planner]]（插桩计划生成器（generate_instrumentation_plan.py））
- [[feature-ascend-trace-preprocessor]]（TRACE_POINT 预处理器与 point_map 映射导出（ascend-moe-optimizer-auto-trace skill））
- [[feature-audit-report-html-renderer]]（自包含审计可视化 HTML 报告生成器（render_audit_report.py））
- [[feature-cross-channel-history-search-skill-1]]、[[feature-cross-channel-history-search-skill-2]]（Cross-Channel Session History Search Skill (search_history.py)）
- [[feature-docx-pro-cli]]（docx-pro Word 文档操作 CLI）
- [[feature-financial-document-parser]]（财务文档解析 Skill（financial_parser.py））
- [[feature-github-issue-feedback-script]]（GitHub Issue 反馈创建脚本（open_github_issue.py））
- [[feature-huawei-maas-cdp-authorize]]（华为云 MaaS 委托授权自动化（auto_authorize.py））
- [[feature-huawei-realname-account-check]]（check_account — 华为云账号实名认证状态检测脚本）
- [[feature-maas-auto-open-models]]（华为云 MaaS 预置服务批量开通脚本 auto_open_model.py）
- [[feature-opc-add-slide]]（add_slide.py — 解包 PPTX 幻灯片添加工具）
- [[feature-opc-pack-validate]]（OOXML 打包与 schema 校验（opc/pack.py））
- [[feature-plugin-package-initializer]]（plugin-creator 插件包脚手架初始化（init_plugin.py））
- [[feature-plugin-package-layered-validator-1]]、[[feature-plugin-package-layered-validator-2]]（plugin-creator 插件包分层校验器（validate_plugin.py L0/L1/L2））
- [[feature-ppt-deck-finalize]]（一键成片流水线与质量门禁（finalize_deck.py））
- [[feature-ppt-execution-lock-validator]]（PPT 执行锁（execution-lock.json）语义校验器）
- [[feature-ppt-figure-panel-layout]]（PPT 图表面板布局引擎（figure-panel.js））
- [[feature-ppt-opc-thumbnail]]（Deck Thumbnail Contact-Sheet Renderer (thumbnail.py)）
- [[feature-pptx-structural-audit]]（PPTX 结构与可读性审计脚本（audit_pptx.py 及配套 QA 脚本））
- [[feature-skill-generator-cli-1]]、[[feature-skill-generator-cli-2]]（skill-gen CLI（sop-text / url-fetch 子命令））
- [[feature-skill-page-scrape-blocks-1]]、[[feature-skill-page-scrape-blocks-2]]（skill-omni-creation 网页抓取到统一 Stage01 Blocks（scrape_page））
- [[feature-sop-structure-extraction-1]]、[[feature-sop-structure-extraction-2]]（SOP 结构化抽取（parse_sop_raw_text / parse_sop_file））
- [[feature-video-coarse-scan-frame-extraction]]（analyze_video.py：视频粗扫抽帧与审核批次门控）
- [[feature-xlsx-add-computed-column]]（XLSX Computed Column Adder (xlsx_add_column.py)）
- [[feature-xlsx-formula-check]]（XLSX 公式静态校验（formula_check.py））
- [[feature-xlsx-insert-row]]（XLSX Row Insert with Range Extension（jiuwenswarm skills/xlsx 脚本））
- [[feature-xlsx-reader-structural-diff]]（XLSX 只读结构读取器与编辑损伤差分（xlsx_reader.py））
- [[feature-xlsx-workbook-unpack-repack]]（XLSX Skill 格式保留解包/重打包（xlsx_unpack.py / xlsx_pack.py））
- [[feature-daily-report-skill]]（进阶版日报/周报/月报生成器 Skill（advanced-daily-report））
- [[feature-huawei-maas-apikey-creation]]（华为云 MaaS API Key 自动创建与捕获（auto_create_apikey））
- [[feature-local-doc-ocr-offline-1]]、[[feature-local-doc-ocr-offline-2]]（local-doc-ocr：本地离线 OCR 管线（RapidOCR：PDF/图片 → Markdown））
- [[feature-ppt-evidence-preparation-1]]、[[feature-ppt-evidence-preparation-2]]（prepare_evidence.py — Evidence Plan Preparation and Review Lifecycle）
- [[feature-ppt-system-diagram-renderer]]（PPT 系统架构图原生形状渲染引擎（system-diagram.js））
- [[feature-rsi-dataset-folder-check]]（RSI 数据集任务文件夹完整性预检 check_folder.py）
- [[feature-xlsx-doctor-selfcheck]]（XLSX 技能环境自检（doctor.py））
- [[feature-audit-integrity-hmac-signing]]（符号审计完整性 HMAC 签名与信任验证（audit_integrity.py））
- [[feature-deepsearch-research-pipeline]]（openJiuwen-DeepSearch 深度研究执行管线）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
