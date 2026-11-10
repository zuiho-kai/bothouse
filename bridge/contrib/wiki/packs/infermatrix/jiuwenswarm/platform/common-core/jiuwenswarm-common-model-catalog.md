---
name: jiuwenswarm-common-model-catalog
description: 模型目录、稳定选择与配置校验：业务 ID 补齐与 save_models_candidate 写路径、get_default_models/get_available_models、ModelSelection DTO、脱敏目录视图、validate_models_config 与连通性探测
metadata:
  scope: 只收共享配置模型的目录、选择 DTO、写路径与校验；登录模型凭据的产生与续期归 jiuwenswarm-common-auth，common 模块总览归 jiuwenswarm-common-1、jiuwenswarm-common-2
---
# 模型目录、稳定选择与配置校验

## 现状

### 职责和边界

- 说明共享配置模型的稳定业务 ID、目录视图、选择 DTO、候选写入与校验；登录凭据的产生和续期由 login-auth 拥有。

### 模型目录：快照、业务 ID 与写路径

- 持久化标识由 `_ensure_model_business_ids` 补齐：`defaults`/`agentos` 条目缺 `model_id` 时补 `mdl_<uuid4hex>`，groups 补 `mgp_` 前缀、routes 补 `rte_` 前缀。
  - `save_models_candidate` 校验候选后原子替换 models 段：deepcopy → 补 ID → `raise_if_invalid` → `update_config` 内只替换 `data["models"]`，校验失败时完全不写盘（[config.py L1547-L1572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1547-L1572)、
  - [L1609-L1621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1609-L1621)）。
  - `migrate_model_business_ids` 幂等：无变化时 mutator 返回 None 直接跳过写盘（[L1575-L1590](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1575-L1590)；
  - 选择器 `test_legacy_migration_only_adds_stable_ids`，[test_model_selection_migration.py L62-L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_model_selection_migration.py#L62-L99)）。
- `upsert_model_resource` 从 `get_config_raw().models` 出发（未做 env 解析的原文），按 `model_id` 合并或追加；`_normalize_model_entry` 把前端扁平字段提升为嵌套结构（`model_provider`/`client_provider` 统一写 `client_provider`，`endpoint_profile`/`vendor_key`/`plan` 仅真值保留，`temperature` 转 float，`reasoning_level` 去空白）；
  - `_merge_model_update` 跳过 `source`/`is_agentos`/`read_only`/`write_only_fields` 展示字段并递归合并 dict，
  - 因此省略的 write-only 字段（`api_key`、`custom_headers`）保持原值（[config.py L1624-L1733](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1624-L1733)；选择器 `test_model_update_preserves_omitted_write_only_values`）。
  - 组 upsert 会剥掉 legacy `routing` 键（model-pool 模式下不生效）并给 routes 补默认 `route_id`。
- `get_default_models` 读取优先级：`models.defaults`（列表）→ 旧格式 `models.default`（单对象包装成列表）→ 环境变量兜底条目（`API_BASE`/`API_KEY`/`MODEL_NAME`/`MODEL_PROVIDER`/`ENDPOINT_PROFILE`/`CUSTOM_HEADERS`，固定 `timeout: 1800`、`verify_ssl: False`）。
  - 所有分支最后都追加 `get_agentos_models` 的条目，且 agentos 条目强制 `is_default=False`、在 `model_config_obj._source` 打 `agentos` 标（前端置灰只读展示），
  - `model_name` 为空视为未配置直接跳过（[config.py L1736-L1781](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1736-L1781)、
  - [L1496-L1540](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1496-L1540)）。
  - `_infer_is_default` 按 `model_name` 分组推断默认标记，不是全目录范围（[L1416-L1459](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1416-L1459)）。
- `get_available_models` 组合配置与登录来源的模型清单：登录送的模型永远叠加在配置模型**之后**（`models.list` 的 origin_index 就是此处下标，保存设置按它回写 `models.defaults`，排到前面会把下标写串），同名以用户自配为准且按原样比较、不做大小写归一（`GLM-5.2` 与 `glm-5.2` 是两个模型）；
  - 登录模型不落 config.yaml，必须传 `session_id` 才会叠加，登录模块失败只降级为已配置列表（[config.py L1784-L1830](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1784-L1830)）。
  - `update_default_model_provider_in_config` 只改默认条目（首个 `is_default: true`，无标记则取 defaults 第一条），且是裸 `load_yaml_round_trip`/`dump_yaml_round_trip` 写法，
  - 不走写锁——与 [[common-core-rules]]（rules.md） JIUWENSW-I4 列的旧写法同类（[L1877-L1916](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1877-L1916)）。

### 模型选择 DTO、目录视图与校验

- `ModelSelection` DTO `extra="forbid"`：`id`/`route_id` 去空白后非空，
  - `route_id` 只在 `type == "model_group"` 时合法（[model_selection.py L10-L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_selection.py#L10-L38)；选择器 `test_single_model_selection_rejects_route_id`）。
  - `ModelCatalog` 构造时经 `load_models_config` 建快照（解密后的 defaults/agentos、groups、按 `model_id` 索引的 `by_id`），
  - `get_model`/`get_group` 查不到抛 `ModelSelectionError(MODEL_SELECTION_NOT_FOUND)`（[model_catalog.py L80-L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L80-L95)、
  - [config.py L1593-L1606](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L1593-L1606)）。
- 目录对外输出是脱敏视图：`list_public_models` 只暴露 `model_id`/`alias`/`model_name`/`provider`/`source`/`is_agentos`/`is_default`/`enabled`/`context_window`，不含 `api_key`/`api_base`；`get_public_model_detail` 额外剥掉 write-only 的 `model_client_config.api_key`/`custom_headers` 并在 `write_only_fields` 里声明，
  - agentos 条目 `read_only=True`（[model_catalog.py L97-L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L97-L137)；选择器 `test_catalog_is_desensitized`、`test_model_detail_is_editable_without_exposing_write_only_values`）。
  - `find_references` 按 type==model 扫组内 routes，另扫会话 `metadata.json`、cron jobs 和 `agents`/`team` 配置树里内嵌的 `model_selection`，
  - 结果去重保序（[model_catalog.py L153-L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_catalog.py#L153-L188)；选择器 `test_catalog_finds_agent_and_team_references`）。
- `validate_models_config` 的错误分类：三段必须是数组；`model_id` 在 defaults+agentos 合并范围内查重；agentos 条目 `is_default: true` 直接报错；默认组最多一个且默认组不允许 `enabled: false`；
  - 每组至少一条 route，route 必须引用存在的 `model_id`，组内 `route_id` 查重（[model_config_validation.py L203-L272](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L203-L272)）。
  - `request_overrides`/`request_config` 拒绝 `FORBIDDEN_REQUEST_KEYS`（`model`/`messages`/`tools`/`stream`/`api_key`/`provider`/`client_provider`/`timeout_seconds`/`context_window`/`_source` 等 17 键），防止 patch 覆盖接线字段；
  - `routing.strategy` 只接受 None/`ordered-failover`/`tag-filtered`，legacy strategy 只为升级兼容保留、不执行也不转发（[L150-L198](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L150-L198)）。
- 占位凭证识别 `is_placeholder_model_entry`：`example.com/.org/.net` 域（含子域）、`https://example.com/compatible-mode/v1`、`your-model-name`、
  - `sk-xxxxxxxxx`（[model_config_validation.py L16-L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L16-L19)、
  - [L122-L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L122-L141)；选择器 `tests/unit_tests/common/test_model_config_validation.py` 前 4 个用例）。
  - 连通性探测 `probe_model_connection` 按默认 `token_limits=(3, 16)` 逐档放大 `max_tokens` 重试；content、`reasoning_content` 或 `usage_metadata.output_tokens > 0` 任一非空才算有输出（推理模型可能把小预算全花在 reasoning 上）；
  - 最后一次失败原样抛给调用方，`timeout_seconds` 用 `asyncio.wait_for` 包住每次完整调用（[L30-L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/model_config_validation.py#L30-L119)）。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-common-2]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（原模块架构与入口）
- [[jiuwenswarm-common-auth]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/jiuwenswarm-common-model-catalog.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_catalog.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_config_validation.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/model_selection.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_model_selection_migration.py
