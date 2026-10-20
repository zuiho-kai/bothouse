# 第三方许可

本页列出直接依赖的许可。依赖按各自许可使用，不随本仓库重新授权。间接依赖不在此列。

## bridge/（Go，`bridge/go.mod` 的直接依赖）

生成方式：`go-licenses report ./...`（github.com/google/go-licenses/v2，Go 1.27.2，在 `bridge/` 下运行，2026-10-21），再按 `bridge/go.mod` 里不带 `// indirect` 的 require 筛出直接依赖。

| 模块 | 版本 | 许可 | 许可文件 |
| --- | --- | --- | --- |
| cloud.google.com/go/pubsub/v2 | v2.4.0 | Apache-2.0 | https://github.com/googleapis/google-cloud-go/blob/pubsub/v2.4.0/pubsub/v2/LICENSE |
| github.com/BurntSushi/toml | v1.6.0 | MIT | https://github.com/BurntSushi/toml/blob/v1.6.0/COPYING |
| github.com/bwmarrin/discordgo | v0.29.0 | BSD-3-Clause | https://github.com/bwmarrin/discordgo/blob/v0.29.0/LICENSE |
| github.com/charmbracelet/bubbles | v1.0.0 | MIT | https://github.com/charmbracelet/bubbles/blob/v1.0.0/LICENSE |
| github.com/charmbracelet/bubbletea | v1.3.10 | MIT | https://github.com/charmbracelet/bubbletea/blob/v1.3.10/LICENSE |
| github.com/charmbracelet/lipgloss | v1.1.0 | MIT | https://github.com/charmbracelet/lipgloss/blob/v1.1.0/LICENSE |
| github.com/creack/pty | v1.1.24 | MIT | https://github.com/creack/pty/blob/v1.1.24/LICENSE |
| github.com/go-telegram/bot | v1.20.0 | MIT | https://github.com/go-telegram/bot/blob/v1.20.0/LICENSE |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause | https://github.com/google/uuid/blob/v1.6.0/LICENSE |
| github.com/gorilla/websocket | v1.5.0 | BSD-2-Clause | https://github.com/gorilla/websocket/blob/v1.5.0/LICENSE |
| github.com/larksuite/oapi-sdk-go/v3 | v3.5.3 | MIT | https://github.com/larksuite/oapi-sdk-go/blob/v3.5.3/LICENSE |
| github.com/line/line-bot-sdk-go/v8 | v8.19.0 | Apache-2.0 | https://github.com/line/line-bot-sdk-go/blob/v8.19.0/LICENSE.txt |
| github.com/mdp/qrterminal/v3 | v3.2.1 | MIT | https://github.com/mdp/qrterminal/blob/v3.2.1/LICENSE |
| github.com/open-dingtalk/dingtalk-stream-sdk-go | v0.9.1 | MIT | https://github.com/open-dingtalk/dingtalk-stream-sdk-go/blob/v0.9.1/LICENSE |
| github.com/robfig/cron/v3 | v3.0.1 | MIT | https://github.com/robfig/cron/blob/v3.0.1/LICENSE |
| github.com/slack-go/slack | v0.16.0 | BSD-2-Clause | https://github.com/slack-go/slack/blob/v0.16.0/LICENSE |
| github.com/stretchr/testify | v1.11.1 | MIT | https://github.com/stretchr/testify/blob/v1.11.1/LICENSE |
| golang.org/x/crypto | v0.50.0 | BSD-3-Clause | https://cs.opensource.google/go/x/crypto/+/v0.50.0:LICENSE |
| golang.org/x/oauth2 | v0.36.0 | BSD-3-Clause | https://cs.opensource.google/go/x/oauth2/+/v0.36.0:LICENSE |
| google.golang.org/api | v0.272.0 | BSD-3-Clause | https://github.com/googleapis/google-api-go-client/blob/v0.272.0/LICENSE |
| google.golang.org/protobuf | v1.36.11 | BSD-3-Clause | https://github.com/protocolbuffers/protobuf-go/blob/v1.36.11/LICENSE |
| maunium.net/go/mautrix | v0.27.0 | MPL-2.0 | https://github.com/mautrix/go.git/blob/v0.27.0/LICENSE |
| modernc.org/sqlite | v1.49.1 | BSD-3-Clause | https://gitlab.com/cznic/sqlite/-/blob/v1.49.1/LICENSE |
| rsc.io/qr | v0.2.0 | BSD-3-Clause | https://github.com/rsc/qr/blob/v0.2.0/LICENSE |

`maunium.net/go/mautrix` 为 MPL-2.0（文件级弱 copyleft）：修改它的源文件须按 MPL-2.0 公开；本仓库只作为依赖引用，未修改其源码。

## bridge/web/（前端，`bridge/web/package.json` 的直接依赖）

生成方式：版本取自 `bridge/web/pnpm-lock.yaml` 的 importers 段，许可取自 npm registry 元数据（`npm view <包>@<版本> license repository.url`，2026-10-21）。本机没有装 pnpm 和 node_modules，所以没有用 license-checker 之类读取安装目录的工具；许可文件本身没有逐个核对。

| 包 | 版本 | 类型 | 许可 | 仓库 |
| --- | --- | --- | --- | --- |
| @tailwindcss/typography | 0.5.19 | 运行时 | MIT | https://github.com/tailwindlabs/tailwindcss-typography |
| clsx | 2.1.1 | 运行时 | MIT | https://github.com/lukeed/clsx |
| highlight.js | 11.11.1 | 运行时 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| i18next | 25.10.9 | 运行时 | MIT | https://github.com/i18next/i18next |
| lucide-react | 0.487.0 | 运行时 | ISC | https://github.com/lucide-icons/lucide |
| qrcode.react | 4.2.0 | 运行时 | ISC | https://github.com/zpao/qrcode.react |
| react | 19.2.4 | 运行时 | MIT | https://github.com/facebook/react |
| react-dom | 19.2.4 | 运行时 | MIT | https://github.com/facebook/react |
| react-i18next | 15.7.4 | 运行时 | MIT | https://github.com/i18next/react-i18next |
| react-markdown | 10.1.0 | 运行时 | MIT | https://github.com/remarkjs/react-markdown |
| react-router-dom | 7.13.2 | 运行时 | MIT | https://github.com/remix-run/react-router |
| rehype-highlight | 7.0.2 | 运行时 | MIT | https://github.com/rehypejs/rehype-highlight |
| remark-gfm | 4.0.1 | 运行时 | MIT | https://github.com/remarkjs/remark-gfm |
| zustand | 5.0.12 | 运行时 | MIT | https://github.com/pmndrs/zustand |
| @types/react | 19.2.14 | 仅构建 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.2.3 | 仅构建 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @vitejs/plugin-react | 4.7.0 | 仅构建 | MIT | https://github.com/vitejs/vite-plugin-react |
| autoprefixer | 10.4.27 | 仅构建 | MIT | https://github.com/postcss/autoprefixer |
| postcss | 8.5.8 | 仅构建 | MIT | https://github.com/postcss/postcss |
| tailwindcss | 3.4.19 | 仅构建 | MIT | https://github.com/tailwindlabs/tailwindcss |
| typescript | 5.8.3 | 仅构建 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | 6.4.1 | 仅构建 | MIT | https://github.com/vitejs/vite |

「仅构建」的包不进入打包产物。

## 尚未列出

- `companion/`、`role-household/`、`experiments/` 的 Python 依赖（见各自 `uv.lock`）还没有生成清单。`integrations/` 没有 package.json，没有第三方 Node 依赖。
