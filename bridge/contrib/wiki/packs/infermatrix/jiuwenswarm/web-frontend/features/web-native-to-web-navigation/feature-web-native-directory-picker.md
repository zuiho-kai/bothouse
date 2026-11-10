---
name: feature-web-native-directory-picker
description: Web 通道本机目录与可执行文件选择器概览：常量与 600 秒子进程超时、取消返回 None 的统一语义、select_directory_native/select_file_native 公共入口、按平台分派的后端链与子进程隔离、取舍及三条可断言契约
metadata:
  scope: 只收配置、功能、API、架构、取舍、验证六个 facet 摘要；title 回退细节、处理器 UNSUPPORTED 响应与单测范围归 feature-depth-web-native-directory-picker
---
# Web 通道本机目录/可执行文件选择器（directory_picker）

## 现状

- **常量与运行参数**
- 该模块没有用户可配置项：对话框标题是模块常量 `_DIALOG_TITLE`（"选择项目目录"）与 `_FILE_DIALOG_TITLE`（"Select executable file"），仅 `select_file_native` 的 `title` 参数可覆盖。子进程超时硬编码为 600 秒（`_run_capture` 默认值与 tkinter 子进程调用均如此）。
  - tkinter 子进程内部使用的 `JIUWEN_DIR_PICKER_INITIAL`/`JIUWEN_DIR_PICKER_TITLE`/`JIUWEN_FILE_PICKER_*` 环境变量是父子进程间传参机制，不是对外配置接口。
- Sources / 来源：[jiuwenswarm/channels/web/directory_picker.py:L24–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L24-L25),
  - [jiuwenswarm/channels/web/directory_picker.py:L51–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L51-L58),
  - [jiuwenswarm/channels/web/directory_picker.py:L296–L309](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L296-L309)
- **支持的行为与边界**
- 支持目录选择与可执行文件选择两类对话框，覆盖 Windows/macOS/Linux 三平台。取消语义统一为返回 `None`：zenity/kdialog/yad 的退出码 1、osascript stderr 中的 "User canceled"/-128、tkinter 子进程退出码 1 均映射为取消；其他非零退出码视为错误。`initial_dir` 为空或不存在时回落到 `Path.home()`。Windows 文件选择器过滤 `*.exe`（附 All files），Linux/macOS 文件后端不做扩展名过滤。
- Sources / 来源：[jiuwenswarm/channels/web/directory_picker.py:L118–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L118-L123),
  - [jiuwenswarm/channels/web/directory_picker.py:L152–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L152-L159),
  - [jiuwenswarm/channels/web/directory_picker.py:L28–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L28-L36),
  - [jiuwenswarm/channels/web/directory_picker.py:L203–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L203-L209)
- **公共入口：select_directory_native 与 select_file_native**
- 模块暴露两个公共函数。`select_directory_native(*, initial_dir: str | None = None) -> str | None` 打开本机文件夹对话框，返回选中目录的绝对路径，用户取消时返回 `None`。`select_file_native(*, initial_dir: str | None = None, title: str | None = None) -> str | None` 打开本机文件选择框，返回选中文件路径，取消同样返回 `None`；其文档字符串明确调用方负责校验所选文件在其领域内是否为可用可执行文件。
  - 两者按 `sys.platform` 分派到 win32/darwin/linux 实现，其它平台直接抛 `RuntimeError`。注意返回值并非无条件绝对路径：`_normalize_selected` 在 `resolve()` 抛异常时返回未解析的 `str(path)`。
- Sources / 来源：[jiuwenswarm/channels/web/directory_picker.py:L476–L505](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L476-L505),
  - [jiuwenswarm/channels/web/directory_picker.py:L39–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L39-L48),
  - [jiuwenswarm/channels/web/directory_picker.py:L510–L520](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L510-L520)
- **按平台分派的后端链与子进程隔离**
- 两个入口各自做 `sys.platform` 分派：Windows 走进程内 tkinter 对话框（`_select_directory_windows_tk`/`_select_file_windows_tk`），macOS 通过 `_run_capture` 调用 `osascript` 独立进程，Linux 在 `_select_directory_linux`/`_select_file_linux` 中按 `shutil.which` 探测组装 zenity → kdialog → yad 后端列表，并始终追加 tkinter 子进程后端；
  - 每个后端失败（非超时）记录 warning 并继续尝试下一个，全部失败时抛带聚合错误信息的 `RuntimeError`。tkinter 子进程后端用 `subprocess.run([sys.executable, "-c", script], ...)` 直接运行内嵌脚本，通过 `JIUWEN_DIR_PICKER_*`/`JIUWEN_FILE_PICKER_*` 环境变量传参，使 `Tk()` 始终创建于子进程主线程，从而可安全地从 `asyncio.to_thread` 工作线程调用。
- Sources / 来源：[jiuwenswarm/channels/web/directory_picker.py:L415–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L415-L443),
  - [jiuwenswarm/channels/web/directory_picker.py:L290–L299](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L290-L299),
  - [jiuwenswarm/channels/web/directory_picker.py:L339–L346](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L339-L346),
  - [jiuwenswarm/channels/web/directory_picker.py:L488–L493](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L488-L493)
- **跨平台后端链的取舍**
- 以外部对话框工具的后备链换取广覆盖：zenity/kdialog/yad 按 `shutil.which` 探测、失败降级到下一后端，最终兜底为 tkinter 子进程，覆盖只装了 `python3-tk` 的 Ubuntu 桌面；代价是错误路径变长、每个后端有各自的退出码约定（zenity/kdialog/yad 退出码 1 视为用户取消）。超时不参与降级：Linux 链中 `TimeoutExpired` 直接转为 `RuntimeError("... timed out")`，不再尝试后续后端。
  - 选择在独立子进程跑 tkinter（而非工作线程内直接创建 `Tk()`）解决了线程限制，代价是每次弹窗都要启动一个 Python 解释器子进程并经环境变量/标准输出传参。
- Sources / 来源：[jiuwenswarm/channels/web/directory_picker.py:L418–L437](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L418-L437),
  - [jiuwenswarm/channels/web/directory_picker.py:L290–L295](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L290-L295),
  - [jiuwenswarm/channels/web/directory_picker.py:L203–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L203-L209)
- **可验证的契约：取消语义、路径规范化与平台分派**
- Inference / 设计推断（非作者历史意图）：
- 本模块的验证锚点是三个可独立断言的契约。其一，取消语义在各后端统一映射为返回 None：Linux 后端（zenity/kdialog/yad）以退出码 1 表示取消（L204-L205、L217-L218），tkinter 子进程以退出码 1 表示取消（L347-L348），macOS osascript 以 stderr 中 "User canceled" 或 "-128" 判定取消（L154-L156）。
  - 其二，路径规范化契约：`_normalize_selected` 对空输入返回 None，非空输入经 strip/expanduser/resolve 处理，resolve 抛异常时回退为未解析的字符串路径（L39-L48）。其三，Linux 后端链的降级行为：单个后端非超时异常被捕获、记录 warning 后继续尝试下一个，全部失败抛聚合错误的 RuntimeError，TimeoutExpired 则不降级直接抛 RuntimeError（L427-L443）。这些契约均由所示实现直接定义，可作为针对该模块的测试断言点；本次输入未展示测试文件，无法据此说明仓库中实际的测试入口。
- Sources / 来源：[jiuwenswarm/channels/web/directory_picker.py:L39–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L39-L48),
  - [jiuwenswarm/channels/web/directory_picker.py:L203–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L203-L209),
  - [jiuwenswarm/channels/web/directory_picker.py:L152–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L152-L159),
  - [jiuwenswarm/channels/web/directory_picker.py:L427–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L427-L443)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-web-native-directory-picker.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L24-L25；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L51-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L296-L309；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L118-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L152-L159；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L28-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L203-L209；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L476-L505
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L39-L48；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L510-L520
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L415-L443；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L290-L299
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L339-L346；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L488-L493
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L418-L437；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L290-L295
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L427-L443
- 源页字段（feature）：web-native-directory-picker
- 入口（entry_points）：jiuwenswarm/channels/web/directory_picker.py
- 源页字段（source_globs）：jiuwenswarm/channels/web/directory_picker.py
