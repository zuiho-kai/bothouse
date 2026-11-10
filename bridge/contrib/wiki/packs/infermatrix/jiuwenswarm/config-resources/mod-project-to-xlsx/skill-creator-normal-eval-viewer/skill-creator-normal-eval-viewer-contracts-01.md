---
name: skill-creator-normal-eval-viewer-contracts-01
description: skill-creator-normal-eval-viewer 源码接口记录 01：skill-creator-normal 的 eval-viewer（generate_review.py 与 viewer.html）；覆盖 generate_review.py、viewer.html
metadata:
  scope: 只收 skill-creator-normal-eval-viewer 下这 2 个源文件的逐文件接口记录；本目录入口归 skill-creator-normal-eval-viewer-overview
---
# skill-creator-normal-eval-viewer 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/eval-viewer/generate_review.py`**
- 源码对模块职责的说明：Generate and serve a review page for eval results.。
- 调用入口 `get_mime_type(path)`；声明返回 `str`。
- 调用入口 `find_runs(workspace)`；声明返回 `list[dict]`。
- 调用入口 `build_run(root, run_dir)`；声明返回 `dict / None`。
- 调用入口 `embed_file(path)`；声明返回 `dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import base64`；`import json`；`import logging`。
- 模块级配置或常量名称：`METADATA_FILES`, `TEXT_EXTENSIONS`, `IMAGE_EXTENSIONS`, `MIME_OVERRIDES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/eval-viewer/generate_review.py#L1-L609)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/eval-viewer/viewer.html`**
- 源码声明的类型、组件或调用边界：`hasPrevious`, `resp`, `data`, `r`, `textarea`, `saveTimeout`, `navigate`, `newIndex`；这是词法声明索引，不把局部变量当成对外导出 API。
- 页面装配边界：body, link, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/eval-viewer/viewer.html#L1-L1325)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/skill-creator-normal-eval-viewer/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
