---
name: feature-depth-huawei-realname-account-check
description: check_account 实现深读：函数签名与退出码、CLI 默认值及固定 15s/8s 超时、Playwright over CDP 依赖、连接失败与检测异常转 ok:false、JS 变量优先 DOM 兜底取舍、SKILL.md 手动流程（未执行）
metadata:
  scope: 只收 check_account 的实现深读条目（接口、配置、依赖、失败模式、取舍、验证）；功能概览归 feature-huawei-realname-account-check
---
# 华为云账号实名认证状态检测（check_account）：实现深读

## 现状

- [[feature-huawei-realname-account-check]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **check_account(cdp_url, timeout_s=15) 返回结果 dict；CLI 以退出码表达 ok** 函数签名 check_account(cdp_url: str, timeout_s: int = 15) -> dict，成功返回 make_success 附 realname_authenticated/popups_closed/realname_auth_url；
  - main 接受 --cdp-url/--timeout/--json，cdp_url 为空时自动 resolve_cdp_url()，仍为空则输出失败 JSON 并返回 1，否则返回 0 当且仅当 result.get("ok")。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L50–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L50-L58`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L110–L128
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L110-L128`）
- **CLI 默认 --cdp-url 为空自动解析、--timeout 默认 15 秒** argparse 定义 --cdp-url 默认空串（空则调 resolve_cdp_url() 自动解析）与 --timeout 默认 15；check_account 内部另将连接超时固定为 connect_page(timeout_ms=15_000)、检测超时固定为 8_000ms，不随 --timeout 改变。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L111–L126
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L111-L126`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L56–L82
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L56-L82`）
- **check_account depends on Playwright over CDP reusing the first context's existing page, with a new-page fallback; playwright must be pip-installed** connect_page lazily imports playwright.sync_api (raising RuntimeError with an install hint if missing), connects via chromium.connect_over_cdp,
  - raises if browser.contexts is empty, takes contexts[0] and reuses pages[0] when present else creates a page, and sets page.set_default_timeout(timeout_ms).
  - check_account also depends on lib.huawei_selectors (dismiss_popups, detect_realname_status, HUAWEI_REALNAME_AUTH_URL) and lib.flow_state result builders.
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py:L195–L228
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py#L195-L228`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L35–L47
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L35-L47`）
- **连接失败与检测异常均转为 {ok:false} 返回，不抛给上层** connect_page 抛异常时返回 make_failure("connect_failed", ...)；检测阶段任何 Exception 返回 make_failure("exception", ...)；detect_realname_status 在 timeout_ms 内两级探测都无果时 emit 超时消息并返回 False（视为未认证兜底）；finally 中 pw.stop() 失败仅记 debug 日志。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L57–L64
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L57-L64`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L97–L107
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L97-L107`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L602–L605
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L602-L605`）
- **JS 变量优先+DOM 兜底的检测换取稳定性，超时兜底偏向未认证** 设计推断（非作者历史意图）：
- （推断）detect_realname_status 优先读 window.myRoleTags（不受文案/DOM 变化影响），DOM 提醒条作兜底，提高容错；代价是两级探测都未就绪时超时返回 False，即把未知状态判为未实名，可能产生误报。固定 sleep 2.0s + 弹窗关闭 sleep 也增加总时长。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L561–L565
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L561-L565`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L602–L605
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L602-L605`）
- **SKILL.md documents running check_account.py --json --cdp-url with expected JSON for both realname outcomes (documented procedure, NOT EXECUTED here)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md step 2 gives the exact command `python <skill_dir>/scripts/check_account.py --json --cdp-url "<CDP_URL>"` and expected outputs: {"ok": true, "stage": "check_account", "realname_authenticated": true|false, "popups_closed": 1, "realname_auth_url": ...}.
  - This is a documented manual procedure only; no automated test evidence for this feature is supplied, and nothing was executed in this batch.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L193–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md#L193-L227)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-huawei-realname-account-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L50-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L110-L128
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L111-L126
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L56-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L57-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L97-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L602-L605
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L561-L565
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py:L195-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L35-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L193-L227
- 源页字段（feature）：huawei-realname-account-check
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py
