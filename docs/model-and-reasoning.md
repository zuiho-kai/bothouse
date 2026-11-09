# Model and reasoning selection / 模型与推理档位

## English

Model and reasoning selections are scoped to the current channel/session key.
Use `/model` and `/reasoning` in that channel, or let the agent use
`bothouse model list --json` followed by `model set <exact-id> --effort <level>`.
CLI changes are queued until the next turn; the conversation is preserved.
Selections survive restarts and `/new`, while other channels retain their own
selections or project/directory defaults. CLI support and pinned model arguments
still determine which settings a backend can apply.

## 中文

模型和推理档位按当前频道（会话 key）分别记。在那个频道里用 `/model`、`/reasoning`，
或让 agent 先跑 `bothouse model list --json`，再跑 `model set <准确 ID> --effort <档位>`。
命令行改的设置排到下一轮生效，对话保留。设置在重启和 `/new` 后仍在；别的频道保留各自的设置，
或用项目、目录的默认值。后端能用哪些设置，仍由 CLI 支持情况和固定的模型参数决定。
