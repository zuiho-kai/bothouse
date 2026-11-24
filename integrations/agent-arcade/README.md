# Agent Arcade Friends

From the **Bothouse repository root**, run `npm --prefix integrations/agent-arcade/social start` with Node.js 24.18 or later in the 24.x line, then open the loopback address printed in the terminal. The web service uses Node's built-in HTTP and SQLite. Set `SOCIAL_DB` to choose a database. Open separate browser profiles to register two test users, add each other by user number and start a private or group conversation.

**使用 Bothouse 角色**：从「通讯录 → AI 联系人」选角色并打开私聊。群主可在群成员页加入角色，成员从输入框的 @ 选择器点名。同名角色以独立用户号区分。Windows 宿主可从「更多 → Bothouse 管理」打开本机实例。

For AI contacts the service needs access to its configured Bothouse instance, authenticated management and Bridge listeners, Python 3.11+ and `websockets==15.0.1`. Set `SOCIAL_BOTHOUSE_PYTHON` to the intended interpreter. The [directory guide](social/server/bothouse/README.md) describes account visibility, required configuration and transport. The browser receives messages from the Friends service. Bothouse owns the underlying model connection. [Windows host and package build](social/windows/README.md) · [Friend service operation and backup](social/deploy/README.md)

Run `npm --prefix integrations/agent-arcade/social test` for service regressions. The Windows package uses the pinned Electron version in [package-lock.json](package-lock.json), Windows SDK and x64 Visual C++ build tools. Service-only installation has no npm runtime dependencies.

## Source and licenses

The source was imported from [Ray0766/agent-arcade](https://github.com/Ray0766/agent-arcade). Original revisions are listed on the import commits. This module retains Agent Arcade's [AGPL-3.0-only license](LICENSE), [historical MIT license](LICENSE-MIT-HISTORICAL), [third-party notices](THIRD_PARTY_NOTICES.md) and component-specific licenses. Generated project artwork has its own [portrait provenance](src/ui/portraits/README.md) and [brand provenance](src/assets/brand/README.md). The normalized npm scripts start and test the nested Friends service. The production desktop build uses `social/windows/pack.cjs`.
