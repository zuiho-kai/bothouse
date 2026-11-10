---
name: feature-depth-browser-tools
description: 浏览器服务与网页工具实现深读：Swarm 托管 Chrome 设置解析调用链、chrome_path 形态与优先级、内置运行时降级、profile 哈希隔离与 resolve_chrome_path 单测
metadata:
  scope: 只收浏览器设置解析、守卫分支与 profile 隔离的实现细节；功能概览归 feature-browser-tools
---
# 浏览器服务与网页工具：实现深读

## 现状

- [[feature-browser-tools]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **Swarm 托管 Chrome 设置解析调用链** apply_swarm_browser_settings 接收 RuntimeSettings、config 与 session_id，先调用 resolve_chrome_path 从 config.browser 提取 Chrome 路径；resolve_chrome_path 内部调用 resolve_env_vars 展开配置中的 ${VAR:-default} 占位符后读取 chrome_path。若路径为空或未选中 Electron 浏览器，则走 apply_session_sideview_target 分支；
  - 否则继续构造 managed 实例并返回替换了 instance 与 mcp_cfg 的新 RuntimeSettings。
- 调用路径：`jiuwenswarm/agents/swarm/browser_runtime.py`（`apply_swarm_browser_settings`） → `jiuwenswarm/agents/harness/common/browser_config.py`（`resolve_chrome_path`） → `jiuwenswarm/common/config.py`（`resolve_env_vars`）
- 来源：[jiuwenswarm/agents/swarm/browser_runtime.py:L26–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L26-L57),
  - [jiuwenswarm/agents/harness/common/browser_config.py:L12–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L12-L32),
  - [jiuwenswarm/common/config.py:L62–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L62-L99)
- **chrome_path 形态与工作区目录优先级** browser.chrome_path 可为字符串或按平台映射的 dict：先取 sys.platform 对应键（win32/cygwin→windows、darwin→macos、linux/linux2→linux），未命中再取 "default" 键，均无则返回 ""（文档默认值为空、留空走自动检测）。托管实例的 user_data_dir 派生自 get_user_workspace_dir()：优先缓存的已设值，其次 JIUWENSWARM_DATA_DIR 环境变量，最后 <用户主目录>/.jiuwenswarm。
- 来源：[jiuwenswarm/agents/harness/common/browser_config.py:L19–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L19-L32),
  - [jiuwenswarm/common/utils.py:L416–L433](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L416-L433),
  - [docs/zh/浏览器.md:L99–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L99-L119)
- **内置运行时不可用的降级行为** materialize_bundled_runtime 抛出任意异常时，resolve_playwright_mcp_launch 捕获并 logger.warning 提示降级，返回 source="pinned-npx-fallback" 的 PlaywrightMcpLaunch（固定 npx 命令与参数），该路径可能访问 npm 注册表；不向调用方传播异常。此外检测到旧版 .env 模板默认值时仅告警忽略，继续走内置运行时。
- 来源：[jiuwenswarm/common/playwright_mcp_runtime.py:L333–L381](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/playwright_mcp_runtime.py#L333-L381)
- **apply_swarm_browser_settings(settings, config, session_id, *, member_id='')：守卫分支返回 sideview 调用结果，越过守卫返回替换 instance/mcp_cfg 的新 settings** member_id 为仅关键字参数、默认空串。
  - 守卫 not chrome_path or not electron_browser_selected() 成立时返回 apply_session_sideview_target(settings, session_id, member_id=member_id, label=member_id)；越过守卫则第77行返回 replace(settings, instance=instance, mcp_cfg=mcp_cfg)。
- 来源：[jiuwenswarm/agents/swarm/browser_runtime.py:L26–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L26-L77)
- **守卫分支委托导入的 electron_sideview 助手；
  - resolve_chrome_path 的空串结果也会触发该守卫** 守卫 not chrome_path or not electron_browser_selected() 时转入 apply_session_sideview_target：该助手在 resolver 为空或 session_id 去空白后为空时原样返回 settings，否则写 PLAYWRIGHT_MCP_* env 并置 server_id=playwright_electron_<sha256([session_id, member_id])>；
  - config/browser 非字典时 resolve_chrome_path 返回空串即可触发守卫。
- 来源：[jiuwenswarm/agents/swarm/browser_runtime.py:L17–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L17-L22),
  - [jiuwenswarm/agents/swarm/browser_runtime.py:L39–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L39-L43),
  - [jiuwenswarm/agents/harness/common/electron_sideview.py:L214–L239](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/electron_sideview.py#L214-L239),
  - [jiuwenswarm/agents/harness/common/browser_config.py:L12–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L12-L32)
- **仅托管分支按 stripped 身份哈希分配 profile：隔离收益与不可共享代价（均为推断）** 设计推断（非作者历史意图）：
- 托管分支的 user_data_dir=workspace/.browser-profiles/<key>，key='swarm_'+sha256([session_id.strip(), member_id.strip()])。收益（推断）：不同身份的浏览器状态互相隔离；代价（推断）：不同身份无法共享同一 profile。
- 来源：[jiuwenswarm/agents/swarm/browser_runtime.py:L47–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L47-L57)
- **browser_config.resolve_chrome_path 平台选择与默认回退的 helper 单测** test_platform_path_resolution_matches_browser_settings 将 browser_config.sys.platform 逐参 mock 为 win32/cygwin/darwin/linux，断言 resolve_chrome_path 对平台键 " /chrome " 去空白后返回 /chrome、平台路径空白时回退 default="/other"；
  - 相邻参数化用例 test_missing_or_invalid_configuration_does_not_select_external 断言 None、{}、browser 为 None、chrome_path=3 均返回 ""。断言仅覆盖该配置 helper，本轮未执行，不验证浏览器启动、远程连接或网页操作。
- 来源：[tests/agents/swarm/test_electron_browser_fallback.py:L19–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_electron_browser_fallback.py#L19-L19),
  - [tests/agents/swarm/test_electron_browser_fallback.py:L67–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_electron_browser_fallback.py#L67-L79)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-browser-tools.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/browser_runtime.py:L26-L57；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/browser_config.py:L12-L32
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L62-L99；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/browser_config.py:L19-L32
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L416-L433；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/浏览器.md:L99-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/playwright_mcp_runtime.py:L333-L381；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/browser_runtime.py:L26-L77
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/browser_runtime.py:L17-L22；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/browser_runtime.py:L39-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/electron_sideview.py:L214-L239；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/browser_runtime.py:L47-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_electron_browser_fallback.py:L19-L19；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_electron_browser_fallback.py:L67-L79
- 源页字段（feature）：browser-tools
- 入口（entry_points）：jiuwenswarm/agents/swarm/browser_runtime.py；jiuwenswarm/agents/harness/common/browser_config.py
- 源页字段（source_globs）：jiuwenswarm/agents/swarm/browser_runtime.py；jiuwenswarm/agents/harness/common/browser_config.py；jiuwenswarm/agents/harness/common/*
