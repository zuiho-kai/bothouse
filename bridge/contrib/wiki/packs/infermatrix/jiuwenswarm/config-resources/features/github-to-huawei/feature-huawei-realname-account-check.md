---
name: feature-huawei-realname-account-check
description: 华为云账号实名认证状态检测脚本 check_account 功能概览：Skill 流程位置与控制流、--cdp-url/--timeout/--json 参数与 JSON 结果契约、dismiss_popups 与 window.myRoleTags/DOM 两级实名检测、timeout_s 未使用的取舍与运行时防护
metadata:
  scope: 收 check_account.py 的功能概览（流程位置、CLI 入口与结果契约、命令行参数、关弹窗与检测、设计取舍、验证形式），来源另含 huawei_selectors.py；实现深读归 feature-depth-huawei-realname-account-check
---
# check_account — 华为云账号实名认证状态检测脚本

## 现状

- **在 Skill 编排流程中的位置与控制流**
- 脚本是 huawei-cloud-maas-setup Skill 的一个步骤：前置依赖 `ensure_browser.py` 启动浏览器并通过 CDP 暴露、`navigate.py` 已登录费用中心首页；本步骤复用已有 page（不新建标签页、不导航），只做关弹窗和检测，结果供编排层决定 ask_user 文案。控制流为：`connect_page` 接管 CDP → sleep 2s 等 SPA 渲染 → `dismiss_popups`（最多 3 轮）→ `detect_realname_status` → 输出 JSON；
  - `finally` 中 `pw.stop()` 断开 Playwright 连接。选择器与检测逻辑下沉在 `lib/huawei_selectors.py`，流程状态封装在 `lib/flow_state`。
- Sources / 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L3–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L3-L17),
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L56–L96
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L56-L96`）
- **CLI 入口与结果契约**
- 公开入口是 `main(argv)`/CLI：`python check_account.py --cdp-url <url> --json`。`--cdp-url` 留空时经 `resolve_cdp_url()` 自动解析；解析不到则输出 JSON 失败结果并返回退出码 1；正常路径总是 `output_json(result)`，退出码 0 当且仅当 `result["ok"]` 为真。成功时结果包含 `cdp_url`、`realname_authenticated`、`popups_closed`、`realname_auth_url` 字段；
  - 失败经 `make_failure(stage, error_message, ...)`，观察到的 stage 调用值为 `connect_failed`、`exception`、`init`。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L110–L128
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L110-L128`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L90–L102
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L90-L102`）
- **命令行参数**
- argparse 定义三个参数：`--cdp-url`（默认空字符串，留空自动解析）、`--timeout`（int，默认 15，帮助文案称"整体超时秒数"，传入后成为 `check_account` 的 `timeout_s` 形参）、`--json`（store_true 帮助开关）。注意在所示实现中 `args.json` 从未被读取：无论是否传 `--json`，脚本都无条件以 `output_json` 输出 JSON。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L110–L128
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L110-L128`）
- **关弹窗与两级实名检测**
- 复用已有 CDP page（不新建标签页、不导航），先 `dismiss_popups`（最多 3 轮点击引导弹窗关闭按钮，弹窗可能遮挡页面元素）再做检测。`detect_realname_status` 两级策略：主策略读取 `window.myRoleTags`，当它是非空 list 且含 `op_restricted` 或 `op_unverified` 判未认证，非空 list 且不含这两个标签判已认证；备策略检查 `#cf_header_reminder_container` 文案是否含"实名认证"。超时未能判定时兜底返回 False（视为未认证）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L558–L605
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L558-L605`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L50–L96
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L50-L96`）
- **设计取舍：稳定性优先的检测策略与时间预算**
- Inference / 设计推断（非作者历史意图）：
- 检测采用两级策略：优先读取 `window.myRoleTags`（代码注释称其不受文案/DOM 布局变化影响），DOM 提醒条 `#cf_header_reminder_container` 作为 JS 变量未就绪时的兜底；超时仍未判定则返回 False（视为未认证），偏向宁可误判未认证也不悬挂。
  - 另一取舍：文档字符串声明整个流程 ≤15s 并提供 `--timeout` 参数（默认 15），但在所示实现中 `timeout_s` 形参未被使用，实际耗时由固定的 sleep（2.0s + 关弹窗后 0.5s）和各调用内置超时（connect 15s、detect 8s）累积决定，声明的时间上限在实现中未落实。此为基于所示代码的推断，非作者意图的史料。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L561–L605
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L561-L605`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L50–L82
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L50-L82`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L14–L17
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L14-L17`）
- **验证形式：运行时防护与超时兜底（非自动化测试）**
- 所示文件中未包含自动化测试入口；验证以脚本内的运行时防护（runtime guards）形式存在。`detect_realname_status` 以 deadline 循环（`time.time() + timeout_ms/1000`）反复尝试 JS 变量与 DOM 提醒条两级检测，每轮末 `sleep(0.5)`；超时仍未判定时 emit 一条提示并兜底返回 False（视为未认证）。`check_account` 将浏览器连接失败与检测阶段的异常都转为 `make_failure` 结果而非向上抛出，`main` 依据 `result["ok"]` 决定退出码 0/1。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L569–L605
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L569-L605`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L57–L64
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L57-L64`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L126–L128
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L126-L128`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-huawei-realname-account-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L3-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L56-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L110-L128
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L90-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L558-L605
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L50-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L561-L605
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L50-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L14-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L569-L605
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L57-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py:L126-L128
- 源页字段（feature）：huawei-realname-account-check
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py
