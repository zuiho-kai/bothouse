---
name: feature-depth-rsi-packages
description: Harness Package 与热激活实现深读：发布 refs 解析链路、manifest 名称与原生基线配置、越界软链接等失败触发、RsiHarnessActivationStore.get_active、SDK 清单发现回退及其取舍、插件撤销单测
metadata:
  scope: 收 harness_activation.py 一带的逐点实现深读（流程、配置、失败、API、依赖、取舍、验证），来源另含 materializer.py、test_plugin_catalog.py；功能入口级知识归 feature-rsi-packages，评测优化的实现深读归 feature-depth-auto-harness
---
# Harness Package 与热激活：实现深读

## 现状

- [[feature-rsi-packages]]（功能概览） · [[auto-harness-overview]]（owner 入口）
- **发布 refs 解析链路** parse_published_harness_refs 以引擎产出的最终 refs 文件与 task_run_root 为输入：先把 refs 与 run 根目录解析为绝对路径并用 _ensure_inside 约束边界，随后调用 _load_refs。_load_refs 读取 YAML（OSError/UnicodeError/YAMLError 均归一为 _invalid 错误）并要求结果是 mapping，最终供上层校验 harness_refs 唯一 role 并返回 PublishedHarnessRef。
- 调用路径：`jiuwenswarm/agents/harness/common/rsi/harness_activation.py`（`parse_published_harness_refs`） → `jiuwenswarm/agents/harness/common/rsi/harness_activation.py`（`_load_refs`）
- 来源：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L221–L263](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L221-L263),
  - [jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L169–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L169-L178)
- **manifest 名称与原生基线配置** 包 manifest 按 _MANIFEST_NAMES = ("manifest.json", "harness_config.yaml", "expert_harness.yaml", "harness.yaml") 查找；无插件时的基线是模块同目录的 harness_config.yaml（_NATIVE_HARNESS_BASELINE_CONFIG）。
  - resolve_native_harness_baseline 在该文件不存在或其目录未通过 _validate_engine_manifest（抛 RsiHarnessInvalid）时返回 None，否则返回其 resolve 后的绝对路径。
- 来源：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L38–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L38-L40),
  - [jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L157–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L157-L166)
- **具体失败触发与传播** refs 文件缺失/不可读/非 mapping 时 _load_refs 抛 _invalid（RsiHarnessInvalid 类错误）；包内符号链接解析到包外时 _ensure_package_tree_inside 以 "Harness 包含越界软链接" 拒绝；RsiHarnessActivationStore._validate_runtime_path 对不在 activation root 内的 runtime_path 抛 ValueError，require_exists 且目录不存在时返回 None 而非报错。
- 来源：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L169–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L169-L178),
  - [jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L86–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L86-L96),
  - [jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L321–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L321-L331)
- **RsiHarnessActivationStore.get_active：active 为 dict 且 runtime_path 通过 require_exists=True 校验才返回 dict(active)，否则 None** get_active() 无参数：读取文档 active 字段，非 dict 返回 None；runtime_path 经 _validate_runtime_path(require_exists=True) 返回 None（如目录不存在）时也返回 None，校验通过则返回 dict(active)。
  - runtime_path 解析后不在 self.root 内时抛 ValueError「RSI Harness runtime_path 不在 activation root 内」。
- 来源：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L338–L344](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L338-L344),
  - [jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L324–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L324-L331)
- **清单发现依赖 openjiuwen SDK，ImportError 时回退本地 _MANIFEST_NAMES 匹配** `_find_manifest` 优先 `from openjiuwen.harness.resources import find_plugin_manifest` 并 `resolve(strict=True)`；
  - `ImportError` 时置 `None` 回退，按 `_MANIFEST_NAMES` 顺序 `is_file()` 匹配（注释声明 manifest.json 优先于 legacy YAML），全部缺失抛 `_invalid("Harness 包缺少配置文件")`。
- 来源：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L99–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L99-L115)
- **SDK 优先加本地回退换取旧 SDK 兼容，代价是清单名元组重复定义（推断）** 设计推断（非作者历史意图）：
- 收益：无公开 loader 的旧 SDK 仍可按文件名发现清单（回退分支注释标明兼容旧 SDK）；代价：清单文件名列表在 harness_activation 的 `_MANIFEST_NAMES` 与 materializer 的同名元组各定义一份，两处需人工保持同步。
- 来源：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L38–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L38-L38),
  - [jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L104–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L104-L115),
  - [jiuwenswarm/agents/harness/common/rsi/materializer.py:L27–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/materializer.py#L27-L28)
- **test_registration_undo_preserves_preexisting_import：断言 undo() 后插件许可被撤销而插件目录保留** 该 pytest 用例注册 `rsi-harness-aabbcc`、upsert installed=False 后再次注册取 undo，断言撤销前 is_plugin_allowed(package_id) 为 True、undo() 后为 False，且 resolve_plugin_dir(package_id).is_dir() 仍为 True。
- 来源：[tests/unit_tests/rsi/test_plugin_catalog.py:L103–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/rsi/test_plugin_catalog.py#L103-L112)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/auto-harness/feature-depth-rsi-packages.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L221-L263；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L169-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L38-L40；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L157-L166
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L86-L96；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L321-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L99-L115；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L38-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L104-L115；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/materializer.py:L27-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/rsi/test_plugin_catalog.py:L103-L112；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L338-L344
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L324-L331
- 源页字段（feature）：rsi-packages
- 入口（entry_points）：jiuwenswarm/agents/harness/common/rsi/harness_activation.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/rsi/harness_activation.py；jiuwenswarm/agents/harness/common/rsi/*
