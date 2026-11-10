---
name: config-resources-overview-2
description: config-resources 入口索引（2/2）：以 feature-depth- 开头的实现深读页链接
metadata:
  scope: 只收实现深读页链接；子目录与功能页链接归 config-resources-overview-1
---
# config-resources（2/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 2/2 部分；第 1 部分 [[config-resources-overview-1]]
- [[feature-depth-agent-template-layered-validation]]（Agent 模板分层校验器（L0 规范 / L1 静态 AST / L2 子进程编排）：实现深读）
- [[feature-depth-arxiv-visual-extraction]]（arXiv 论文 Figure/Table 检测与高清导出（extract_arxiv_visuals）：实现深读）
- [[feature-depth-ascend-chrome-trace-generator]]（Chrome Trace JSON 生成器（trace_collector）：实现深读）
- [[feature-depth-ascend-trace-analysis-pipeline]]（ascend-moe-optimizer-trace-analyzer CLI 主流程：实现深读）
- [[feature-depth-ascend-trace-auto-instrumentation]]（TRACE_POINT 自动埋点改写（instrument_operator）：实现深读）
- [[feature-depth-ascend-trace-compile-safety-checker]]（插桩编译安全静态检查器：实现深读）
- [[feature-depth-ascend-trace-instrumentation-planner-1]]、[[feature-depth-ascend-trace-instrumentation-planner-2]]（插桩计划生成器（调用图深度受限展开）：实现深读）
- [[feature-depth-ascend-trace-preprocessor]]（TRACE_POINT 预处理器与 point_map 映射导出：实现深读）
- [[feature-depth-audit-integrity-hmac-signing]]（符号审计完整性 HMAC 签名与信任验证（audit_integrity.py）：实现深读）
- [[feature-depth-audit-report-html-renderer]]（自包含审计可视化 HTML 报告生成器：实现深读）
- [[feature-depth-cross-channel-history-search-skill]]（Cross-Channel Session History Search Skill：实现深读）
- [[feature-depth-daily-report-skill]]（进阶版日报/周报/月报生成器 Skill：实现深读）
- [[feature-depth-deepsearch-research-pipeline]]（openJiuwen-DeepSearch 深度研究执行管线：实现深读）
- [[feature-depth-docx-pro-cli]]（docx-pro Word 文档操作 CLI：实现深读）
- [[feature-depth-financial-document-parser]]（财务文档解析 Skill（发票/收据/对账单解析与报告生成）：实现深读）
- [[feature-depth-github-issue-feedback-script]]（GitHub Issue 反馈创建脚本：实现深读）
- [[feature-depth-huawei-maas-apikey-creation]]（华为云 MaaS API Key 自动创建与捕获（auto_create_apikey）：实现深读）
- [[feature-depth-huawei-maas-cdp-authorize]]（华为云 MaaS 委托授权自动化（auto_authorize）：实现深读）
- [[feature-depth-huawei-realname-account-check]]（华为云账号实名认证状态检测（check_account）：实现深读）
- [[feature-depth-local-doc-ocr-offline]]（本地离线 OCR 管线（RapidOCR：PDF/图片 → Markdown）：实现深读）
- [[feature-depth-maas-auto-open-models]]（华为云 MaaS 预置服务批量开通自动化（CDP）：实现深读）
- [[feature-depth-opc-add-slide]]（解包 PPTX 幻灯片添加工具（opc/add_slide.py）：实现深读）
- [[feature-depth-opc-pack-validate]]（OOXML 打包与 schema 校验（opc/pack.py）：实现深读）
- [[feature-depth-plugin-package-initializer]]（plugin-creator 插件包脚手架初始化：实现深读）
- [[feature-depth-plugin-package-layered-validator]]（plugin-creator 插件包分层校验器（L0/L1/L2）：实现深读）
- [[feature-depth-ppt-deck-finalize]]（一键成片流水线与质量门禁（finalize_deck.py）：实现深读）
- [[feature-depth-ppt-evidence-preparation]]（Evidence Plan Preparation and Review Lifecycle：实现深读）
- [[feature-depth-ppt-execution-lock-validator]]（PPT 执行锁（execution-lock.json）语义校验器：实现深读）
- [[feature-depth-ppt-figure-panel-layout]]（PPT 图表面板布局引擎（figure-panel.js）：实现深读）
- [[feature-depth-ppt-opc-thumbnail]]（Deck Thumbnail Contact-Sheet Renderer：实现深读）
- [[feature-depth-ppt-system-diagram-renderer]]（PPT 系统架构图原生形状渲染引擎：实现深读）
- [[feature-depth-pptx-structural-audit]]（PPTX 结构与可读性审计脚本：实现深读）
- [[feature-depth-rsi-dataset-folder-check]]（RSI 数据集任务文件夹完整性预检：实现深读）
- [[feature-depth-skill-generator-cli-1]]、[[feature-depth-skill-generator-cli-2]]、[[feature-depth-skill-generator-cli-3]]（skill-gen CLI（sop-text / url-fetch 子命令）：实现深读）
- [[feature-depth-skill-page-scrape-blocks]]（Web Page Scraping to Unified Stage01 Blocks：实现深读）
- [[feature-depth-sop-structure-extraction]]（SOP 结构化抽取（parse_sop_raw_text / parse_sop_file）：实现深读）
- [[feature-depth-video-coarse-scan-frame-extraction]]（视频粗扫抽帧与审核批次门控（analyze_video.py）：实现深读）
- [[feature-depth-xlsx-add-computed-column]]（XLSX Computed Column Adder：实现深读）
- [[feature-depth-xlsx-doctor-selfcheck]]（XLSX 技能环境自检（doctor.py）：实现深读）
- [[feature-depth-xlsx-formula-check]]（XLSX 公式静态校验（formula_check.py）：实现深读）
- [[feature-depth-xlsx-insert-row]]（XLSX Row Insert with Range Extension：实现深读）
- [[feature-depth-xlsx-reader-structural-diff]]（XLSX Read-Only Structure Reader and Edit-Damage Differ：实现深读）
- [[feature-depth-xlsx-workbook-unpack-repack]]（XLSX Skill Format-Preserving Unpack/Repack：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
