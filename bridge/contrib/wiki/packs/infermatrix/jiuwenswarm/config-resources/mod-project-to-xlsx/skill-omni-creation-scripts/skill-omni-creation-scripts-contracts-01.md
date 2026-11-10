---
name: skill-omni-creation-scripts-contracts-01
description: skill-omni-creation-scripts 源码接口与集成边界 01：skills/skill-omni-creation/scripts 下 analyze_video、common、download_images、environment_gate、finalize_scripts、image_review、prepare_images、print_blocks、save_images、scrape_page 十个脚本的静态声明
metadata:
  scope: 只收这十个脚本的函数、类型、导入与常量名称声明，不证明运行行为；入口说明归 skill-omni-creation-scripts-overview
---
# skill-omni-creation-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py`**
- 源码对模块职责的说明：analyze_video.py — 下载视频并进行单阶段粗扫抽帧，供 agent 按顺序分析。
- 调用入口 `probe_duration(video_path)`；声明返回 `float`。
- 调用入口 `choose_fps(duration_seconds)`；声明返回 `float`。
- 调用入口 `extract_frames(video_path, frames_dir, fps)`；声明返回 `list[Path]`。
- 调用入口 `build_review_frames(frames, review_dir)`；声明返回 `list[Path]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import json`；`import logging`；`import subprocess`。
- 模块级配置或常量名称：`BASE_FPS`, `MAX_FRAMES`, `BATCH_SIZE`, `REVIEW_BATCH_STATE`, `REVIEW_PRIMARY_SIZE`, `REVIEW_FALLBACK_SIZE`, `REVIEW_JPEG_QUALITY`, `REVIEW_MIN_QUALITY`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/analyze_video.py#L1-L400)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py`**
- 调用入口 `load_json(path)`；声明返回 `dict`。
- 调用入口 `write_json(path, data)`；声明返回 `None`。
- 调用入口 `strip_json_fence(text)`；声明返回 `str`。
- 调用入口 `encode_b64(data, mime)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import base64`；`import hashlib`；`import json`；`import logging`。
- 模块级配置或常量名称：`STEALTH_UA`, `SUPPORTED_EXTS`, `SUPPORTED_MIMES`, `MIME_TO_EXT`, `MIN_DIMENSION`, `MAX_IMAGE_BYTES`, `FETCH_WORKERS`, `FILTER_BATCH`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py#L1-L454)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py`**
- 源码对模块职责的说明：download_images.py — Download and deduplicate image blocks from stage01.json.。
- 调用入口 `download_image_blocks(blocks)`；声明返回 `tuple[list[dict], dict[str, tuple[bytes, str]]]`。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import hashlib`；`import io`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py#L1-L164)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py`**
- 源码对模块职责的说明：Cross-platform runtime gate for the web/image pipeline.。
- `EnvironmentGateError` 继承 `RuntimeError`。
- 调用入口 `select_interpreter(project_dir, create_venv)`；声明返回 `Path`。
- 调用入口 `ensure_environment(profile, project_dir, auto_install, create_venv, reexec)`；声明返回 `Path`。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import importlib`；`import importlib.util`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py#L1-L466)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/finalize_scripts.py`**
- 源码对模块职责的说明：Finalize generated scripts after verification without blocking SKILL.md creation.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import logging`；`import sys`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/finalize_scripts.py#L1-L105)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/image_review.py`**
- 源码对模块职责的说明：Persist final KEEP/SKIP image decisions and print selected paths.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import json`；`import logging`；`import sys`。
- 模块级配置或常量名称：`ALLOWED`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/image_review.py#L1-L95)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/prepare_images.py`**
- 源码对模块职责的说明：Run the dependent web-image stages sequentially with the current interpreter.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import subprocess`；`import sys`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/prepare_images.py#L1-L33)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py`**
- 源码对模块职责的说明：print_blocks.py — Print stage JSON blocks in a readable format for the agent.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import logging`；`import pathlib`；`import sys`。
- 模块级配置或常量名称：`VIEW_MAX_BLOCKS`, `VIEW_MAX_CHARS`, `VIEW_TEXT_FLOOR`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py#L1-L224)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/save_images.py`**
- 源码对模块职责的说明：save_images.py — Copy agent-selected images to skills/&lt;slug&gt;/references/ and write stage03.json.。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import json`；`import logging`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/save_images.py#L1-L150)。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py`**
- 调用入口 `is_platform_url(url)`；声明返回 `bool`。
- 调用入口 `is_xhs_url(url)`；声明返回 `bool`。
- 调用入口 `fetch_video_title(url, fallback)`；声明返回 `str`。
- 调用入口 `el_text(el)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import asyncio`；`import json`；`import logging`。
- 模块级配置或常量名称：`PLATFORM_PATTERNS`, `XHS_PATTERNS`, `COOKIE_SELECTORS`, `NOISE_IDS`, `NOISE_TABPANEL_LABELS`, `NOISE_CLASSES`, `CUSTOM_EDITOR_CLASSES`, `STRUCTURED_TEXT_LIMITS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L1-L1002)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/skill-omni-creation-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
