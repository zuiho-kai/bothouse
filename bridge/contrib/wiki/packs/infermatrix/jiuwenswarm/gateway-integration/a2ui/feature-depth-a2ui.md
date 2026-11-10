---
name: feature-depth-a2ui
description: A2UI 实现深读：a2ui 配置默认值与环境变量优先级、系统流与桥接单测断言、finalize_a2ui_assistant_content 守卫、integration.py 延迟导入与配置查找异常、5.0s fast path 校验、finalize_result 修复流程
metadata:
  scope: 只收 A2UI 后端配置、finalize 与校验的实现级证据；功能概览归 feature-a2ui，Web 前端渲染与动作分发归 knowledge-a2ui
---
# A2UI 生成式界面：实现深读

## 现状

- [[feature-a2ui]]（功能概览） · [[a2ui-overview]]（owner 入口）
- **a2ui 配置默认值与环境变量优先级** get_a2ui_config 中 a2ui.enabled 默认 false，环境变量 JIUWENSWARM_A2UI_ENABLED 存在时覆盖 YAML 值；protocol_version 优先级为 JIUWENSWARM_A2UI_PROTOCOL_VERSION > YAML > 默认 "0.8"，不在 SUPPORTED_A2UI_PROTOCOL_VERSIONS 内时抛 ValueError；
  - stream_validation_enabled 默认 true，non_web_fallback_enabled 默认 false。
- 来源：[jiuwenswarm/server/control/a2ui_config.py:L39–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/a2ui_config.py#L39-L69)
- **系统流与桥接单测断言** tests/system_tests/test_a2ui_system_flow.py::test_a2ui_system_flow_accepts_event_and_valid_response 以合法 <a2ui-json> 响应调用 A2UIResponseFinalizer().finalize，repair_call 设为 pytest.fail，断言 finalized 原样返回且 get_protocol_spec().validate_response 为 valid，即有效响应不触发修复。
  - tests/unit_tests/a2ui/test_integration_bridge.py::test_a2ui_channel_policy_is_web_only 断言 is_a2ui_channel 仅对 web（含大小写）为 True；test_message_handler_fallback_skips_a2ui_import_without_marker 通过拦截 __import__ 断言无标记的 gateway 热路径不导入 A2UI integration。这些是测试断言的行为，不代表当前已运行通过。
- 来源：[tests/system_tests/test_a2ui_system_flow.py:L42–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/system_tests/test_a2ui_system_flow.py#L42-L100),
  - [tests/unit_tests/a2ui/test_integration_bridge.py:L26–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/a2ui/test_integration_bridge.py#L26-L32),
  - [tests/unit_tests/a2ui/test_integration_bridge.py:L93–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/a2ui/test_integration_bridge.py#L93-L109)
- **finalize_a2ui_assistant_content：守卫命中原样返回 content；retry 回调可同步或可等待** 当 not a2ui_enabled、content 非字符串或无 A2UI 标记时原样返回 content；retry_without_a2ui_call 以 str(user_query or "") 调用，结果为 awaitable 时先 await。
- 来源：[jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L51–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py#L51-L52),
  - [jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L119–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py#L119-L124)
- **integration.py 把 response_finalization 导入推迟到 channel 与配置守卫通过之后** 包装函数在 is_a2ui_channel(channel) 通过且 _get_runtime_a2ui_config() 成功后才 import finalize_a2ui_assistant_content；非 A2UI channel 在该导入前即 return content。
- 来源：[jiuwenswarm/server/runtime/a2ui/integration.py:L99–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/integration.py#L99-L110)
- **A2UI finalize 包装：_get_runtime_a2ui_config() 异常时跳过 finalization 原样返回** 触发条件为 _get_runtime_a2ui_config() 抛异常；except Exception 分支以 debug 记录 "A2UI response finalization skipped: config lookup failed" 并 return content，异常在该分支内不再向上传播。
- 来源：[jiuwenswarm/server/runtime/a2ui/integration.py:L102–L106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/integration.py#L102-L106)
- **5.0s 有界 fast path 校验：有效内容免进 finalizer，超时降级为文本 fallback** 设计推断（非作者历史意图）：
- fast path 仅对含 parseable tagged block 的内容在线程中以 5.0s wait_for 执行 spec.validate_response：校验有效则原样返回、不进入 finalizer 修复流程；超时则直接返回 _a2ui_timeout_fallback 文本，放弃修复尝试。
- 来源：[jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L22–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py#L22-L40),
  - [jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L61–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py#L61-L76),
  - [jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L152–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py#L152-L181)
- **finalize_result：无 A2UI 标记返回 skipped，valid 需校验通过且含标记或可识别内容，默认至多 2 轮修复且 repair_call=None 时不执行** 入口先经 should_finalize_a2ui_content 守卫：非字符串或无 A2UI 标记时原样返回 status="skipped"。需处理时用 spec.validate_response 校验，valid 且含 A2UI_OPEN_TAG 或 may_contain_a2ui_content 可识别则返回 "valid"。
  - 其余进入至多 max_repair_attempts（默认 2）轮修复，repair_call 为 None 立即跳出；每轮构造修复 prompt 调 repair_call（awaitable 先 await），修复后校验通过返回 "repaired"，耗尽返回 "repair_failed" 并附 validation_error。
- 来源：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L59–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L59-L67),
  - [jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L91–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L91-L161)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/a2ui/feature-depth-a2ui.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/control/a2ui_config.py:L39-L69；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_a2ui_system_flow.py:L42-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/a2ui/test_integration_bridge.py:L26-L32；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/a2ui/test_integration_bridge.py:L93-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L51-L52；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L119-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/integration.py:L99-L110；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/integration.py:L102-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L22-L40；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L61-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/response_finalization.py:L152-L181；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L59-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L91-L161
- 源页字段（feature）：a2ui
- 入口（entry_points）：jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py；jiuwenswarm/server/runtime/a2ui/*
