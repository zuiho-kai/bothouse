# bothouse-role-journal

把绑定角色的每条事件按天追加进 JSON Lines 文件。

为什么有用：桥本身不留事件历史；一天一个文件，日报、复盘、表格都能直接读回：谁什么时候在干活、哪次出错、说了什么。

用 [插件模板](../template) 做的，做法见 [插件开发说明](../../docs/plugins/plugin-dev.md)。

## 装

插件页 → 添加插件，填 `bothouse-role-journal`（发布到 npm 之后）；或本地 `npm pack` 出 `.tgz`，按说明里「装本地包」一节装。

## 配置（插件页 → 配置）

| 字段 | 说明 |
| --- | --- |
| `bridge` | 桥的管理 API 地址，默认 `http://127.0.0.1:9820` |
| `token` | `config.toml` 里 `[management] token`，编辑器里显示为「已设置」 |
| `dir` | 文件目录，空表示 `~/.bothouse/plugins/bothouse-role-journal`；文件名 `journal-YYYY-MM-DD.jsonl`（按事件 UTC 日期） |
| `statuses` | 默认空，即全部；说话只记定稿 |

## 给角色打开

只处理在角色绑定里把 `bothouse-role-journal` 设成 `enabled: true` 的角色，没绑定的不处理：

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  http://127.0.0.1:9820/api/v1/plugins/role-bindings \
  -d '{"bindings":{"bridge:<项目名>":[{"plugin_id":"bothouse-role-journal","enabled":true}]}}'
```

PUT 是整份替换，先 GET 拿到现有绑定再加上这一条。
