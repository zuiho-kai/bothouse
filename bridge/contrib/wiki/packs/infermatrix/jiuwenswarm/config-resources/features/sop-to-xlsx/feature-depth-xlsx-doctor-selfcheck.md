---
name: feature-depth-xlsx-doctor-selfcheck
description: doctor.py 实现深读：main 按 required 失败返回 0/1、--json 唯一显式开关、importlib/shutil.which/fc-list 探测、失败路径与回退扫描、不验证字形覆盖的取舍、SKILL.md 手工自检（未执行）
metadata:
  scope: 收 doctor.py 的实现细节（main、CLI、探测方式、失败路径、字体回退取舍、手工验证记载），来源另含 SKILL.md；功能概览归 feature-xlsx-doctor-selfcheck
---
# XLSX 技能环境自检（doctor.py）：实现深读

## 现状

- [[feature-xlsx-doctor-selfcheck]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main 顺序执行四类检查并按 required 失败决定返回值** main() 依次调用 check_python/check_py_deps/check_cli/check_cjk_font 填充 results；若没有任何 required 且 not ok 的项则局部返回 0，否则返回 1，由 __main__ 的 sys.exit 传出。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L104–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L104-L134)
- **doctor.py 命令行入口：--json 为唯一显式新增选项，输出两种格式并由 main 返回 0/1** 用法为 python3 doctor.py [--json]（L8–L11；argparse 默认还会提供 -h/--help）。默认打印人类可读的 PASS/FAIL/warn 报告；--json 时打印 {"ok":…,"results":[…]} 的 JSON（L118–L119）。main 在无必需项失败时返回 0，否则返回 1（L130），由 L133–L134 的 sys.exit 传出。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L8–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L8-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L105–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L105-L107),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L118–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L118-L130),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L133–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L133-L134)
- **依赖检测：Python 模块用 importlib 探测，CLI 工具用 shutil.which，字体依赖 fc-list** check_py_deps 通过 importlib.import_module 逐个导入并读取 __version__（L51–L55）；check_cli 用 shutil.which 查找可执行文件（L64–L71）；check_cjk_font 在 fc-list 存在时调用 "fc-list :lang=zh family"（超时 20 秒）获取字体族（L77–L83）。
  - 若该调用抛出 Exception，会继续走 L86–L93 的回退扫描，因此单次 fc-list 失败不一定导致字体检查失败。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L50–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L50-L61),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L64–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L64-L71),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L74–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L74-L93)
- **失败路径：模块导入抛 Exception 记录 pip 安装提示；字体未找到时记录诊断并计为必需失败** 导入失败时 except Exception 捕获，detail 写入 "missing (…); install: pip install <包名>"（L56–L61）。字体检查在 zh 查询无结果或抛异常且 fc-list 可用时，回退到全字体列表中按 CJK_FONT_HINTS 子串匹配（L86–L93）；
  - 仍无结果则 ok=False、required=True，detail 提示安装 google-noto-sans-cjk-fonts 并警告中文将渲染为方框（L94–L101）。任一 required 项 ok=False 使 main 返回 1（L115–L116、L130）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L56–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L56-L61),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L86–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L86-L101),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L115-L116)
- **取舍：字体回退扫描用名称子串匹配，换取无 zh 元数据时的可用性，但不验证字形覆盖** 设计推断（非作者历史意图）：
- 推断：当 fc-list :lang=zh 无结果时，回退仅检查全字体列表是否包含 CJK_FONT_HINTS 中的名称子串（L88–L91），只要字体名命中即可通过（L94–L96）。好处是缺少语言元数据的系统仍能检出 CJK 字体；代价是该路径不确认字体实际覆盖中文字形。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L34–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L34-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L86–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L86-L96)
- **doctor.py 仅显式注册 --json 开关，检查清单由模块常量硬编码** main() 用 argparse 只显式注册 --json（store_true），必需项清单硬编码在模块常量：PY_DEPS 中 openpyxl、pandas required=True 而 lxml 为 False；CLI_TOOLS 中 soffice（libreoffice）与 pdftoppm（poppler-utils）均 required=True；CJK_FONT_HINTS 十个字体名任一命中即足够。
  - L115–L116 显示仅 required 且 not ok 的项影响整体 ok。argparse 自身还附带默认帮助行为，此处不计入显式注册项。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L20–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L20-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L104–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L104-L107),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L115-L116)
- **SKILL.md 记录的自检运行步骤与 doctor.py 文档化的退出码约定（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 记录一次性环境自检命令 `python3 SKILL_DIR/scripts/doctor.py`（检查 python、openpyxl、libreoffice、poppler 及 CJK 字体）；doctor.py 文档字符串声明用法 `python3 doctor.py [--json]`，退出码 0 表示全部必需检查通过、1 表示有必需项缺失。这是文档化手工流程，本次未执行，不构成已通过的运行时验证。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L26–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L26-L28),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L8–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py#L8-L12)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-xlsx-doctor-selfcheck.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L104-L134
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L8-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L105-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L118-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L133-L134
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L50-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L64-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L74-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L56-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L86-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L115-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L34-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L86-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L20-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L104-L107；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L26-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py:L8-L12
- 源页字段（feature）：xlsx-doctor-selfcheck
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/doctor.py
