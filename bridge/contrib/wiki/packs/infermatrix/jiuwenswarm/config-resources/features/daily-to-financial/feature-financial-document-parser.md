---
name: feature-financial-document-parser
description: 财务文档解析 Skill（financial_parser.py）功能概览：FinancialParser 库层与 CLI 入口及输出契约、PDF/图片/CSV 解析管线、CATEGORY_KEYWORDS 与可选依赖探测、Markdown/JSON/CSV 报告、可选依赖降级取舍
metadata:
  scope: 只收 financial_parser.py 的功能概览（验证入口、入口与输出契约、解析管线、配置面、支持的行为、设计取舍）；实现深读归 feature-depth-financial-document-parser
---
# 财务文档解析 Skill（financial_parser.py）

## 现状

- **验证入口**
- 所示代码中没有测试；文件自带 `if __name__ == '__main__': main()` 入口，可通过 CLI 对样例文件手工验证（epilog 中列了 invoice.pdf/receipt.jpg/statement.csv 示例），`--format json` 便于检查结构化字段。错误路径（缺文件、不支持格式、缺依赖）会以 stderr 消息和退出码 1 显现。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L508–L518](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L508-L518),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L552–L558](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L552-L558)
- **公共入口与输出契约**
- 组件提供两层入口。库层为 `FinancialParser(file_path)`，核心方法是 `parse()`，返回 `FinancialDocument` 数据类；实例方法 `to_dict()`/`to_json()`/`to_csv()`/`to_markdown()` 提供四种导出，`to_csv()` 未指定路径时默认写回源文件同名的 .csv。CLI 层为 `main()`：位置参数 `file`，`--format/-f`（markdown/json/csv/all，默认 markdown）、`--output/-o`（仅 csv 用）、`--quiet/-q`。
  - 处理块（构造、parse、导出）内的异常被捕获并打印到 stderr 后以退出码 1 结束；参数解析本身在 try 块之外。缺失依赖的行为按输入类型区分：图片缺 OCR 依赖时抛 ImportError，扫描版 PDF 缺 OCR 时静默跳过 OCR，CSV 不依赖任何可选库。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L78–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L78-L103),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L411–L439](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L411-L439),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L507–L554](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L507-L554)
- **解析管线与数据流**
- `parse()` 按文件后缀分派：PDF 走 pdfplumber 提取文本与表格（无文本且具备 OCR 依赖时对扫描件做 Tesseract OCR），图片走 OCR，CSV 用 DictReader 逐行读入并求和为 Statement；随后统一执行后处理——`_detect_doc_type()` 关键词判定类型、`_categorize_items()` 关键词分类、`_generate_insights()` 生成洞察与标记。
  - 字段提取是混合策略：发票号、供应商、日期、金额、税额用多组正则（首个匹配生效），货币用子串检查（USD/EUR/CNY 符号），PDF 表格则按表头关键词定位描述/数量/单价/金额列后取数。未提取到小计时按 total/tax 推算。结果最终由 to_* 方法渲染为报告。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L82–L133](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L82-L133),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L174–L231](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L174-L231),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L367–L409](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L367-L409)
- **配置面**
- 该脚本没有配置文件或环境变量，可调项只有 CLI 参数（`--format`、`--output`、`--quiet`）和代码内的类级常量：`CATEGORY_KEYWORDS` 定义八个费用类别及其中英文关键词（Software/Office/Travel/Meals/Utilities/Marketing/Professional/Equipment），未命中关键词的行项目归为 "Other"。
  - 运行时能力由可选依赖的导入探测决定：pdfplumber 与 pdf2image+pytesseract 分别以 try/except 探测，`FinancialDocument` 的默认值（currency="CNY"、各金额 0.0）构成隐含行为基线。洞察逻辑中的大额阈值 10000 也是硬编码。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L17–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L17-L29),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L45–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L45-L76),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L521–L525](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L521-L525)
- **支持的行为**
- 支持三类输入：PDF（文本层提取 + 表格提取，文本为空且 OCR 可用时回退到 chi_sim+eng OCR）、PNG/JPG/JPEG 图片（OCR，缺依赖时抛 ImportError）、CSV 对账单（识别 描述/description/摘要 与 金额/amount 列）。后处理产出：文档类型判定（Invoice/Receipt/Statement/Expense Report）、行项目费用分类、洞察（最大支出类别、可抵扣税额）与标记（金额超过 10000 的大额交易）。
  - 报告输出 Markdown（含明细表、分类汇总、洞察、需关注项）、JSON、CSV（utf-8-sig，含日期/供应商/描述/类别/金额/可抵税列）三种形式。注意：缺 pdfplumber 时 PDF 解析抛 ImportError，但缺 OCR 依赖的扫描版 PDF 不报错而是跳过 OCR 继续提取。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L105–L172](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L105-L172),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L390–L409](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L390-L409),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L441–L504](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L441-L504)
- **设计取舍：可选依赖的优雅降级与规则化提取的精度边界**
- Inference / 设计推断（非作者历史意图）：
- 解析器以可选依赖探测换取部署便利：pdfplumber 与 pdf2image+pytesseract 在导入期用 try/except 探测（L17-L29），缺 pdfplumber 解析 PDF 会抛 ImportError，但扫描版 PDF 在无 OCR 依赖时不报错而是静默跳过 OCR 继续（L127-L129、L137-L138），代价是文本层为空的扫描件会以空 raw_text 走完后续流程。
  - 字段提取采用规则化正则/关键词而非模型：发票号、日期、金额等各维护多组模式以覆盖常见中英文版式（如 L181-L186、L212-L218、L234-L240），但未覆盖的格式变化可能漏提；规则中的阈值与展示也偏硬编码——大额交易固定以 10000 判定（L404-L405），Markdown 报告的金额一律以 ¥ 前缀渲染（L451、L464、L470-L472），与 L226-L231 可能识别出的 USD/EUR 币种不一致。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L17–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L17-L29),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L127–L129](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L127-L129),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L212–L218](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L212-L218),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L404–L409](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L404-L409)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-financial-document-parser.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L508-L518
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L552-L558
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L78-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L411-L439
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L507-L554
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L82-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L174-L231
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L367-L409
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L17-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L45-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L521-L525
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L105-L172
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L390-L409
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L441-L504
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L127-L129
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L212-L218
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L404-L409
- 源页字段（feature）：financial-document-parser
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py
