---
name: feature-depth-maas-auto-open-models
description: auto_open_model.py 实现深读：main 调用 auto_open_models 与 ok 返回、CLI 契约与模型来源优先级、connect/navigate/table_timeout 失败 stage、connect_page 依赖、批量弹窗收益与逐模型回读代价、SKILL.md 手动流程（未执行）
metadata:
  scope: 收 auto_open_model.py 的实现深读条目（流程、接口、配置、失败模式、依赖、取舍、验证），来源另含 SKILL.md、cdp_client.py、flow_state.py；功能概览归 feature-maas-auto-open-models
---
# 华为云 MaaS 预置服务批量开通自动化（CDP）：实现深读

## 现状

- [[feature-maas-auto-open-models]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main 解析参数后调用 auto_open_models 并按 result.ok 返回 0/1** main 先解析 argv，cdp_url 为空时回退 resolve_cdp_url()；--model 优先，否则从 --models-file 读取展示名，然后调用 auto_open_models(cdp_url, models, type_filter, timeout_s)，output_json 输出结果并返回 0 if result.get("ok") else 1（此返回值是 main 的局部返回，非直接证明进程退出码）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L770–L812
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L770-L812`）
- **main(argv) 的 CLI 契约：可重复 --model、--models-file、--type-filter、--timeout、--json** 调用方通过 argv 传入 --cdp-url（默认空字符串）、可多次指定的 --model（优先于 --models-file）、--models-file（默认 _DEFAULT_MODELS_FILE）、--type-filter（默认 "文本生成"）、--timeout（int，默认 90 秒）与 --json 开关；返回 int，成功路径取决于 result.get("ok")。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L770–L812
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L770-L812`）
- **模型来源优先级：--model（可重复）优先，其次 --models-file；cdp-url 空则回退 resolve_cdp_url()** args.model 非空时逐个 strip 作为模型列表；否则从 args.models_file 加载展示名。cdp_url 取 args.cdp_url 去空白，为空时调用 resolve_cdp_url()。--type-filter 默认 "文本生成"（按预置服务列表“类型”列过滤），--timeout 默认 90。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L772–L810
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L772-L810`）
- **连接/导航/表格加载失败时返回 make_failure 统一 JSON（ok=false, stage, error），由 main 以本地返回码 1 输出** connect_page 抛异常返回 make_failure("connect_failed")；goto 抛异常或 _wait_table_ready 为假分别返回 stage=navigate_failed 与 stage=table_timeout（提示可能未登录）。make_failure 构造 {"ok": False, "stage": …, "error": …, **extra}；
  - main 输出 JSON 并按 result.get("ok") 本地 return 0/1，不证明进程退出码语义之外的行为。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L523–L548
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L523-L548`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py:L9–L17
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py#L9-L17`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L808–L812
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L808-L812`）
- **SKILL.md 步骤 5 给出的 documented_manual 验证流程（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 既有文档化手工流程：依次运行 navigate.py 跳转 deployment 页与 `auto_open_model.py --json --cdp-url <CDP_URL> --models-file <skill_dir>/models.json --timeout 90`，期望 stdout 返回 ok=true、stage=open_models 且 opened/already_opened/failed 分列。此为文档记载的操作与预期结果，本轮未执行，不构成运行时证据。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L373–L396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md#L373-L396)
- **依赖 lib.cdp_client.connect_page 与 lib.huawei_selectors 选择器常量** auto_open_models 在 try 中调用 connect_page(cdp_url, timeout_ms=15_000)，任何异常经 make_failure("connect_failed", ...) 本地返回；
  - connect_page 经 pw.chromium.connect_over_cdp 连接后，默认复用 contexts[0] 的已有 page，仅当 context 无 pages 时才新建 page，并 set_default_timeout(timeout_ms)。行定位另依赖 huawei_selectors 导入的 MAAS_DEPLOYMENT_* 常量。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L523–L527
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L523-L527`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py:L208–L228
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py#L208-L228`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L49–L57
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L49-L57`）
- **批量弹窗减少重复操作的收益与需逐模型复核的代价（成功分支内）** 设计推断（非作者历史意图）：
- 推断：收益是按 L514–L519 的文档说明，通过一次批量订阅弹窗避免逐模型重复搜索+开通；代价是弹窗关闭≠开通生效，成功分支需关闭弹窗、等待 3 秒、reload 表格并逐个 checked_models 校验"已开通"状态（reload 异常仅记 debug 日志后继续校验），且 L556–L606 循环在首个成功打开弹窗的模型处 break。
- 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L514–L519
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L514-L519`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L555–L606
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L555-L606`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686–L705
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L686-L705`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-maas-auto-open-models.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L770-L812
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L772-L810
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L523-L548
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py:L9-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L808-L812
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/SKILL.md:L373-L396
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L523-L527
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py:L208-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L49-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L514-L519
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L555-L606
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686-L705
- 源页字段（feature）：maas-auto-open-models
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py
