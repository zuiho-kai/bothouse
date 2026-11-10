---
name: feature-depth-huawei-maas-apikey-creation
description: auto_create_apikey 实现深读：main 解析参数与 resolve_cdp_url 回退、CLI 默认值、connect/navigate/创建按钮失败的结构化 make_failure、复制按钮 best-effort 取舍、SKILL.md 手工流程（未执行）
metadata:
  scope: 只收 auto_create_apikey 的实现深读条目（流程、接口、配置默认值、失败模式、取舍、验证）；功能概览归 feature-huawei-maas-apikey-creation
---
# 华为云 MaaS API Key 自动创建与捕获（auto_create_apikey）：实现深读

## 现状

- [[feature-huawei-maas-apikey-creation]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main 解析参数后连接 CDP 浏览器并逐步创建、捕获 Key** main 解析 --cdp-url/--tag/--description/--timeout/--json；cdp_url 为空时回退 resolve_cdp_url()，仍为空则输出失败 JSON 并 return 1。否则调用 auto_create_apikey 并 output_json(result)，按 result.get("ok") 返回 0 或 1（main 的返回值，非本片段可证的进程退出码）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380–L406
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L380-L406`）
- **main 的 CLI 契约：--tag 默认 jiuwenswarm、--cdp-url 空时回退 resolve_cdp_url()，按 ok 返回 0/1** main 接受 --cdp-url（默认空）、--tag（默认 "jiuwenswarm"）、--description（默认 "jiuwenswarm-config"）、--timeout（默认 30 秒）与 --json 标志；cdp_url 为空时调用 resolve_cdp_url() 解析，仍无则输出 make_failure("init", "未找到 CDP URL") 并 return 1。
  - 成功路径 auto_create_apikey 返回 make_success("apikey", ..., api_key, tag, description, dialog_closed)，main 输出 JSON 并 return 0 if result.get("ok") else 1。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380–L406
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L380-L406`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L363–L370
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L363-L370`）
- **CLI 默认值：tag=jiuwenswarm、description=jiuwenswarm-config、timeout=30 秒** argparse 定义 --cdp-url 默认空串（空时回退 resolve_cdp_url()）、--tag 默认 "jiuwenswarm"、--description 默认 "jiuwenswarm-config"、--timeout 默认 30（单步超时秒数）、--json 布尔开关。这些是本函数内的参数默认值，未在片段中显示更外层配置优先级。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380–L397
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L380-L397`）
- **连接/导航/按钮缺失各自短路为结构化失败，异常统一兜底** connect_page 抛异常时 return make_failure("connect_failed", …)；goto 失败 return make_failure("navigate_failed", …)；创建按钮 15s 内未找到则带 page_url 与 page_text_preview 返回 make_failure("create_btn_not_found", …)；
  - 步骤中任意未预期异常被外层 except 捕获返回 make_failure("exception", …)，finally 中 best-effort pw.stop()。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L234–L260
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L234-L260`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L371–L377
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L371-L377`）
- **复制按钮 best-effort：不阻塞成功路径，但复制可能静默失败** 设计推断（非作者历史意图）：
- 成功捕获 Key 后 click_copy_key_button(page) 在 huawei_selectors 中 try 内 3s 等待可见并点击，任何异常返回 False；主流程仅 emit 记录，仍继续返回 make_success（dialog_closed 单独记录）。推断：收益是复制失败不影响 Key 捕获结果，代价是用户剪贴板可能没有该 Key 而流程不报错。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L353–L370
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L353-L370`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L459–L467
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L459-L467`）
- **Documented manual procedure: serial navigate.py then auto_create_apikey.py with expected success JSON (NOT EXECUTED)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 记录的手工验证流程：先执行 navigate.py 并等待 stdout 返回 `{"ok": true}` 后再串行执行 auto_create_apikey.py（严禁并行，否则会因加载竞态误报 create_btn_not_found）；文档给出的期望成功输出为含 `"ok": true`、`"stage": "apikey"`、`api_key`、`tag`、`description` 的 JSON。此为文档化手工步骤，本次未执行。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L311–L336](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md#L311-L336)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-huawei-maas-apikey-creation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380-L406
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380-L397
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L234-L260
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L371-L377
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L353-L370
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L459-L467
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L363-L370
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L311-L336
- 源页字段（feature）：huawei-maas-apikey-creation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py
