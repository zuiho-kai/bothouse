# bothouse-plugin-template

最小的 bothouse 插件：连上桥的角色事件，把绑定了本插件的角色的状态写进 DSH 日志。拿它当起点写自己的插件，做法见 [插件开发说明](../../docs/plugins/plugin-dev.md)。

配置（插件页 → 配置）：

| 字段 | 说明 |
| --- | --- |
| `bridge` | 桥的管理 API 地址，默认 `http://127.0.0.1:9820` |
| `token` | `config.toml` 里 `[management] token`，编辑器里显示为「已设置」 |
| `statuses` | 只处理这些状态；空表示全部（idle working thinking celebrate error speech） |

只处理在 `/api/v1/plugins/role-bindings` 里把 `bothouse-plugin-template` 设为 `enabled: true` 的角色。
