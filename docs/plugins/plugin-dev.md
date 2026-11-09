# 写一个 bothouse 插件

照这份说明，从模板出发，半小时内写出一个插件，在面板「插件」页装上、启停、改配置，并让它跟着角色的状态做事。

bothouse 插件就是一个 DSH 插件：一个带 `dsh.bundle` 声明的 npm 包，由 DSH 加载、在 DSH 进程里运行。bothouse 在旁边提供两样东西：面板「插件」页（装、启停、改配置），和桥的角色事件与角色绑定接口（插件靠它知道每个角色在干什么）。

```
         面板「插件」页                       DSH 进程
   装 / 启停 / 改配置 ──写──▶ profile 文件 ──加载──▶ 你的插件 apply(ctx, config)
                                                    │
   桥 /api/v1/roles/events  ── SSE 角色事件 ────────▶│ onEvent(ev)
   桥 /api/v1/plugins/role-bindings ── 哪些角色开了我 ─┘
```

## 1. 从模板开始

```sh
node plugins/scripts/new-plugin.mjs bothouse-role-hello
```

它把 [plugins/template](../../plugins/template) 复制到 `plugins/bothouse-role-hello/`，并把包名、patch 里的行、`index.mjs` 里的 `name` 一起改成新名字。可以带第二个参数指定目录，也可以带 scope：`@you/bothouse-hello`。

现成的样板：

| 插件 | 做什么 |
| --- | --- |
| [bothouse-plugin-template](../../plugins/template) | 最小示例：把绑定角色的状态写进 DSH 日志 |
| [bothouse-role-webhook](../../plugins/bothouse-role-webhook) | 角色交活、出错时往 Discord / Slack / 飞书群 webhook 发一句 |
| [bothouse-role-journal](../../plugins/bothouse-role-journal) | 绑定角色的每条事件按天追加进 JSON Lines 文件 |
| [bothouse-role-notify](../../plugins/bothouse-role-notify) | 角色交活、出错时在本机弹桌面通知（macOS / Linux） |

## 2. 目录结构

```
bothouse-role-hello/
├── package.json        包名、dsh.bundle、engines、files
├── cordis.patch.yml    装上时 DSH 插进 profile 的行，含默认 config
├── index.mjs           DSH 加载的入口：name、apply(ctx, config)
├── lib/bothouse.mjs    连桥的小工具（角色事件、角色绑定），零依赖，随包带走
├── lib/*.test.mjs      node --test
└── README.md
```

## 3. package.json

模板里的字段都是 DSH 和面板真读的：

| 字段 | 谁读、做什么 |
| --- | --- |
| `name` | npm 包名；也是 patch 行的 `name:`、角色绑定里的 `plugin_id`。面板只收 npm 包名规则（小写、数字、`- _ . ~`，可带 `@scope/`） |
| `main` / `exports["."]` | DSH 加载的入口文件 |
| `dsh.bundle.patch` | 指向 `cordis.patch.yml`。**没有它，DSH 装得上但不当插件加载**，面板会标「不是插件包」 |
| `engines.dsh` | 兼容的 DSH 版本范围；从 npm 装时面板确认页拿它对照本机 DSH |
| `files` | 发布进包的文件；漏了 `cordis.patch.yml` 或 `lib/` 就装上跑不起来 |
| `description` | 插件页列表里显示的说明 |

要带网页端（侧栏页面）时另加 `dsh.client`，写法照 [bothouse-dsh-panel](../../dsh/packages/bothouse-dsh-panel/package.json)；只带网页端、不带 `dsh.bundle` 的包，插件页标为「客户端 UI 包」，不给开关。

## 4. cordis.patch.yml：插件的行和默认配置

```yaml
- insert:
    - id: bothouse-role-hello        # 行 id：插件页「这个插件带来 N 项」里列的就是它
      name: bothouse-role-hello      # 要加载的包
      config:                        # 传给 apply(ctx, config) 的第二个参数
        bridge: http://127.0.0.1:9820
        token: ""
        statuses: [celebrate, error]
```

- 一个包可以插多行，每行各自出现在插件页，可单独停用（`disabled: true` 表示默认关）。
- 值可以写 `!!js 表达式`（例如读环境变量）；面板编辑器原样保留，不会改成字面量。

## 5. 配置：在面板里改

插件页 → 展开「这个插件带来 N 项」→ 行右侧「配置」，打开 YAML 编辑器：

- 显示的是当前生效的那一层。没在面板改过时显示插件自带的默认（「来自插件自带的 patch」）。
- 保存写进这份 profile 的 `cordis.patch.yml`，**整段替换这一行的 config**，不是逐字段合并；写前留一份带时间戳的 `.bak-` 备份。
- 清空保存 = 删掉面板里的覆盖，回到插件默认。
- 键名里含 `key`、`token`、`secret`、`password`、`credential`、`authorization`、`cookie`（不分大小写）的值，编辑器里显示为 `!bothouse/secret` 占位；原样保存保留旧值，替换整个占位才是改值。想让面板遮住的字段就照这个规则起名。webhook 地址这类本身就是凭据的值，键名不在这个规则里会明文显示，README 里写清楚。
- 改完重启 DSH 才生效。

## 6. 入口：index.mjs

```js
import { followRoles, roleLabel, statusFilter } from './lib/bothouse.mjs';

export const name = 'bothouse-role-hello';

export function apply(ctx, config = {}) {
  const want = statusFilter(config.statuses);
  const roles = followRoles({
    bridge: config.bridge, token: config.token, pluginId: name, logger: ctx.logger,
    onEvent(ev) {
      if (want.has(ev.type)) ctx.logger.info(`${roleLabel(ev)} → ${ev.type}`);
    },
  });
  ctx.effect(() => () => roles.stop());   // 停用、改配置、卸载时收尾
}
```

- `apply(ctx, config)`：行启用时 DSH 调用。`config` 就是上一节那段。
- `ctx.effect(() => cleanup)`：注册收尾。连接、定时器、文件句柄都放这里关，否则停用后还在跑。
- `ctx.logger`：DSH 的日志器（`info` / `warn`）。注意本机 `dsh web` 的终端输出默认看不到插件的 `info`，调试时别只靠它判断插件有没有跑。
- 要用 DSH 的其它服务，在 `export const inject = [...]` 里声明，例如 `webServer` 注册 HTTP 路由（参照 [dsh/collab/plugin.mjs](../../dsh/collab/plugin.mjs) 的 `inject` 与 `ctx.webServer.register`）。

## 7. 角色事件与按角色绑定

接口约定见 [角色事件](role-events.md)，`lib/bothouse.mjs` 已经包好：

- `followRoles(...)` 订阅 `GET /api/v1/roles/events`（SSE，Bearer 管理 token），断开 3 秒后重连，重连先收快照。
- 每条事件 `ev` 有 `type`（`idle` `working` `thinking` `celebrate` `error` `speech`）、`role_key`（`bridge:项目名` 或 `dsh:成员ID`）、`session_key`、`time`，说话另带 `text`，DSH 流式草稿带 `draft: true`（只要定稿就跳过它，样板插件都这么做）。
- **只处理开了你的角色**：`followRoles` 读 `GET /api/v1/plugins/role-bindings`，只把绑定里 `plugin_id` 等于你的包名且 `enabled: true` 的角色交给 `onEvent`；没绑定的角色不处理，没有默认回落。绑定变了 2 秒内生效。
- 给角色开插件（PUT 是整份替换，先 GET 再加）：

  ```sh
  curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    http://127.0.0.1:9820/api/v1/plugins/role-bindings \
    -d '{"bindings":{"bridge:<项目名>":[{"plugin_id":"bothouse-role-hello","enabled":true}]}}'
  ```

- 管理 token 是 `config.toml` 的 `[management] token`；没设 token 时插件页只读，PUT 绑定也会被拒。

## 8. 测试

```sh
cd plugins/bothouse-role-hello && npm test
```

把副作用（拼消息、拼请求体、算文件名）写成导出的纯函数，单测直接测；`lib/bothouse.test.mjs` 演示了用假 `fetchImpl` 测事件过滤。

## 9. 装上试：本地包

1. `npm pack` 出 `bothouse-role-hello-0.1.0.tgz`。
2. `config.toml` 打开非 registry 来源（默认只收 npm registry 包）：

   ```toml
   [plugins]
   allow_non_registry = true
   ```

3. 插件页「装一个插件」填 `.tgz` 的绝对路径 → 检查来源。确认页会提示「这不是 npm registry 的包」，勾「我知道这个地址是什么，继续。」才能装；后端也会再核一次这一勾。本地包的确认页读不到包内容，会显示「没声明 dsh.bundle」，以装好后列表里的标签为准。
4. 装好后列表出现你的包，标「已启用」；「停用 / 启用」改的是 profile 的 bundles。改完重启 DSH 生效。

git 地址、`file:`/`link:` 路径同样走这个开关和确认。

## 10. 发布

```sh
npm publish
```

之后别人在插件页填包名（可带 `@版本` 或标签）就能装。从 registry 装时，确认页会显示来源、版本、发布者和 `engines.dsh` 是否符合本机 DSH。DSH 用 pnpm 装插件，pnpm 会先跳过一天内新发的版本，想马上装最新版就写准版本号。
