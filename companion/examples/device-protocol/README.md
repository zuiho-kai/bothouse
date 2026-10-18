# 设备协议样例（Issue #42）

脱敏的线路消息样例与 schema，配合 [docs/DEVICE_TERMINAL.md](../../../docs/DEVICE_TERMINAL.md) 阅读。

- `schema.json`：样例需要满足的字段约束（只用了 JSON Schema 的一小部分）。
- `samples.json`：每种消息一条样例，token、client id 已用 `REDACTED` 代替。
- `validate.py`：离线校验，只用标准库。

```sh
cd companion
uv run python examples/device-protocol/validate.py
```

同一校验也在 `tests/test_voice_device_protocol.py` 里跑，样例和 schema 不会悄悄失效。

这些样例不是抓包记录，也不是板上验证结论；真实设备的请求仍以 `docs/DEVICE_TERMINAL.md` 的格式与错误码为准。
