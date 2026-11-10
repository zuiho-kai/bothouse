---
name: feature-depth-financial-document-parser
description: 财务文档解析 Skill 实现深读：FinancialParser.parse 后缀分发、main CLI 契约与 --quiet/退出码 1、to_csv 默认路径、pdfplumber/OCR 可选依赖缺失行为、_ocr_pdf 静默返回、SKILL.md CLI 用法（未执行）
metadata:
  scope: 收 financial_parser.py 的实现深读条目（流程、接口、配置、依赖、失败模式、取舍、验证），来源另含 SKILL.md；功能概览归 feature-financial-document-parser
---
# 财务文档解析 Skill（发票/收据/对账单解析与报告生成）：实现深读

## 现状

- [[feature-financial-document-parser]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **FinancialParser.parse: dispatch by file suffix, then post-process and return self.doc** parse() 先检查文件存在,再按后缀分发:.pdf→_parse_pdf,.png/.jpg/.jpeg→_parse_image,.csv→_parse_csv,其余抛 ValueError;之后依次执行 _detect_doc_type/_categorize_items/_generate_insights 并返回 self.doc。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L82–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L82-L103)
- **main 的 CLI 契约：--format 默认 markdown，csv 导出提示受 --quiet 守卫，异常打印 stderr 并 sys.exit(1)** main 接受位置参数 file 与 --format（choices markdown/json/csv/all，默认 markdown）。json/all 分支向 stdout 打印结果；csv 分支调用 to_csv(args.output)，仅当未传 --quiet 时才向 stderr 打印「已导出到」路径。
  - try 块（532–550）内的任何 Exception 被捕获，打印「错误: {e}」到 stderr 后 sys.exit(1)；argparse 解析（527）不在此守卫内。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L507–L554](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L507-L554)
- **--format 默认 markdown;to_csv 无 output 时回退为输入文件同目录 .csv 后缀** --format/-f 的 choices 为 markdown/json/csv/all,默认 'markdown';--output 仅用于 csv。to_csv(output_path=None) 时 final_path 取 self.file_path.with_suffix('.csv')。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L521–L525](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L521-L525),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L421–L425](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L421-L425)
- **pdfplumber 与 pdf2image/pytesseract 为 try/except ImportError 探测的可选依赖，缺失时 PDF 抛错、图片抛错、_ocr_pdf 静默返回** 模块导入处用 try/except ImportError 设置 HAS_PDFPLUMBER/HAS_OCR 标志。_parse_pdf 在无 pdfplumber 时抛 ImportError（提示 pip install pdfplumber）；_parse_image 在无 OCR 依赖时抛 ImportError；
  - _ocr_pdf 在无 OCR 依赖时直接 return，不写 raw_text。OCR 语言固定为 chi_sim+eng（140–144 行的 PDF 路径与 157 行的图片路径均可见）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L17–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L17-L29),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L105–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L105-L108),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L135–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L135-L158)
- **缺 OCR 依赖时 _parse_image 抛 ImportError,而 _ocr_pdf 静默返回** _parse_image 在 HAS_OCR 为 False 时抛 ImportError('需要安装 OCR 依赖: pip install pdf2image pytesseract');_ocr_pdf 在同一守卫下直接 return,不报错也不填充 raw_text。main 捕获异常后以退出码 1 终止进程。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L135–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L135-L153),
  - [jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L532–L554](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L532-L554)
- **_ocr_pdf 在 HAS_OCR 为假时静默返回：本函数不崩溃，但也跳过 OCR 文本提取** 设计推断（非作者历史意图）：
- 在 _ocr_pdf 内部，HAS_OCR 为假时函数直接 return，不执行 convert_from_path、raw_text 赋值或 _extract_fields_from_text；好处是缺少 OCR 依赖时本函数不抛异常，代价是本函数内对扫描内容的文本提取被静默跳过（调用方后果未在所示行中体现）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L135–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py#L135-L148)
- **SKILL.md 记录的 CLI 命令用法（文档化手工流程，未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 的命令行用法小节给出可直接运行的验证操作：`python financial_parser.py invoice.pdf` 输出 Markdown 报告，`--format json` 输出 JSON，`--format csv` 导出 CSV，`--format all` 输出 Markdown+JSON；并给出 receipt.jpg 图片收据与 statement.csv 银行对账单示例。上述为文档记载的操作与预期输出，本次未执行（NOT EXECUTED）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/SKILL.md:L24–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/SKILL.md#L24-L46)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-financial-document-parser.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L82-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L507-L554
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L521-L525
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L421-L425
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L17-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L105-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L135-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L135-L153
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L532-L554
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py:L135-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/SKILL.md:L24-L46
- 源页字段（feature）：financial-document-parser
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/financial-document-parser/financial_parser.py
