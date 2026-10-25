# AstrBot / QQ 群接入参考实现（bridge_core）

最小参考客户端：把群消息发进 bothouse hub 频道，并取回角色回复。纯标准库、可脱离 AstrBot 单测。

配套说明见 [`docs/astrbot-bridge.md`](../../../docs/astrbot-bridge.md)。

## 用法（在插件/客户端代码里）

```python
from bridge_core import BothouseBridgeCore

core = BothouseBridgeCore("http://127.0.0.1:8790", token="<hub web token>", room_id=1)
core.send_user_message("你好", sender_name="用户", chat_name="测试群")
for reply in core.wait_for_replies(timeout=120, quiet=20):
    print(core.format_for_chat(reply))  # 已过滤过程消息与隐私尾注
```

## 单测

```powershell
python -m unittest discover -s bridge/contrib/astrbot-bridge -v
```

测试用本地假 hub，不需要 AstrBot，也不需要真实 hub；覆盖发送格式、只取角色回复、去重、游标、隐私清洗。

## 注意

- `token` 只保存在本机配置，不要提交到仓库；
- 建议给 hub 频道角色关闭 `reply_footer` / 工作目录 / 额度指示器（见文档"隐私注意"）；
- 本参考实现是 L1 通道接入，不是成员身份 L2。
