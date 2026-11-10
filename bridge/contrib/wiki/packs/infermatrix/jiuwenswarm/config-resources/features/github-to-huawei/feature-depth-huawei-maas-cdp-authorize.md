---
name: feature-depth-huawei-maas-cdp-authorize
description: auto_authorize 实现深读：固定步骤授权流程与超时值、main CLI 契约与 resolve_cdp_url 回退、惰性导入 playwright 与 connect_over_cdp 复用页面、各失败 stage 返回 make_failure、两级检测与固定 sleep、SKILL.md 手动流程（未执行）
metadata:
  scope: 只收 auto_authorize 的实现深读条目（流程、接口、配置默认值、依赖、失败模式、取舍、验证）；功能概览归 feature-huawei-maas-cdp-authorize
---
# 华为云 MaaS 委托授权自动化（auto_authorize）：实现深读

## 现状

- [[feature-huawei-maas-cdp-authorize]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **auto_authorize 连接 CDP 后按固定步骤检测并完成授权** auto_authorize 经 connect_page 连接浏览器（timeout_ms=15_000），page.goto 导航到 MAAS_HOMEPAGE_URL（timeout=30_000），sleep 2.5s 等 SPA 渲染并 handle_disclaimer；
  - 若 _detect_auth_warning 为假则直接 make_success(auth_done=False, skipped_reason="no_warning")，否则点击"此处"链接（缺失/失败时兜底点警告元素本身），等待授权对话框与"确定"按钮，最后等待成功提示并 make_success(auth_done=True)。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L133`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L135–L205
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L135-L205`）
- **main(argv) CLI 契约：--cdp-url/--timeout/--json，返回 0/1** main 解析 --cdp-url（默认空）、--timeout（默认 45）、--json；cdp_url 为空时回退 resolve_cdp_url()，仍为空则 output_json(make_failure("init", "未找到 CDP URL")) 并返回 1；否则 auto_authorize 后 output_json(result)，按 result.get("ok") 返回 0 或 1（函数返回值，非进程退出码的直接证明）。
  - auto_authorize(cdp_url, timeout_s=45) 对调用者返回结果 dict。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215–L234
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L215-L234`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L104
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L104`）
- **main 的 --cdp-url 默认为空并回退 resolve_cdp_url，--timeout 默认 45 作为 auto_authorize 的 timeout_s** --cdp-url 缺省为空字符串，strip 后为空则调用 resolve_cdp_url() 解析；仍为空时输出 make_failure("init") 且 main 局部返回 1。--timeout 缺省 45，以 timeout_s 传入 auto_authorize；连接超时为固定 15_000ms，页内各等待用的是固定毫秒值。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215–L230
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L215-L230`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L104
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L104`）
- **惰性导入 playwright 并经 connect_over_cdp 复用首个 context 的已有 page** import_playwright 惰性导入 playwright.sync_api，ImportError 时抛 RuntimeError 附安装指引（不需 playwright install）。connect_page 用 chromium.connect_over_cdp 连接，无 context 时抛 RuntimeError；
  - 默认 new_page=False 复用 context.pages[0]，无 page 才新建，并 set_default_timeout(timeout_ms)。auto_authorize 以默认 new_page=False 调用，故操作复用浏览器默认 context 的现有 page。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py:L195–L228
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py#L195-L228`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L100–L104
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L100-L104`）
- **auto_authorize 各失败分支返回 make_failure 载荷而非抛出，finally 中 pw.stop 异常被吞掉** 在 auto_authorize 局部分支中，连接失败返回 stage="connect_failed"、导航失败 "navigate_failed"、对话框 10s 未现为 "dialog_timeout"、确定按钮未点为 "confirm_not_found"、成功提示 15s 未现为 "success_timeout"、其余异常为 "exception"；均经 make_failure 构造 dict 返回。
  - finally 里 pw.stop() 失败仅 debug 日志。注意：'此处'点击失败且兜底 warning 为 None 时不返回，继续等待对话框。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L112
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L112`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L135–L176
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L135-L176`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L179–L212
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L179-L212`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py:L9–L17
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py#L9-L17`）
- **两级检测 + 固定 sleep 换取稳态判定** 设计推断（非作者历史意图）：
- （推断）_detect_auth_warning 先查 #authGlobalMessage 容器、容器缺失/不可见时退化为警告选择器快照并按关键词匹配，容错 DOM 变化但可能误判（如 inner_text 异常时直接返回 True，85-92 行）；授权流程多处固定 time.sleep(2.5/1.5/1.0) 等 SPA 渲染与动画，稳定性换来了最坏情况下不必要的等待时长。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L68–L95
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L68-L95`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L114–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L114-L124`）
- **SKILL.md 记录的手动验证流程（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档化手动流程，未执行：依次运行 navigate.py 与 auto_authorize.py --json --cdp-url <CDP_URL>，期望输出形如 {"ok": true, "stage": "authorize", "auth_done": false, "skipped_reason": "no_warning", ...} 或 auth_done=true 且 disclaimer_handled=true；失败降级为提示用户手动完成委托授权后重试。此处仅为文档示例，非已运行断言。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L285–L309](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md#L285-L309)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-huawei-maas-cdp-authorize.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L135-L205
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215-L234
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py:L195-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L100-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L68-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L114-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L135-L176
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L179-L212
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py:L9-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L285-L309
- 源页字段（feature）：huawei-maas-cdp-authorize
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py
