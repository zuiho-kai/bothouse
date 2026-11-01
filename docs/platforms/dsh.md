# 在 DSH 里用 bothouse（实验）

把 bothouse 的插件装进 DeepSeek 的 DSH，角色住在 DSH 网页的频道里。可以在 DSH 网页里添加多个 DeepSeek 或 Codex 成员。

要准备（只有选 DSH 才需要）：

- DSH `>= 0.2.1-rc.2`。
- Node `>= 22.12.0`，PATH 上有 `pnpm`。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 向导

运行 `bothouse`，第一页「你想在哪儿用」选 **DSH**：检测 dsh → 装插件 → 运行返回的命令打开 DSH web。角色、CLI 和人设之后在 DSH 网页里配置。

等价命令是 `bothouse setup dsh install`，也可以直接从 GitHub 装插件：

```sh
dsh plugin --profile web add 'github:zuiho-kai/bothouse#dsh-plugin&path:dsh/plugin-pkg'
```

在 DSH 里添加多个成员：[同模型多成员指南](../single-cli-team.md#在-dsh-里创建三个成员)。

## 以后

- 再加 QQ、Discord、飞书：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- `bothouse module list` 会显示 DSH 插件装没装。DSH 插件装在 DSH 里，不在 bothouse 配置中：停用请在 DSH 里移除插件。
