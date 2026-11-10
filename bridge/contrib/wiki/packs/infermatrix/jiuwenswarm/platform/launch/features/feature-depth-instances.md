---
name: feature-depth-instances
description: 单机多实例实现深读：load_instance_bootstrap_by_name 返回契约、JIUWENSWARM_<TYPE>_PORT 基准覆盖与端口公式、get_instance_config 依赖、早期 bootstrap 复制端口公式的代价、桌面端口组测试断言、InstancesYamlError 转抛
metadata:
  scope: 只收多实例配置的实现层深读条目；功能概览归 feature-instances
---
# 单机多实例：实现深读

## 现状

- [[feature-instances]]（功能概览） · [[launch-overview]]（owner 入口）
- **load_instance_bootstrap_by_name 的返回契约** 输入实例名，成功时返回 .env 路径并以 override=True 调用 load_dotenv 注入环境；实例名校验失败、instances.yaml 中不存在或工作区目录缺失时记录错误并返回 None，调用方需自行处理 None。
- 来源：[jiuwenswarm/instance_manager/bootstrap.py:L172–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L172-L202)
- **端口基准的环境变量覆盖与分配公式** 实例端口 = 基准端口 + index × 1000（calculate_instance_ports）。基准优先取 JIUWENSWARM_<TYPE>_PORT 环境变量（PORT_ENV_OVERRIDES，供 Docker 场景），解析失败的非法整数值仅记 debug 日志后忽略，回落到静态 BASE_PORTS，未知端口类型再回落 10000。
- 来源：[jiuwenswarm/instance_manager/config.py:L141–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L141-L159),
  - [jiuwenswarm/instance_manager/config.py:L183–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L183-L188)
- **bootstrap 依赖 status.get_instance_config 读取 instances.yaml** load_instance_bootstrap_by_name 通过 get_instance_config(name) 从 instances.yaml 取得 workspace（未配置则用 get_instance_workspace_path 推导）和端口（未配置则 compute_auto_port 按声明顺序 index 自动计算），随后才能定位或重建 .env；instances.yaml 的条目顺序因此直接影响自动端口结果。
- 来源：[jiuwenswarm/instance_manager/bootstrap.py:L139–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L139-L202),
  - [jiuwenswarm/instance_manager/status.py:L261–L294](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/status.py#L261-L294)
- **早期 bootstrap 生成复制端口公式的代价** 设计推断（非作者历史意图）：
- 推断：_create_basic_bootstrap_env 为满足“不得依赖任何 jiuwenswarm 模块”的早期解析约束，静态复制了 base + index×1000 的端口公式；代价是它直接用 BASE_PORTS，不像 calculate_instance_ports 那样经过 _resolved_base_port 支持 JIUWENSWARM_<TYPE>_PORT 覆盖，两条路径在设置了环境覆盖时会算出不同端口。
- 来源：[jiuwenswarm/instance_manager/bootstrap.py:L93–L120](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L93-L120),
  - [jiuwenswarm/instance_manager/config.py:L183–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L183-L188)
- **桌面端口组测试对 instance_manager 端口公式的断言** tests/unit_tests/test_desktop_port_resolve.py:223-252 三个用例均 monkeypatch desktop_app.find_available_ports 后断言 resolve_desktop_ports：默认组等于 calculate_instance_ports(0) 且 frontend/web 端口与 instance_manager 的 BASE_PORTS 一致；
  - 回退组为 calculate_instance_ports(1)，即 BASE_PORTS 各 +1000；扫描返回 None 时抛 RuntimeError 匹配 'No available desktop port group'。这是对端口组公式消费端映射的断言记录，不证明当前已运行通过。
- 来源：[tests/unit_tests/test_desktop_port_resolve.py:L223–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_desktop_port_resolve.py#L223-L252)
- **名称合法且实例、工作区均存在时：取或补建 workspace/.env 并以 override=True 加载后返回路径** validate_instance_name 无错误、get_instance_config 非 None 且 workspace 存在时，env_path 取 config.get_bootstrap_env_path() 即 workspace/.env；文件不存在则 create_bootstrap_env 补建，load_dotenv(env_path, override=True) 覆盖加载，函数局部返回 env_path。
- 来源：[jiuwenswarm/instance_manager/bootstrap.py:L172–L202](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/bootstrap.py#L172-L202),
  - [jiuwenswarm/instance_manager/config.py:L78–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L78-L80)
- **instances.yaml 读/解析失败时 _read_yaml_file 转抛带修复建议的 InstancesYamlError** 读取抛 IOError 或 yaml.safe_load 抛 yaml.YAMLError 时，_read_yaml_file 在本地分支转抛 InstancesYamlError：消息含 Path 与修复建议（如 "Run 'jiuwenswarm-init' to recreate a valid template"），并以 from exc 链接原异常；构造器再统一加 "[instances.yaml] " 前缀后向调用方传播。
- 来源：[jiuwenswarm/instance_manager/yaml.py:L54–L75](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/yaml.py#L54-L75),
  - [jiuwenswarm/instance_manager/config.py:L33–L35](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L33-L35)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/feature-depth-instances.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/config.py:L141-L159；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/config.py:L183-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/bootstrap.py:L139-L202；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/status.py:L261-L294
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/bootstrap.py:L172-L202；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/bootstrap.py:L93-L120
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_desktop_port_resolve.py:L223-L252；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/config.py:L78-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/yaml.py:L54-L75；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/config.py:L33-L35
- 源页字段（feature）：instances
- 入口（entry_points）：jiuwenswarm/instance_manager/bootstrap.py
- 源页字段（source_globs）：jiuwenswarm/instance_manager/bootstrap.py；jiuwenswarm/instance_manager/*.py
