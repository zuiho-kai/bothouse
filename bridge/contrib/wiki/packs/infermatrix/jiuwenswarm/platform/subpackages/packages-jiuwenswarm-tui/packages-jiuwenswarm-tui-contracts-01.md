---
name: packages-jiuwenswarm-tui-contracts-01
description: packages-jiuwenswarm-tui 源码接口 01：jiuwenswarm_tui/app.py 的 main() 入口，以及 setup.py 的 BinaryDistribution（has_ext_modules）与 PlatformBdistWheel（finalize_options、get_tag）和导入依赖
metadata:
  scope: 只收 app.py 与 setup.py 两个文件的记录；目录入口归 packages-jiuwenswarm-tui-overview
---
# packages-jiuwenswarm-tui 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`packages/jiuwenswarm-tui/jiuwenswarm_tui/app.py`**
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`import platform`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/packages/jiuwenswarm-tui/jiuwenswarm_tui/app.py#L1-L102)。
- **`packages/jiuwenswarm-tui/setup.py`**
- `BinaryDistribution` 继承 `Distribution`；方法入口：`has_ext_modules`。
- `PlatformBdistWheel` 继承 `_bdist_wheel`；方法入口：`finalize_options`, `get_tag`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import os`；`from setuptools import setup`；`from setuptools.dist import Distribution`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/packages/jiuwenswarm-tui/setup.py#L1-L31)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/subpackages/packages-jiuwenswarm-tui/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
