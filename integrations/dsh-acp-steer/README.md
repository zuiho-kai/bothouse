# DSH 忙时插话（steer）补丁

Issue #223。cc-connect 的 ACP 适配器在对端握手声明 `agentCapabilities._meta["dsh/steer"]` 时，把 DSH 忙时收到的新消息并入正在跑的那一轮（`session/prompt` 带 `_meta["dsh/steer"]`），而不是排到下一轮。上游 `@deepseek-ai/dsh-acp` 还没有这个能力，本目录的补丁给它加上：

- `initialize` 回包在 `agentCapabilities._meta` 里声明 `"dsh/steer": true`；
- `prompt` 收到带 `_meta["dsh/steer"]` 的请求时，把消息交给正在跑的 agent（`agent.steer`，下一步模型调用前生效），立即回 `_meta["dsh/steered"]`；输出仍从原 prompt 流出；
- 没有在跑的 prompt 时拒绝，cc-connect 回落排队，不会另起一轮。不带这个标记的请求行为不变。

不打补丁也能用，只是 DSH 忙时的消息要等这一轮结束才处理。

## 安装

补丁只对 `@deepseek-ai/dsh-acp` **0.2.1-rc.2** 写过和测过。装好 DSH（含 `@deepseek-ai/dsh-acp`）后，在 DSH 运行目录（有 `node_modules` 的那个）执行：

~~~sh
sh /path/to/conest/integrations/dsh-acp-steer/apply.sh /path/to/dsh-run-dir
~~~

脚本找到 `node_modules/@deepseek-ai/dsh-acp`，版本不符就报错退出，已打过就跳过，原文件留作 `lib/index.js.orig`。打完重启 DSH ACP 进程（cc-connect 下次拉起时生效）。

`npm install` 或升级 DSH 会覆盖 `node_modules`，要重打。想让它自动重打，可在 DSH 运行目录的 `package.json` 加：

~~~json
"scripts": { "postinstall": "sh /path/to/conest/integrations/dsh-acp-steer/apply.sh ." }
~~~

## 确认生效

cc-connect 日志里，DSH 忙时收到新消息会出现 `acp: steered into running prompt`；没有这行而是排队，说明握手没声明 `dsh/steer`（补丁没打上或 DSH 进程没重启）。桥接侧读取见 `bridge/agent/acp/session_steer.go`。
