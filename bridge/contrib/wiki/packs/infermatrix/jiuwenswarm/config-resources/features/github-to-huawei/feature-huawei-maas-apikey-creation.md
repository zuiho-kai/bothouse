---
name: feature-huawei-maas-apikey-creation
description: 华为云 MaaS API Key 自动创建与捕获（auto_create_apikey）功能概览：CLI 参数与 ok 返回契约、CDP 浏览器七步流程、选择器库分层、时间后缀与硬编码常量、_is_plausible_key 校验与失败 stage 诊断
metadata:
  scope: 只收 auto_create_apikey 的功能概览（入口与返回契约、分层、可配置项与常量、验证与自检、端到端流程）；实现深读归 feature-depth-huawei-maas-apikey-creation
---
# 华为云 MaaS API Key 自动创建与捕获（auto_create_apikey）

## 现状

- **入口与返回契约**
- CLI 入口 `main()` 提供 `--cdp-url`（默认空，回退 `resolve_cdp_url()`）、`--tag`（默认 `jiuwenswarm`）、`--description`（默认 `jiuwenswarm-config`）、`--timeout`（默认 30）、`--json`（已声明）参数，输出结果 JSON 并以 `ok` 字段决定退出码 0/1。
  - 核心函数 `auto_create_apikey()` 在 try/except 包裹的主流程内失败时返回 `make_failure(stage, error)` 字典（如 `insufficient_balance`、`create_btn_not_found`），成功返回 `make_success` 附带 `api_key`、`tag`、`dialog_closed`；但后缀生成/日志与 argparse 解析发生在异常处理之外，故并非所有失败路径都走该 JSON 契约。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L207–L238
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L207-L238`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L363–L406
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L363-L406`）
- **分层：流程编排与选择器库**
- `auto_create_apikey.py` 负责七步流程编排（连接 CDP、导航、点创建按钮、填表、提交、轮询检测、提取 Key），DOM 定位部分委托给 `lib/huawei_selectors.py` 的 `SelectorSet`（CSS 优先、文本兜底），但权限选择（`_select_permission_all`）和页面文本预览等处也直接调用 `page.locator`。`SelectorSet.first_visible` 用于可选/检测类元素的即时快照，`wait_first` 用于必然出现元素的等待，配合 `click_wait_first` 等高层函数。
  - 选择"全部"权限失败时保持默认值不中断，关闭弹窗失败仍返回成功（`dialog_closed=false`）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L240–L331
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L240-L331`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L34–L66
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L34-L66`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L356–L370
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L356-L370`）
- **可配置项与固定常量**
- 用户可配置项为 CLI/函数参数：`cdp_url`、`tag`（默认 `jiuwenswarm`）、`description`（默认 `jiuwenswarm-config`）、`timeout_s`（默认 30），另有已声明但未使用的 `--json` 标志。运行时会在 tag/description 后追加 UTC 时间后缀（`YYYYMMDD_HHMMSS`）避免标签重复。目标页面 URL（`MAAS_APIKEY_URL`）、充值链接与实名认证链接是硬编码常量，不通过参数暴露。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380–L404
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L380-L404`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L228–L232
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L228-L232`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L93–L108
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L93-L108`）
- **验证：运行时可观测性与自检**
- 所示输入未包含针对该脚本的自动化测试入口，可确认的验证机制是运行时自检与诊断输出：提取的 Key 需通过 _is_plausible_key（非空、长度 ≥30、非纯数字）才算成功，否则返回 extract_failed 并建议手动复制后经 ask_user 填入。失败分支附带诊断线索——如 create_btn_not_found 返回 page_url 与 1500 字符的页面文本预览（_page_text_preview），insufficient_balance/realname_required 分别附带 recharge_url/realname_url；
  - 流程通过 emit/emit_progress 输出 0–7 步进度事件，CLI 以结果 ok 字段决定退出码 0/1。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L81–L83
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L81-L83`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L250–L260
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L250-L260`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L315–L330
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L315-L330`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L399–L406
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L399-L406`）
- **自动创建并捕获 API Key 的端到端流程**
- 脚本通过 CDP 接入用户已登录的浏览器，在华为云 MaaS 控制台的 API Key 管理页自动完成整条链路：点击"创建 API Key"、填写自动加了时间戳后缀的标签与描述、best-effort 选择"全部"权限、点击"确定"提交，随后在 14 秒轮询窗口内检测结果弹窗（copy-key-modal）以及欠费、未实名认证两类错误提示并返回对应 stage。成功时从结果弹窗提取完整 Key，经 `_is_plausible_key`（长度 ≥30 且非纯数字）校验后随 `make_success` 返回，并 best-effort 点击复制按钮和"我已保存，确认关闭"关闭弹窗。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L240–L331
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L240-L331`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L341–L370
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L341-L370`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L81–L83
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L81-L83`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-huawei-maas-apikey-creation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L207-L238
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L363-L406
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L240-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L34-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L356-L370
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L380-L404
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L228-L232
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py:L93-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L81-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L250-L260
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L315-L330
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L399-L406
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py:L341-L370
- 源页字段（feature）：huawei-maas-apikey-creation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py
