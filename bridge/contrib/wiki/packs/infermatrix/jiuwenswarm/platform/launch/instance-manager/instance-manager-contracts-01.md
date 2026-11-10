---
name: instance-manager-contracts-01
description: instance-manager 源码接口 01：jiuwenswarm/instance_manager/__init__.py 的模块职责说明（多实例隔离）与从 jiuwenswarm.instance_manager.config 导入 InstanceConfig、is_valid_instance_name、calculate_instance_ports 等的导入声明
metadata:
  scope: 只收 jiuwenswarm/instance_manager/__init__.py 一个文件的接口记录；目录入口归 instance-manager-overview
---
# instance-manager 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/instance_manager/__init__.py`**
- 源码对模块职责的说明：Instance manager for multi-instance isolation.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.instance_manager.config import InstanceConfig, InstanceSta`；`from jiuwenswarm.instance_manager.config import is_valid_instance_name, val`；`from jiuwenswarm.instance_manager.config import calculate_instance_ports, c`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/__init__.py#L1-L156)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/instance-manager/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
