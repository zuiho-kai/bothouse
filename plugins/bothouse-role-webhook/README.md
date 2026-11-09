# bothouse-role-webhook

角色交活、出错时往群里的 webhook 发一句话（Discord / Slack / 飞书）。

为什么有用：人不一定一直盯着频道；手机上的群 webhook 一响，就知道哪个角色干完了或卡住了，不用开桥看。

用 [插件模板](../template) 做的，做法见 [插件开发说明](../../docs/plugins/plugin-dev.md)。

## 装

插件页 → 添加插件，填 `bothouse-role-webhook`（发布到 npm 之后）；或本地 `npm pack` 出 `.tgz`，按说明里「装本地包」一节装。

## 配置（插件页 → 配置）

| 字段 | 说明 |
| --- | --- |
| `bridge` | 桥的管理 API 地址，默认 `http://127.0.0.1:9820` |
| `token` | `config.toml` 里 `[management] token`，编辑器里显示为「已设置」 |
| `url` | webhook 地址（Discord 频道设置 → 整合 → Webhook；Slack Incoming Webhook；飞书群机器人）。配置编辑器里明文显示，面板别外露 |
| `format` | `discord` / `slack` / `feishu` / `json`（`json` 发 `{text, event}` 给自己的服务） |
| `statuses` | 默认 `[celebrate, error]`；空表示全部。说话只发定稿，不发流式草稿 |

## 给角色打开

只处理在角色绑定里把 `bothouse-role-webhook` 设成 `enabled: true` 的角色，没绑定的不处理：

```sh
curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  http://127.0.0.1:9820/api/v1/plugins/role-bindings \
  -d '{"bindings":{"bridge:<项目名>":[{"plugin_id":"bothouse-role-webhook","enabled":true}]}}'
```

PUT 是整份替换，先 GET 拿到现有绑定再加上这一条。
