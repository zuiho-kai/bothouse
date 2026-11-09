# bothouse-role-notify

角色交活、出错时在这台电脑右上角弹通知。

为什么有用：角色常在后台跑长活；坐在电脑前的人直接看到「龙娘 交活了」，不用切去频道。macOS 用 osascript，Linux 用 notify-send，Windows 暂不支持。

用 [插件模板](../template) 做的，做法见 [插件开发说明](../../docs/plugins/plugin-dev.md)。

## 装

插件页 → 添加插件，填 `bothouse-role-notify`（发布到 npm 之后）；或本地 `npm pack` 出 `.tgz`，按说明里「装本地包」一节装。

## 配置（插件页 → 配置）

| 字段 | 说明 |
| --- | --- |
| `bridge` | 桥的管理 API 地址，默认 `http://127.0.0.1:9820` |
| `token` | `config.toml` 里 `[management] token`，编辑器里显示为「已设置」 |
| `statuses` | 默认 `[celebrate, error]`；空表示全部 |

## 给角色打开

只处理在角色绑定里把 `bothouse-role-notify` 设成 `enabled: true` 的角色，没绑定的不处理：

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  http://127.0.0.1:9820/api/v1/plugins/role-bindings \
  -d '{"bindings":{"bridge:<项目名>":[{"plugin_id":"bothouse-role-notify","enabled":true}]}}'
```

PUT 是整份替换，先 GET 拿到现有绑定再加上这一条。
