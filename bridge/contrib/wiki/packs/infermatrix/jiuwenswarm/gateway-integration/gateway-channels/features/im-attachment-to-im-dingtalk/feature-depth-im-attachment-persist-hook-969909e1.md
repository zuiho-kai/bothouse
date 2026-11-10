---
name: feature-depth-im-attachment-persist-hook-969909e1
description: IM 附件持久化钩子实现深读：钩子契约 (content, category, filename) 返回 path/name/size/mime_type、platform 缺省 im、大附件走 HTTP 桥的取舍推断、_persist_hook 失败文案、AttachmentPersistError 与 AgentOS RuntimeError 单测
metadata:
  scope: 钩子返回结构、_persist_hook 分支与单测断言；接线点、路由模式与分流取舍归 feature-im-attachment-persist-hook-969909e1
---
# IM Attachment Persist Hook (E2A + HTTP Bridge)：实现深读

## 现状

- [[feature-im-attachment-persist-hook-969909e1]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **Hook contract: async (content, category, filename) returning a dict with path/name/size/mime_type** The wired hook is awaited as hook(b"x", "images", "a.png") and returns a dict whose keys include path, name, size, mime_type; FeishuFileService exposes set_persist_hook to install it,
  - and the service's _persist_downloaded_file uses it.
- 来源：[tests/unit_tests/channel/test_attachment_persist.py:L39–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L39-L46),
  - [tests/unit_tests/channel/test_attachment_persist.py:L113–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L113-L122)
- **Hook channel_id defaults to "im" when platform is falsy** Within the shown hook body, channel_id is passed as `platform or "im"` with label "im.file_persist"; no other setting or precedence is visible in the offered lines.
- 来源：[jiuwenswarm/gateway/channel_manager/channel_manager.py:L255–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L255-L262)
- **Large attachments routed to HTTP bridge instead of base64 E2A: avoids frame limit, adds failing upload step** 设计推断（非作者历史意图）：
- Inference from the tests' docstrings: attachments larger than E2A_PAYLOAD_MAX_BYTES are uploaded via the authenticated HTTP bridge rather than base64-in-E2A to stay under the internal WS ~8MB frame limit (benefit),
  - at the cost of an extra network step whose failure raises and fails the whole message as retryable (per decision D6 docstring) rather than degrading to inline delivery.
- 来源：[tests/unit_tests/channel/test_attachment_persist.py:L93–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L93-L109),
  - [tests/unit_tests/channel/test_attachment_persist.py:L184–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L184-L199)
- **Runtime tests: hook failure raises AttachmentPersistError; AgentOS hook raises RuntimeError on user_id gap** test_persist_hook_failure_raises_attachment_persist_error installs a failing hook and asserts pytest.raises(AttachmentPersistError) around _persist_downloaded_file;
  - test_agentos_attachment_never_falls_back_to_gateway_workspace asserts channel.hook is not None and pytest.raises(RuntimeError, match="authenticated AgentOS user_id") on hook(b"x", "images", "a.png"). Not executed here.
- 来源：[tests/unit_tests/channel/test_attachment_persist.py:L40–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L40-L46),
  - [tests/unit_tests/channel/test_attachment_persist.py:L220–L234](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L220-L234)
- **_persist_hook local branch: labeled call, RuntimeError on not-ok, returns payload, installed via setter** 在 _persist_hook 的可见分支中，以 session_id=None、user_id=None、channel_id=platform 或 "im"、label="im.file_persist" 发起调用；
  - 若返回 not ok 则 raise RuntimeError(error 或回退 "im.file_persist failed")，否则返回 payload，最后经 setter(_persist_hook) 安装。调用目标与赋值语句不在片段内，不作断言。
- 来源：[jiuwenswarm/gateway/channel_manager/channel_manager.py:L255–L264](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L255-L264)
- **not-ok 分支抛 RuntimeError 且错误文案回退到 "im.file_persist failed"** 当调用返回 ok=False 时，_persist_hook 抛出 RuntimeError，消息取 payload.get("error")，取不到则回退为 "im.file_persist failed"；该分支在片段内即结束执行（局部 return 不发生）。
  - 测试侧另构造带 agent_client=object() 的 manager 并调用 _try_wire_file_persist_hook 后，断言 hook 抛出匹配 "authenticated AgentOS user_id" 的 RuntimeError；该测试的 client 判定条件未在片段内展示。
- 来源：[jiuwenswarm/gateway/channel_manager/channel_manager.py:L260–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L260-L262),
  - [tests/unit_tests/channel/test_attachment_persist.py:L227–L234](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_attachment_persist.py#L227-L234),
  - [jiuwenswarm/gateway/channel_manager/channel_manager.py:L177–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L177-L180)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-attachment-persist-hook-969909e1.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L39-L46；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L113-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L40-L46；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L220-L234
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/channel_manager.py:L255-L262；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L93-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L184-L199；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/channel_manager.py:L255-L264
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/channel_manager.py:L260-L262；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_attachment_persist.py:L227-L234
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/channel_manager.py:L177-L180
- 源页字段（feature）：im-attachment-persist-hook-969909e1
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/channel_manager.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/channel_manager.py
