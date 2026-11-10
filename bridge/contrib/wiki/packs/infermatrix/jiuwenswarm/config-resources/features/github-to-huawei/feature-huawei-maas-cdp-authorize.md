---
name: feature-huawei-maas-cdp-authorize
description: 华为云 MaaS 委托授权自动化（auto_authorize.py）功能概览：CDP 浏览器授权流程与 Skill 流水线位置、--cdp-url/--timeout/--json 与 stage 失败取值、#authGlobalMessage 授权警告两级检测、timeout_s 未被使用等超时预算取舍
metadata:
  scope: 只收 auto_authorize.py 的功能概览（入口与输出契约、流水线位置与控制流、验证入口、配置项、支持行为、设计取舍）；实现深读归 feature-depth-huawei-maas-cdp-authorize
---
# 华为云 MaaS 委托授权自动化（auto_authorize.py）

## 现状

- **入口与输出契约**
- 脚本以 CLI 方式运行：`python auto_authorize.py --cdp-url http://127.0.0.1:9333 --json`，入口 `main()` 解析 `--cdp-url`、`--timeout`（默认 45 秒）和 `--json` 三个参数。核心函数 `auto_authorize(cdp_url, timeout_s=45)` 返回结果 dict：成功时 `make_success("authorize", ...)` 携带 `auth_done`、`skipped_reason`、`disclaimer_handled`；
  - 失败时 `make_failure(stage, error)`，stage 取值包括 `connect_failed`、`navigate_failed`、`click_failed`、`dialog_timeout`、`confirm_not_found`、`success_timeout`、`exception`。进程退出码为 `0`（ok）或 `1`，结果经 `output_json` 输出。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215–L230
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L215-L230`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L104
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L104`）
- **在 Skill 流水线中的位置与控制流**
- 脚本是 huawei-cloud-maas-setup Skill 的一个步骤，前置依赖 `ensure_browser.py` 启动浏览器并暴露 CDP、`navigate.py` + ask_user 完成用户登录。它通过 `lib.cdp_client.connect_page` 以 Playwright 连接已有浏览器页面，流程为：导航到 MaaS 首页 → 等待 SPA 渲染 → 处理服务声明弹窗 → 检测授权警告 → 点"此处"链接（兜底点警告条本身）→ 确认对话框 → 点"确定" → 等待"权限更新成功"提示。
  - 选择器与 URL 常量来自 `lib.huawei_selectors`，结果结构来自 `lib.flow_state`。文档字符串明确约束：不向上层抛异常，失败时返回 `{ok:false, stage:"authorize"}`，由 Skill 决定是否降级为手动模式。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L3–L19
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L3-L19`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L106–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L106-L133`）
- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 所示文件中未包含针对 auto_authorize 的测试；可见的验证途径是脚本自身的 `--json` 模式：以真实 CDP 浏览器手动运行，通过退出码和输出 dict 中的 `ok`/`stage`/`skipped_reason` 字段核对各阶段结果。实现内部各失败 stage（`connect_failed` 到 `success_timeout`）构成了可观测的分阶段检查点。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215–L230
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L215-L230`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L168–L195
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L168-L195`）
- **配置项与默认值**
- CLI 仅有三个参数：`--cdp-url`（默认空字符串）、`--timeout`（int，默认 45，作为 `timeout_s` 传入 `auto_authorize`）和 `--json` 开关。`--cdp-url` 为空时调用 `lib.cdp_client.resolve_cdp_url()` 兜底解析；解析结果仍为空则以 stage `init` 失败、退出码 1。授权警告的判定依赖硬编码的 `#authGlobalMessage` 容器选择器和 `_AUTH_WARNING_KEYWORDS` 关键词元组（如"权限不足"、"尚未授权"等），均不可通过参数配置。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215–L230
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L215-L230`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L57–L80
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L57-L80`）
- **支持的授权自动化行为**
- 脚本通过 CDP（`connect_page`，15s 超时）接入已登录的浏览器，导航到 MaaS 首页（30s 超时）后完成：处理首次访问的服务声明弹窗（`handle_disclaimer`）、检测授权警告、点击"此处"链接（找不到或点击失败时兜底点击警告元素本身）、等待授权对话框（10s）、点击"确定"（5s）、等待"权限更新成功"提示（15s）。检测逻辑优先读 `#authGlobalMessage` 容器文本匹配关键词；
  - 容器不可用时退化为 `SELECTOR_AUTH_WARNING` 选择器快照，仅当回退警告元素的文本读取抛异常时才直接认定存在警告，其余路径未命中即返回 False 并以 `skipped_reason="no_warning"` 视为已授权。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L133
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L133`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L76–L95
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L76-L95`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L168–L205
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L168-L205`）
- **设计取舍：降级优先与超时预算**
- 脚本采用"失败不中断"的折中策略：文档字符串（L15–L18）声明不向上层抛异常、失败时返回 `{ok:false, stage:...}` 由 Skill 决定是否降级为手动模式，理由是用户可能已授权只是检测未识别；但实现中 `auto_authorize` 入口处的 `emit_progress(0, 5, ...)`（L100）在两个 try 块之外，并非所有路径都保证返回结构化结果。
  - 另一处权衡是超时预算：docstring 要求整个流程 ≤30s（L19），而各阶段独立超时（导航 30s、对话框 10s、成功提示 15s，L110/L170/L189）加上固定 sleep（2.5s/1.5s/1.0s，用于等 SPA 渲染与动画，与选择器等待并存而非替代）理论上可远超 30s，且 `timeout_s` 参数（默认 45，L98、L218、L228）在函数体内未被使用，文档约束与实现不一致。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L15–L19
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L15-L19`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98–L112
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L98-L112`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L168–L195
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L168-L195`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-huawei-maas-cdp-authorize.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L215-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L3-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L106-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L168-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L57-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98-L133
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L76-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L168-L205
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L15-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py:L98-L112
- 源页字段（feature）：huawei-maas-cdp-authorize
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py
