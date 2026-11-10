---
name: feature-depth-hooks
description: 生命周期 Hooks 与扩展实现深读：transport 扩展按 manifest 整体跳过、单根路径加载失败隔离、shutdown_all_extensions 行为、ExtensionManager 构造与 list_extensions、extension_dirs 解析去重、依赖关系、requires_transport 单测
metadata:
  scope: 只收 ExtensionManager 加载、关闭与目录解析的实现级证据和单测断言；功能概览归 feature-hooks
---
# 生命周期 Hooks 与扩展：实现深读

## 现状

- [[feature-hooks]]（功能概览） · [[extensions-plugins-overview]]（owner 入口）
- **transport 扩展按 manifest 标志整体跳过** 设计推断（非作者历史意图）：
- Runtime 直连（include_transport_extensions=False）时依据 manifest 的 requires_transport is True 直接跳过整个扩展包并记 info 日志，而不是逐能力选择性挂载。推断：收益是加载路径简单、避免无传输层的宿主挂载不可用扩展；代价是同包内不依赖 transport 的能力也一并丢失，且该过滤完全信任 manifest 声明。
- 来源：[jiuwenswarm/extensions/manager.py:L90–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L90-L100)
- **单根路径加载失败的隔离** load_all_extensions 对每个扩展根路径各自 try/except：当 load_manifest 或 load_extension 抛出任意 Exception 时，108-109 行捕获并 logger.error 记录路径与异常，for 循环继续处理下一个 root，异常不向外重抛。该分支只证明单个失败根路径被跳过且循环继续推进，不构成对其余扩展必然加载成功的保证。
- 来源：[jiuwenswarm/extensions/manager.py:L89–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L89-L109)
- **shutdown_all_extensions：hasattr 探测 shutdown 并 await，except Exception 记 warning 继续，循环后清空** 遍历 _loaded_extensions，仅对 hasattr(ext, "shutdown") 为真的条目 await ext.shutdown()；单项抛出的 Exception 被捕获记录 warning 后继续下一项；for 循环结束后执行 _loaded_extensions.clear()。
- 来源：[jiuwenswarm/extensions/manager.py:L111–L118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L111-L118)
- **ExtensionManager.__init__ 需注入 ExtensionRegistry；list_extensions 仅列带 metadata 条目** 构造签名 __init__(self, registry: ExtensionRegistry)：调用方须传入 registry，内部自建 ExtensionLoader(registry) 与空 _loaded_extensions，并调用 _setup_search_paths()；list_extensions() 只返回带 metadata 条目的 id/name/version 字典。
- 来源：[jiuwenswarm/extensions/manager.py:L58–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L58-L65),
  - [jiuwenswarm/extensions/manager.py:L120–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L120-L125)
- **extensions.extension_dirs 仅认 ';' 分割字符串，追加默认 jiuwenswarm/extensions 后按小写段去重** _extension_dir_paths_from_config 仅当 extensions.extension_dirs 为字符串时按 ';' 拆分并去空白段，随后追加 _DEFAULT_EXTENSION_DIR（"jiuwenswarm/extensions"）；_dedupe_extension_dirs 按小写路径段去重且保留首次出现，配置路径因此排在默认路径之前。
- 来源：[jiuwenswarm/extensions/manager.py:L10–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L10-L11),
  - [jiuwenswarm/extensions/manager.py:L31–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L31-L33),
  - [jiuwenswarm/extensions/manager.py:L36–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L36-L45),
  - [jiuwenswarm/extensions/manager.py:L48–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L48-L54)
- **调用方注入 ExtensionRegistry，自建 ExtensionLoader 并依赖 common.config/common.utils** ExtensionManager 接收调用方注入的 ExtensionRegistry，__init__ 内自建 ExtensionLoader(registry) 并持有空 _loaded_extensions；模块导入 jiuwenswarm.common.config.get_config 以及 jiuwenswarm.common.utils 的 get_root_dir 与 logger。
- 来源：[jiuwenswarm/extensions/manager.py:L4–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L4-L7),
  - [jiuwenswarm/extensions/manager.py:L58–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L58-L64)
- **扩展加载 requires_transport 真布尔门控的运行时单测** pytest 用例 test_transport_manifest_flag_requires_a_real_boolean 用 object.__new__ 构造 ExtensionManager，注入仅伪造发现/manifest/加载的 FakeLoader，实际运行 load_all_extensions：include_transport_extensions=False 时断言仅加载 requires_transport="false"（字符串）与缺键路径、排除 True；
  - 为 True 时断言三项全载。仅覆盖加载门控分支，未断言生命周期 hook 副作用。
- 来源：[tests/unit_tests/test_extension_manager.py:L8–L14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_extension_manager.py#L8-L14),
  - [tests/unit_tests/test_extension_manager.py:L68–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_extension_manager.py#L68-L103)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-depth-hooks.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L90-L100；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L89-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L4-L7；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L58-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L111-L118；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L58-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L120-L125；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L10-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L31-L33；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L36-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py:L48-L54；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_extension_manager.py:L8-L14
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_extension_manager.py:L68-L103
- 源页字段（feature）：hooks
- 入口（entry_points）：jiuwenswarm/extensions/manager.py
- 源页字段（source_globs）：jiuwenswarm/extensions/manager.py；jiuwenswarm/extensions/*.py
