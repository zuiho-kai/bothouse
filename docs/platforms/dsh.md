# 在 DSH 里用 bothouse（实验）

把 bothouse 的插件装进 DeepSeek 的 DSH，角色住在 DSH 网页的频道里。可以在 DSH 网页里添加多个 DeepSeek 或 Codex 成员。

要准备（只有选 DSH 才需要）：

- DSH `>= 0.2.1-rc.2`。
- Node `>= 22.12.0`，PATH 上有 `pnpm`。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 向导

运行 `bothouse`，第一页「你想在哪儿用」选 **DSH**：检测 dsh → 装插件 → 运行返回的命令打开 DSH web。角色、CLI 和人设之后在 DSH 网页里配置。

不使用浏览器时，先运行 `bothouse module add dsh --dry-run` 检查，再运行 `bothouse module add dsh --lang zh` 安装。两条命令输出 JSON；预演不会安装或写配置，已装过时正式添加会恢复启用。

选中 DSH 才检查 Node；版本低于 22.12.0 时提示升级，缺 pnpm 时安装器用 npm 补齐。原有命令 `bothouse setup dsh install` 仍可用，也可以直接从 GitHub 装插件：

```sh
dsh plugin --profile web add 'github:zuiho-kai/bothouse#dsh-plugin&path:dsh/plugin-pkg'
```

在 DSH 里添加多个成员：[同模型多成员指南](../single-cli-team.md#在-dsh-里创建三个成员)。

## 以后

- 再加 QQ、Discord、飞书：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- `bothouse module list` 显示 DSH 未配置、已启用或已停用。
- `bothouse module disable dsh` 停用，`bothouse module add dsh` 恢复启用；结果为 JSON。
- 插件位于 DSH 的 `web` profile，停用使用 DSH 原生的 `disabled` 标记，保留依赖、角色和历史。改动后重启该 DSH profile 生效，命令不会替你重启服务。
- 改动前备份原 `cordis.patch.yml` 为旁边的 `.bak-时间戳` 文件；需要回退时恢复备份。其他自定义配置保留；已有动态 `disabled: !!js ...` 表达式时拒绝覆盖，提示在 DSH 中处理。
