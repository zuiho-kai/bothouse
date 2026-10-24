# bothouse 桥接组件

随 bothouse 安装的桥接组件，用于连接本机 AI CLI 和聊天平台。

从 [Releases](https://github.com/zuiho-kai/bothouse/releases) 下载：macOS `.dmg`（内含 Bothouse.app）、Windows `.exe`、Linux 裸二进制。首次启动打开浏览器安装向导。macOS 未签名，首次请「右键→打开」。文件校验见 `SHA256SUMS`。

命令行安装：

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
bothouse
```

Windows 使用 `install.ps1`，装好后运行 `bothouse.exe`。安装、配置和前提条件见[从零用起](../docs/GETTING_STARTED.md)。新安装使用 `~/.bothouse`；新目录不存在时继续沿用已有旧配置，不移动文件。

详见[主 README](../README.zh-CN.md)、[安装说明](INSTALL.md)和[配置示例](config.example.toml)。开发构建运行 `make build` 得到 `bothouse`；Go module 和内部包路径沿用历史名称。

上游桥接组件的 MIT 声明保留在 [LICENSE-MIT-upstream](LICENSE-MIT-upstream)，感谢原作者及贡献者。[第三方许可](../THIRD-PARTY-LICENSES.md)。
