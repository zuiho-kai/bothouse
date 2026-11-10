---
name: feature-depth-local-doc-ocr-offline
description: local-doc-ocr 实现深读：ocr_offline.py main 流程与 _ensure_deps 忽略返回值、write_ocr_md.py JSON 输入契约、pdf_to_images 默认 dpi/tiles 与页范围、清华镜像安装顺序、ensure_deps all() 短路、SKILL.md 手动验证（未执行）
metadata:
  scope: 只收 local-doc-ocr 的实现深读条目（流程、接口、配置默认值、依赖安装、失败模式、取舍、验证）；功能概览归 feature-local-doc-ocr-offline-1、feature-local-doc-ocr-offline-2
---
# 本地离线 OCR 管线（RapidOCR：PDF/图片 → Markdown）：实现深读

## 现状

- [[feature-local-doc-ocr-offline-1]]、[[feature-local-doc-ocr-offline-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **ocr_offline.py main：解析参数 → 依赖自检 → 条件导入 RapidOCR → 构建引擎** main() 先 argparse 解析 input/-o/-d/--no-preprocess/--start-page/--end-page/--boxes-json，调用 _ensure_deps()（返回值被忽略），随后 try 导入 rapidocr_onnxruntime.RapidOCR，导入成功则打印加载提示并构造 engine = RapidOCR()；
  - 再依据 args.out 是否为空决定默认输出名（目录输入时 out_md = <目录>/<stem>_OCR.md）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L129–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L129-L166)
- **write_ocr_md.py 的 JSON 输入契约与缺省输出命名** main() 接受 JSON 文件路径或 '-'（读 stdin），json.loads 后交给 build_md(data)。data 缺省 source 为「（未知来源）」、engine 为「多模态读图（本机模型）」、pages 为空列表；每页 label 缺省「未命名」、text 缺省空串（空文本渲染为「（本页未识别到内容）」）。未指定 -o 时按 source 同名生成 _OCR.md（stdin 时固定 ocr_OCR.md），写入后打印 DONE 行。调用方需提供可解析的 JSON。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py:L22–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py#L22-L48),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py:L51–L72](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py#L51-L72)
- **pdf_to_images 默认 dpi=300、tiles=0，页范围由 render_one 夹紧** argparse 默认 `-d/--dpi` 为 300、`-t/--tiles` 为 0（不切块）、`--start-page`/`--end-page` 为 None；render_one 内 `s = max(1, start_page or 1)`、`e = min(n, end_page or n)`，未指定时覆盖第 1 页到末页，输出目录默认在 PDF 同目录建 `<文件名>_pages`。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py:L74–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py#L74-L92),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py:L30–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py#L30-L36)
- **依赖自检异常仅告警返回 False；rapidocr 导入失败才 sys.exit(1)** ocr_offline._ensure_deps 捕获任何异常后 stderr 写 [warn] 并返回 False；main() L148 调用时不接收返回值，真正的退出分支是 L150-155 的 ImportError：打印 ERROR 与 pip install -r requirements.txt 提示并 sys.exit(1)。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L22–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L22-L29),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L147–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L147-L155)
- **清华镜像优先、CalledProcessError 后无 -i 重试的安装顺序** 设计推断（非作者历史意图）：
- _install_one 按 _MIRRORS 顺序尝试：先带 `-i https://pypi.tuna.tsinghua.edu.cn/simple`，仅当 subprocess.run(check=True) 抛 CalledProcessError 时换下一个源；第二个源命令不带 -i，实际来源由本机 pip 配置决定，代码不保证官方 PyPI。每次命令固定 `--retries 5 --timeout 60`。收益（推断）：国内镜像通常更快；代价：首个源非退出码失败（如网络异常抛其他异常）不触发兜底，直接传播。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L20–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py#L20-L38)
- **ensure_deps 白名单依赖检测与 all() 短路自动安装** ocr_offline 的 main 调 _ensure_deps() 但忽略其返回值，随后自行尝试 from rapidocr_onnxruntime import RapidOCR，ImportError 时打印安装提示并以 sys.exit(1) 退出（ocr_offline.py:L147–L155）。_ensure_deps 导入 setup 并返回 setup.ensure_deps()，任何异常仅写 stderr 告警并返回 False（L22–L29）。
  - ensure_deps 用 importlib.util.find_spec 按 PACKAGES（rapidocr_onnxruntime/pymupdf/pillow/numpy）检测缺失；L50 的 all(_install_one(pkg) for pkg in missing) 因生成器短路，某个包安装返回假值后其余缺失包不再尝试安装，此时仅打印手动 pip install 提示并返回 False（setup.py:L41–L55、L13–L18）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L147–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L147-L155),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L22–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py#L22-L29),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L41–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py#L41-L55),
  - [jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L13–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py#L13-L18)
- **SKILL.md 记录的两条手动验证命令（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md「快速验证」给出两条手动命令及预期结果：路线 A 运行 python scripts/ocr_offline.py "测试.pdf" 直接产出 Markdown；路线 B 运行 python scripts/pdf_to_images.py "测试.pdf" -o "./pages" 先渲染，再由多模态 Agent 读取 ./pages/page_01.png 验证。这是文档记载的手动流程，本次未执行；所供证据中未展示针对该功能的自动化断言。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/SKILL.md:L135–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/SKILL.md#L135-L143)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-local-doc-ocr-offline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py:L74-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py:L30-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L129-L166
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L22-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py:L147-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py:L22-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py:L51-L72
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L20-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L41-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py:L13-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/SKILL.md:L135-L143
- 源页字段（feature）：local-doc-ocr-offline
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/ocr_offline.py；jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/write_ocr_md.py；jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/preprocess_img.py
  - jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/pdf_to_images.py；jiuwenswarm/resources/agent/workspace/skills/local-doc-ocr/scripts/setup.py
