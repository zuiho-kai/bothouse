---
name: feature-depth-external-cli-agents
description: 外部 Claude/Codex CLI 智能体实现深读：runtime 目录与 15 秒探测超时、runtime_state 判定、refresh_external_cli_builtin_models 契约、延迟导入 harness provider、frozen Windows 提权安装器失败分流、新增模型只警告的取舍及 reconcile_builtin_models 单测
metadata:
  scope: 只收外部 CLI 智能体的实现层深读条目（配置取值、流程、API 契约、依赖、失败模式、取舍、验证）；功能概览归 feature-external-cli-agents
---
# 外部 Claude 与 Codex CLI 智能体：实现深读

## 现状

- [[feature-external-cli-agents]]（功能概览） · [[common-core-overview]]（owner 入口）
- **运行时目录与探测超时的取值** external_cli_site_packages 在冻结 Windows 下解析为 sys.executable 同级的 runtime/external-cli/<cli_agent>/site-packages，在冻结 macOS 下为 ~/Library/Application Support/<DISPLAY_NAME>/runtime/external-cli/<cli_agent>/site-packages（用户目录以占位符表示）；非冻结环境抛 RuntimeError。
  - 模型目录刷新的探测超时默认 DEFAULT_PROBE_TIMEOUT_S = 15.0 秒。
- 来源：[jiuwenswarm/common/external_cli_runtime.py:L215–L239](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_runtime.py#L215-L239),
  - [jiuwenswarm/common/external_cli_catalog.py:L24–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L24-L27)
- **get_external_cli_runtime_status 按平台 artifacts 与安装元数据逐级判定 runtime_state** 校验 cli_agent 后从 manifest 取当前平台 artifacts，为空即 raise RuntimeError；site-packages 目录不存在或为空返回 runtime_state="not_installed"；
  - 安装元数据 JSON 损坏或非 dict 记 "invalid"，与期望 {agent, platform, packages} 不一致记 "update_required"，必需文件齐全才记 "current"。
- 来源：[jiuwenswarm/common/external_cli_runtime.py:L162–L212](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_runtime.py#L162-L212)
- **refresh_external_cli_builtin_models(timeout_s) 契约：逐 CLI 探测期限，返回漂移警告** 入参 timeout_s（默认 DEFAULT_PROBE_TIMEOUT_S=15.0）是每个 CLI 的探测期限；返回漂移警告列表，目录全部匹配时为空。只探测声明了目录的 CLI，探测失败（未登录、无法启动、超时）时该 CLI 的目录保持不动。
- 来源：[jiuwenswarm/common/external_cli_catalog.py:L118–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L118-L130),
  - [jiuwenswarm/common/external_cli_catalog.py:L26–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L26-L27)
- **探测按 cli_agent 分支延迟导入 openjiuwen harness provider；目录刷新依赖 config 声明，无任何声明时不发起探测** _probe_models 以 cli_agent == "claude" 为界在函数内导入 openjiuwen.harness_providers.claudecode 或 openjiuwen.harness_providers.codex，分别以 cli_path or None 构造 ClaudeCodeHarness / CodexHarness（codex_bin），
  - 两支都 await harness.list_models() 并映射为 {option.model_id: list(option.efforts)}，导入延迟到探测时发生。目录刷新侧从 jiuwenswarm.common.config 导入 get_config 与 update_external_cli_builtin_models_in_config；
  - 遍历条目时跳过无 cli_agent 或 builtin_models 非非空列表者，收集后 declared_by_agent 为空则在调用 _run_probes(paths, timeout_s) 之前局部 return []。
- 来源：[jiuwenswarm/common/external_cli_catalog.py:L75–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L75-L86),
  - [jiuwenswarm/common/external_cli_catalog.py:L20–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L20-L20),
  - [jiuwenswarm/common/external_cli_catalog.py:L140–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L140-L151)
- **提权安装器（仅 frozen Windows）启动失败按 GetLastError 分流传播** 非 frozen Windows 入口即 raise；ShellExecuteExW 失败按 GetLastError 分流：1223（ERROR_CANCELLED）→RuntimeError("administrator permission was cancelled")，其余→OSError("failed to start elevated external CLI installer")；
  - 安装器退出码非 0 再 RuntimeError 附码，finally 中 CloseHandle。
- 来源：[jiuwenswarm/common/external_cli_runtime.py:L520–L588](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_runtime.py#L520-L588),
  - [jiuwenswarm/common/external_cli_runtime.py:L597–L608](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_runtime.py#L597-L608)
- **CLI 新增模型只警告不自动入目录：成本决策留给运维，但需手工补配置** 设计推断（非作者历史意图）：
- 收益（推断）：注释明言加模型是成本决策，CLI 新报出且未声明的模型只汇成警告而不改写目录，运维保持控制；代价（推断）：警告文本写明必须手工 "add them to builtin_models" 这些模型才可用。
- 来源：[jiuwenswarm/common/external_cli_catalog.py:L67–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/external_cli_catalog.py#L67-L71)
- **直接单测仅覆盖 reconcile_builtin_models 纯 helper（未涉及原生 CLI 集成）** test_reconcile_drops_unknown_models_and_fixes_efforts 直接调用 reconcile_builtin_models("claude", declared, reported)，断言 corrected 仅保留 sonnet 与 haiku、sonnet 的 efforts 修正为上报的 low/medium/high 并保留 daily 描述与仍有效的 high default_effort、
  - haiku 不含 efforts 字段，且 warnings 提及 removed 'fable-5' 与 also offers opus。断言仅及该 helper 的返回值，所示片段未执行原生 CLI、认证、刷新或持久化；本轮亦未运行该测试。
- 来源：[tests/unit_tests/common/test_external_cli_catalog.py:L13–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_external_cli_catalog.py#L13-L16),
  - [tests/unit_tests/common/test_external_cli_catalog.py:L35–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_external_cli_catalog.py#L35-L51)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/feature-depth-external-cli-agents.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_runtime.py:L215-L239；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L24-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_runtime.py:L162-L212；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L118-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L26-L27；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_runtime.py:L520-L588
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_runtime.py:L597-L608；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L67-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L75-L86；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L20-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L140-L151；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_external_cli_catalog.py:L35-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_external_cli_catalog.py:L13-L15；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/external_cli_catalog.py:L30-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_external_cli_catalog.py:L13-L16；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_external_cli_catalog.py:L35-L51
- 源页字段（feature）：external-cli-agents
- 入口（entry_points）：jiuwenswarm/common/external_cli_runtime.py；jiuwenswarm/common/external_cli_catalog.py
- 源页字段（source_globs）：jiuwenswarm/common/external_cli_runtime.py；jiuwenswarm/common/external_cli_catalog.py
