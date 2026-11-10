---
name: feature-maas-auto-open-models
description: 华为云 MaaS 预置服务批量开通脚本 auto_open_model.py 功能概览：CLI 参数与 make_failure 返回契约、--model/--models-file/--type-filter/--timeout 默认值、批量弹窗开通与状态回读、完成判定轮询与批量入口取舍
metadata:
  scope: 只收 auto_open_model.py 的功能概览（入口与返回契约、命令行参数、批量开通与状态回读、运行时自检、设计取舍）；实现深读归 feature-depth-maas-auto-open-models
---
# 华为云 MaaS 预置服务批量开通脚本 auto_open_model.py

## 现状

- **入口与返回契约**
- 脚本提供两层入口：CLI `main()`（参数 `--cdp-url`、可重复的 `--model`、`--models-file`、`--type-filter`、`--timeout`、`--json`）和核心函数 `auto_open_models(cdp_url, models, type_filter="文本生成", timeout_s=90)`。返回统一结果字典，成功路径经 `make_success("open_models", ...)` 携带 `opened`/`already_opened`/`failed`/`all_done`；
  - 连接、导航、表格加载失败分别返回 `make_failure("connect_failed"|"navigate_failed"|"table_timeout", ...)`，进程退出码按 `result["ok"]` 取 0/1。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L508–L527
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L508-L527`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L750–L812
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L750-L812`）
- **命令行参数与默认值**
- 模型来源优先级：多次指定的 `--model` 参数优先，否则从 `--models-file`（默认 `_DEFAULT_MODELS_FILE`）经 `_load_display_names` 读取，读不到则报 `init` 失败并退出。CDP 地址取 `--cdp-url`，为空时回退 `resolve_cdp_url()` 解析。`--type-filter` 默认 `文本生成`，用于按表格“类型”列过滤；`--timeout` 默认 90 秒（实际用于开通完成等待时被 `min(30, timeout_s)` 截断）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L770–L810
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L770-L810`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L655–L660
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L655-L660`）
- **批量开通与状态回读**
- 逐模型的"未找到/类型不符/无开通按钮视为已开通"检查只在寻找批量弹窗入口的循环中执行（L556–L582）：一旦某个模型成功打开弹窗即 break；其余 pending 模型不再做这些逐项检查，直接进入弹窗勾选流程（L613–L624），勾选失败仅在 emit 中警告，成功分支事后统一记入 failed。开通完成后脚本重载表格，逐个回读 checked_models 的状态列，含"已开通"才计入 opened，否则或找不到行均记失败。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L556–L606
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L556-L606`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L613–L627
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L613-L627`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686–L720
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L686-L720`）
- **开通结果的运行时自检**
- 点击"一键开通"后，完成判定轮询多个信号：订阅按钮从 DOM 消失、弹窗不可见（或查询弹窗可见性抛异常即视为成功）、出现成功提示，任一命中即算 success（L655–L684）；成功后重载表格逐模型回读状态列验证"已开通"（L686–L715）。未勾选模型的失败记录只在成功分支补记（L721–L727），超时分支只把 checked_models 记为"等待开通完成超时"（L732–L738）；CLI 以 result["ok"] 决定退出码 0/1（L808–L812）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L655–L684
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L655-L684`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686–L727
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L686-L727`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L732–L738
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L732-L738`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L808–L812
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L808-L812`）
- **批量入口策略：文档化动机与启发式完成判定**
- Inference / 设计推断（非作者历史意图）：
- docstring（L516–L518）明确记录的取舍是：只搜索第一个可开通的模型并借其批量订阅弹窗一次性勾选全部目标、点击一次"一键开通"，以避免逐模型搜索+开通的冗余操作；代价是 pending 模型不再做逐项的类型/入口检查，未能在弹窗中勾选的模型只 emit 警告并在成功分支事后补记失败。完成判定（L655–L684）采用启发式轮询——订阅按钮消失、弹窗不可见或成功提示任一命中即算成功——并因"弹窗关闭 ≠ 开通生效"（L687 注释）在成功后重载表格逐模型回读"已开通"状态作为最终验证（此为代码行为分析，非文档声明的动机）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L514–L519
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L514-L519`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L655–L684
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L655-L684`）,
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686–L705
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L686-L705`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-maas-auto-open-models.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L508-L527
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L750-L812
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L770-L810
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L655-L660
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L556-L606
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L613-L627
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686-L720
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L655-L684
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686-L727
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L732-L738
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L808-L812
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L514-L519
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py:L686-L705
- 源页字段（feature）：maas-auto-open-models
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py
