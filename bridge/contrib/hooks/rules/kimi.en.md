# Kimi Code adapter scope
Only bash-guard / PreToolUse / Bash is installed. Stop hooks remain unadapted.
Targets the TypeScript Kimi Code CLI (isolated installed version 2.3.0), not legacy Python kimi-cli.
Only user-level configuration is documented. Bothouse writes TOML to the role's .bothouse/kimi-home/config.toml and sets KIMI_CODE_HOME for its child process. Configure a model or log in separately in this directory; credentials are never copied from the user's real home.
Uses the shared AgentHookSettingsPath(cli, workDir) and AgentHooksEnabled(cli, workDir) interfaces.
