# Kimi Code 适配范围
仅安装已核对协议的 bash-guard / PreToolUse / Bash；Stop 等 hook 尚未适配。
适用于 TypeScript Kimi Code CLI（隔离安装验证版本 2.3.0），不宣称兼容旧 Python kimi-cli。
官方仅证明用户级配置；bothouse 在角色 .bothouse/kimi-home/config.toml 写 TOML，并为该角色子进程设置 KIMI_CODE_HOME。此目录需要单独配置模型或登录，不复制真实用户凭据。
使用公共 AgentHookSettingsPath(cli, workDir) / AgentHooksEnabled(cli, workDir)；不存在额外 ForCLI 接口。
