---
name: runtime-marketplace-contracts-01
description: runtime-marketplace 源码接口与集成边界 01：jiuwenswarm/server/runtime/marketplace 下 __init__、asset_mcp_publish_converter、asset_package_builder、asset_publish_*（adapters、api、models、service、store）、hub_asset_installer、hub_asset_port、hub_asset_type_adapter、hub_avatar_cache、hub_catalog_cache 共十三个文件的静态声明
metadata:
  scope: 只收 marketplace 目录按字母序前十三个文件的静态声明，不证明运行行为；hub_install_state 起的其余文件归 runtime-marketplace-contracts-02，入口说明归 runtime-marketplace-overview
---
# runtime-marketplace 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/runtime/marketplace/__init__.py`**
- 源码对模块职责的说明：Shared clients and state for remote Jiuwen marketplaces.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.server.runtime.marketplace.hub_client import HubClient`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/__init__.py#L1-L7)。
- **`jiuwenswarm/server/runtime/marketplace/asset_mcp_publish_converter.py`**
- 源码对模块职责的说明：Turn an authorized custom configuration into a portable, credential-free source.。
- `CustomMcpSource` 定义类型边界。
- 调用入口 `convert_mcp_config(config, identity, metadata, output_dir)`；声明返回 `Path`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`import ipaddress`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_mcp_publish_converter.py#L1-L218)。
- **`jiuwenswarm/server/runtime/marketplace/asset_package_builder.py`**
- 源码对模块职责的说明：Bounded, deterministic publishing snapshots; never mutate installed assets.。
- `PackageBuildError` 继承 `ValueError`；方法入口：`__init__`。
- `PackageLimits` 定义类型边界。
- `PreparedPackage` 定义类型边界。
- 调用入口 `collect_publish_files(root, limits, exclude_paths)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from dataclasses import dataclass`；`from contextlib import ExitStack, contextmanager`；`import hashlib`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_package_builder.py#L1-L372)。
- **`jiuwenswarm/server/runtime/marketplace/asset_publish_adapters.py`**
- 源码对模块职责的说明：Offline validation and normalization of private publish snapshots.。
- `PublishValidationError` 继承 `ValueError`；方法入口：`__init__`。
- 调用入口 `normalize_and_validate(snapshot, identity, metadata)`；声明返回 `dict[str, object]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import re`；`from pathlib import Path, PureWindowsPath`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_publish_adapters.py#L1-L513)。
- **`jiuwenswarm/server/runtime/marketplace/asset_publish_api.py`**
- 源码对模块职责的说明：Web publishing boundary: server-resolved resources and credential-bound history.。
- `PublishAPIError` 继承 `ValueError`；方法入口：`__init__`。
- 调用入口 `resolve_local_asset(kind, local_id)`。
- `AssetPublishAPI` 定义类型边界；方法入口：`__init__`, `scope`, `start`, `close`, `call`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import hmac`；`import json`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_publish_api.py#L1-L346)。
- **`jiuwenswarm/server/runtime/marketplace/asset_publish_models.py`**
- `PublishProtocolError` 继承 `ValueError`。
- `PublishIdentity` 定义类型边界。
- `PublishResult` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`import re`；`from typing import Literal`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_publish_models.py#L1-L58)。
- **`jiuwenswarm/server/runtime/marketplace/asset_publish_service.py`**
- 源码对模块职责的说明：Internal orchestration for one workspace's publishing operations.。
- `AssetPublishService` 定义类型边界；方法入口：`__init__`, `start`, `cleanup`, `prepare`, `commit`, `status`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from collections.abc import Callable`；`from dataclasses import replace`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_publish_service.py#L1-L398)。
- **`jiuwenswarm/server/runtime/marketplace/asset_publish_store.py`**
- 源码对模块职责的说明：Durable publish drafts and single-attempt tasks. Credentials never enter this API.。
- `PublishStoreError` 继承 `RuntimeError`；方法入口：`__init__`。
- `PublishStore` 定义类型边界；方法入口：`__init__`, `save_draft`, `get_draft`, `commit_draft`, `operation_request`, `start`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from contextlib import contextmanager`；`import json`；`import math`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/asset_publish_store.py#L1-L526)。
- **`jiuwenswarm/server/runtime/marketplace/hub_asset_installer.py`**
- 源码对模块职责的说明：Shared acquisition and commit flow for installable Hub asset packages.。
- `HubPackageExtractor` 继承 `Protocol`；方法入口：`download_and_extract`。
- `HubPackageInstallResult` 定义类型边界。
- 异步入口 `install_hub_asset_package(kind, asset_id, destination_root, state_store, package_name_validator, package_validator, conflict_validator, on_committed, on_rollback, hub_port, …)`；声明返回 `HubPackageInstallResult`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import json`；`import shutil`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_asset_installer.py#L1-L195)。
- **`jiuwenswarm/server/runtime/marketplace/hub_asset_port.py`**
- 源码对模块职责的说明：Stable downstream-facing port for remote marketplace assets.。
- `HubSearchRequest` 定义类型边界。
- `HubAssetQuery` 定义类型边界。
- `HubDownloadRequest` 定义类型边界。
- `HubAssetSummary` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from typing import Literal, Protocol`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_asset_port.py#L1-L114)。
- **`jiuwenswarm/server/runtime/marketplace/hub_asset_type_adapter.py`**
- 源码对模块职责的说明：Mapping between stable Jiuwenswarm kinds and evolving Hub type strings.。
- `HubAssetTypeContract` 定义类型边界；方法入口：`accepts`。
- `HubAssetTypeConflictError` 继承 `ValueError`。
- 调用入口 `resolve_hub_asset_kind(plugin_type, asset_type)`；声明返回 `HubAssetKind / None`。
- 调用入口 `get_hub_asset_type_contract(kind)`；声明返回 `HubAssetTypeContract`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from jiuwenswarm.server.runtime.marketplace.hub_asset_port import HubAssetK`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_asset_type_adapter.py#L1-L89)。
- **`jiuwenswarm/server/runtime/marketplace/hub_avatar_cache.py`**
- 源码对模块职责的说明：Small public Hub thumbnails, never persisted as signed URLs or original files.。
- 调用入口 `thumbnail(body)`；声明返回 `str`。
- `HubAvatarCache` 定义类型边界；方法入口：`__init__`, `get`, `fill`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import base64`；`from collections import OrderedDict`。
- 模块级配置或常量名称：`MAX_INPUT_BYTES`, `MAX_EDGE`, `MAX_THUMBNAIL_BYTES`, `MAX_ENTRIES`, `TTL`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_avatar_cache.py#L1-L112)。
- **`jiuwenswarm/server/runtime/marketplace/hub_catalog_cache.py`**
- 源码对模块职责的说明：Bounded, public-card-only Hub catalog cache with nonblocking refresh.。
- 调用入口 `safe_metadata(value, depth)`。
- `CatalogCards` 继承 `list`；方法入口：`__init__`。
- `HubCatalogCache` 定义类型边界；方法入口：`__init__`, `read`, `close`。
- 调用入口 `catalog_memory_scope(base_url, credentials, context)`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import copy`；`import hashlib`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_catalog_cache.py#L1-L382)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-marketplace/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
