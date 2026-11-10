---
name: feature-depth-sdd-design-rail
description: DesignRail 实现深读：DesignRail.__init__ 的 config 加载与 ValueError、priority 覆盖、_handle_advance 非法 stage 返回、approve 不自动转移、ask_user 评审回调与单测
metadata:
  scope: 收 DesignRail 的实现级事实（rail.py 与相关单测），来源另含 rail_state_machine.py、test_config_loader.py、test_design_rail_integration.py；状态机职责分层、行为与配置规则的概览归 feature-sdd-design-rail
---
# DesignRail SDD 状态机（Spec-Driven Development）：实现深读

## 现状

- [[feature-sdd-design-rail]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **DesignRail.__init__：加载并校验 rail_pkg_dir/config.yaml，失败抛 ValueError** 构造函数把 rail_pkg_dir/project_dir/priority 传给 super()，随后 config_loader.load(rail_pkg_dir / "config.yaml") 并 validate（带 rail_pkg_dir）；result.ok 为假时 raise ValueError(f"DesignRail config validation failed: {result.errors}")。
  - 通过后 self.stages 取 cfg["stages"]（空 dict 兜底）。
- 来源：[jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L76–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L76-L92)
- **priority：config.yaml 的 priority 覆盖构造参数，缺省回退构造参数** self._priority = int(cfg.get("priority", priority))——config.yaml 中的 priority 优先，未配置时使用 __init__ 传入的 priority（测试中为 60）。
- 来源：[jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L91–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L91-L92),
  - [tests/unit_tests/sdd/design_rail/test_config_loader.py:L46–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/sdd/design_rail/test_config_loader.py#L46-L47)
- **DesignRail 继承 RailStateMachineBase，并在构造时依赖 config_loader 的 load+validate** DesignRail 是 RailStateMachineBase 的子类（后者继承 openjiuwen 的 DeepAgentRail），构造函数调用 config_loader.load(rail_pkg_dir/config.yaml) 并用 validate(cfg, rail_pkg_dir=...) 校验后填充 self.stages。
- 来源：[jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L62–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L62-L92),
  - [jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py:L40–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py#L40-L51)
- **config 校验失败时构造函数抛 ValueError；advance 非法 stage 返回 ok=False 字典** __init__ 中 validate 结果不 ok 时 raise ValueError（含 errors 列表）；_handle_advance 对非字符串或不属于 self.stages 的 stage 参数不抛异常，直接返回 {"ok": False, "error": f"invalid stage: {target!r}"} 交给调用方。
- 来源：[jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L85–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L85-L90),
  - [jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py:L261–L264](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py#L261-L264)
- **approve 不自动转移：避免双重推进，代价是依赖 agent 主动调用 sdd_advance** 设计推断（非作者历史意图）：
- 源码注释说明：若 after_tool_call 在 approve 时自动转移，随后 agent 再调 sdd_advance 会因已在下一阶段收到 "not a valid next" 错误；因此选择只记日志。收益是状态转移单一来源，成本是推进必须依赖 agent 遵循 SKILL.md R4 指令显式调用工具（此依赖为对该注释的推断性复述）。
- 来源：[jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L140–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L140-L149)
- **单元/集成测试在运行时断言 validate 拒绝路径与 _handle_advance 成功转移** 自动化运行时验证：test_validate_no_path_init_to_done 构造 done 不可达的配置，断言 result.ok is False 且错误含 "no_path_init_to_done"；
  - 集成测试用真实 config 构造 DesignRail 后调用 rail._handle_advance({"stage": "analysis_review"})，断言 result["ok"] is True 且 rail._stage == "analysis_review"。
- 来源：[tests/unit_tests/sdd/design_rail/test_config_loader.py:L76–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/sdd/design_rail/test_config_loader.py#L76-L83),
  - [tests/unit_tests/sdd/design_rail/test_design_rail_integration.py:L121–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/sdd/design_rail/test_design_rail_integration.py#L121-L127)
- **ask_user 回调在评审阶段对拒绝答案按 _rework_target 查表结果条件转移，批准则仅等待显式 sdd_advance** after_tool_call 回调先取 ctx.inputs 的 tool_name，非 ask_user 直接返回；随后在 stage 为 done、stage 不在 _REWORK_TARGETS 键集或 answer 文本为空时跳过转移。对非空答案，_is_reject 用 _REJECT_PATTERNS 正则与 _REJECT_CJK 关键词判定拒绝；
  - 拒绝且 _rework_target（即 _REWORK_TARGETS.get(stage)）返回非 None 时调用 _transition_to(target)。批准分支不自动转移，仅记录日志并等待 agent 显式调用 sdd_advance。
- 来源：[jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L97–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L97-L149),
  - [jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L186–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py#L186-L207)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-sdd-design-rail.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L76-L92；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L91-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/sdd/design_rail/test_config_loader.py:L46-L47；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/sdd/design_rail/test_config_loader.py:L76-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/sdd/design_rail/test_design_rail_integration.py:L121-L127；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L62-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py:L40-L51；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L85-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py:L261-L264
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L140-L149；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L97-L149
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py:L186-L207
- 源页字段（feature）：sdd-design-rail
- 入口（entry_points）：jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py；jiuwenswarm/agents/harness/code/rails/sdd/design_rail/__init__.py；jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/code/rails/sdd/common/rail_state_machine.py；jiuwenswarm/agents/harness/code/rails/sdd/design_rail/__init__.py；jiuwenswarm/agents/harness/code/rails/sdd/design_rail/rail.py
  - jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-analysis/scripts/assemble-checklist.mjs；jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-analysis/scripts/assemble-template.mjs
  - jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-design/scripts/assemble-checklist.mjs；jiuwenswarm/agents/harness/code/rails/sdd/design_rail/skills/aet-req-design/scripts/assemble-template.mjs
  - jiuwenswarm/agents/harness/code/rails/sdd/design_rail/config_loader.py；jiuwenswarm/agents/harness/code/rails/sdd/__init__.py；jiuwenswarm/agents/harness/code/rails/sdd/common/__init__.py
