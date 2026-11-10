---
name: packaging-deploy-scripts-contracts-01-1
description: scripts/ 构建脚本源码接口第 1 部分：build-electron-exe、build-exe、build-harmony*、build-macos、build-runtimes、build.ps1/sh、build_config.py
metadata:
  scope: 只收 build_config.py 及之前的脚本；build_python_packages.py 起至 reset_trajectory_data.py 归 packaging-deploy-scripts-contracts-01-2，verify 与 playwright 脚本归 packaging-deploy-scripts-contracts-02
---
# scripts 源码接口与集成边界 01（1/2）

## 现状

- 拆分说明：本页是源页 `source-contracts-01.md` 的第 1/2 部分；第 2 部分 [[packaging-deploy-scripts-contracts-01-2]]
- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`scripts/build-electron-exe.ps1`**
- 脚本执行边界：`uv sync --extra dev --extra claude --extra codex`；`npm install`；`npm run build`；`npm install`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.ps1#L1-L398)。
- **`scripts/build-exe.ps1`**
- 脚本执行边界：`uv sync --extra dev`；`npm install`；`npm run build`；`uv run pyinstaller scripts\jiuwenswarm.spec --noconfirm`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-exe.ps1#L1-L187)。
- **`scripts/build-harmony-hap.sh`**
- 源码声明的类型、组件或调用边界：`fs`, `srcFile`, `destFile`, `content`, `obj`, `obj`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require('fs');`。
- 脚本执行边界：`npm install 2&gt;&1 // {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-harmony-hap.sh#L1-L563)。
- **`scripts/build-harmony.sh`**
- 源码声明的类型、组件或调用边界：`d`；这是词法声明索引，不把局部变量当成对外导出 API。
- 脚本执行边界：`npm install`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-harmony.sh#L1-L218)。
- **`scripts/build-macos.sh`**
- 脚本执行边界：`uv sync --extra dev`；`npm install`；`npm run build`；`uv run pyinstaller scripts/jiuwenswarm.spec --noconfirm`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-macos.sh#L1-L237)。
- **`scripts/build-runtimes.psm1`**
- 源码声明的类型、组件或调用边界：`Test`, `Get`, `Get`, `Download`, `Resolve`, `Use`, `Copy`, `Resolve`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-runtimes.psm1#L1-L228)。
- **`scripts/build.ps1`**
- 脚本执行边界：`npm install`；`npm run build`；`python -m pip install --upgrade build wheel 2&gt;$null`；`python -m build --wheel --no-isolation`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build.ps1#L1-L75)。
- **`scripts/build.sh`**
- 脚本执行边界：`uv run --no-project --python 3.11 python "$PROJECT_ROOT/scripts/build_config.py" --sync`；`uv sync --all-extras \`；`npm install`；`npm run build`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build.sh#L1-L83)。
- **`scripts/build_config.py`**
- 源码对模块职责的说明：Read and derive the build identity from the root ''pyproject.toml''.。
- `ProductNames` 定义类型边界。
- `BuildConfigError` 继承 `ValueError`。
- `BuildConfig` 定义类型边界；方法入口：`app_full_name`, `app_bundle_name`, `executable_name_windows`, `dist_dir_name`, `dmg_filename`, `setup_base_name`。
- 调用入口 `load_build_config(project_root)`；声明返回 `BuildConfig`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 模块级配置或常量名称：`PROJECT_ROOT`, `RUNTIME_CONFIG_PATH`, `PRODUCT_NAMES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build_config.py#L1-L303)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
