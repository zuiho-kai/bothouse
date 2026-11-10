---
name: feature-depth-web-native-directory-picker
description: Web 通道本机目录与可执行文件选择器实现深读：select_file_native 的 title 回退与平台分派、tkinter 子进程环境变量、后端异常继续与超时中止、path.select_file 处理器异常回 UNSUPPORTED、Linux zenity/kdialog/yad 探测链、monkeypatch 单测范围
metadata:
  scope: 收 directory_picker.py 与 path.select_file 处理器的七个 facet 深读，来源另含 app_web_handlers.py、test_app_web_handlers.py；常量、取消语义与跨平台取舍的概览归 feature-web-native-directory-picker
---
# Web 通道本机目录/可执行文件选择器（跨平台后端链）：实现深读

## 现状

- [[feature-web-native-directory-picker]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **select_file_native(*, initial_dir=None, title=None)：title 为 None 或全空白时回退 _FILE_DIALOG_TITLE，调用方自行校验文件可用性** 入口先经 _resolve_initial_dir 得到 start_dir；dialog_title 仅当传入的 title 是非空白字符串时取其 strip() 结果，否则用模块常量 _FILE_DIALOG_TITLE。
  - 随后按 sys.platform 分派：win32→_select_file_windows_tk，darwin→_select_file_macos，linux 前缀→_select_file_linux，其余平台直接抛 RuntimeError。docstring 明确调用方负责验证所选文件在其领域是否为可用可执行文件。
- 来源：[jiuwenswarm/channels/web/directory_picker.py:L501–L520](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L501-L520)
- **tkinter 子进程用环境变量传参，initial 默认 ~，title 默认 Select Directory** _try_tkinter_subprocess 通过 JIUWEN_DIR_PICKER_INITIAL 和 JIUWEN_DIR_PICKER_TITLE 环境变量传参；子进程内 initial 缺省为 expanduser("~")，title 缺省为 "Select Directory"。
- 来源：[jiuwenswarm/channels/web/directory_picker.py:L296–L309](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L296-L309)
- **后端异常记录后继续；TimeoutExpired 立即中止；全部失败抛 RuntimeError** 循环中除 subprocess.TimeoutExpired（转为 RuntimeError "directory picker timed out" 并中止）外的异常记入 errors 并尝试下一 backend；全部失败时抛 RuntimeError，消息含各 backend 错误与 "fallback to typing an absolute path in the UI" 提示。
- 来源：[jiuwenswarm/channels/web/directory_picker.py:L427–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L427-L443)
- **独立子进程跑 tkinter：换来线程安全，付出进程启动与 600s 超时代价** 设计推断（非作者历史意图）：
- docstring 声明在独立子进程中运行 tkinter 以保证 Tk 位于该进程主线程、可从 asyncio.to_thread 工作线程安全调用（收益）；代价是每次选择都启动一个 Python 子进程，且受 timeout=600.0 约束（此为标注的实现内推断）。
- 来源：[jiuwenswarm/channels/web/directory_picker.py:L290–L295](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L290-L295),
  - [jiuwenswarm/channels/web/directory_picker.py:L339–L346](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L339-L346)
- **path.select_file 处理器经 asyncio.to_thread 调用 select_file_native，异常时回 UNSUPPORTED** 处理器先把 initial_dir 去空白；仅当 initial_path 是字符串且 strip() 后非空白时，用其 expanduser 后的父目录覆盖 resolved_initial_dir（L3604–L3605）。import 在 try 外，随后在 try 内用 asyncio.to_thread 调用 select_file_native 并传入 initial_dir 与 title；
  - 捕获任何 Exception 后记录 warning，并通过 channel.send_response 发送 ok=False、code="UNSUPPORTED" 的响应后返回。
- 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3603–L3620](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3603-L3620)
- **Linux 目录后端链依赖 shutil.which 探测，tkinter 子进程后端始终追加** _select_directory_linux 用 shutil.which 依次探测 zenity/kdialog/yad，探测到才加入后端列表，tkinter 子进程后端总是无条件追加（目录链 L415–L425）。tkinter 文件子进程后端复制 os.environ 并设置 JIUWEN_FILE_PICKER_INITIAL/JIUWEN_FILE_PICKER_TITLE 传参，docstring 说明 Tk 在独立进程的主线程创建（L355–L370）；
  - 未展示子进程启动代码本身。
- 来源：[jiuwenswarm/channels/web/directory_picker.py:L415–L425](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L415-L425),
  - [jiuwenswarm/channels/web/directory_picker.py:L355–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/directory_picker.py#L355-L370)
- **单测用 monkeypatch 假体验证 path.select_file 的参数转发与取消/成功响应（未触真实 OS 对话框）** test_path_select_file_returns_selected_path 将 select_file_native 替换为 fake，断言传入的 initial_dir 为 initial_path 的父目录、title 原样转发，且响应 payload 为 {"path": selected_path, "cancelled": False}（L484–L521）；
  - test_path_select_file_returns_cancelled 将其替换为返回 None 的 lambda，断言 ok=True 且 payload 为 {"path": None, "cancelled": True}（L524–L541）。断言仅覆盖处理器对 fake 的转发，不执行真实本机选择器。
- 来源：[tests/unit_tests/gateway/test_app_web_handlers.py:L484–L541](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_web_handlers.py#L484-L541)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-web-native-directory-picker.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L296-L309；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L427-L443
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L290-L295；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L339-L346
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L501-L520；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3603-L3620
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L415-L425；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/directory_picker.py:L355-L370
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_web_handlers.py:L484-L541
- 源页字段（feature）：web-native-directory-picker
- 入口（entry_points）：jiuwenswarm/channels/web/directory_picker.py
- 源页字段（source_globs）：jiuwenswarm/channels/web/directory_picker.py
