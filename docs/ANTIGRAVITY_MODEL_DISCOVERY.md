# Antigravity 原生模型发现

2026-10-17，关联 Issue #5。代码修复与生产部署分开验收。

## 问题与修复

本机 `agy models` 能列出 `gemini-3.8-flash-high`，但桥接的 `AvailableModels` 没有调用原生 CLI：它优先读取显式 provider 模型配置，否则尝试公共 Gemini API，最后返回四个旧的硬编码 ID。模型切换命令按候选列表校验，因此拒绝了原生 CLI 实际提供的目标。

修复后继续保留显式 `providers.models` 优先；未显式配置时调用同一个 CLI 的 `models` 子命令。使用与会话相同的命令前缀参数、工作目录及配置/provider/session 环境覆盖顺序，不启动聊天或切换真实会话。

解析原生 CLI 的制表符分隔行，保留完整模型 ID、思考档位后缀及描述，不过滤非 Gemini 模型。忽略非数据行与重复 ID。查询最多 15 秒，调用方取消会提前终止；失败或无有效模型时返回空列表并记录不含 CLI 输出的警告，不再把公共 API 或旧硬编码列表作为已验证候选。旧 CLI 不支持 `models` 时需明确配置 `providers.models`。

这修复的是候选发现与切换请求校验，不改变自动分档策略，也不能凭排队成功证明下一轮后端实际使用了目标模型。

## 可重复验证

在 `bridge/` 执行：

```sh
go test -tags no_web ./agent/antigravity -run 'Test(AvailableModels|ParseCLIModels)' -count=1
```

关键回归 `TestAvailableModels_NativeCLIModelCanBeQueued` 使用假 CLI 边界与真实 Agent/Engine：CLI 提供目标 → ModelStatus 列出目标 → QueueModelSwitch 接受并排队 → 当前回合模型不变 → 未提供的 ID 仍被拒绝。旧实现实际运行失败，仅返回四个旧 ID；修复后通过。补测显式配置优先、命令/环境/目录一致性、失败/空输出、取消和解析。

本机真实探针调用新适配器及隔离内存 Engine，输出 `advertised_models=13`、`target_advertised=true`、`isolated_queue_ok=true`，目标为 `gemini-3.8-flash-high`。没有访问生产 socket、发送聊天或切换真实会话。探针源码保存在忽略的 `.local/models-probe.go`；其中的本机绝对路径不作为产品配置。

## 验证中的失败与边界

首轮环境回归因 macOS 临时目录路径别名失败，已改用实际目录身份比较；修正后定向测试通过。首轮默认包并发全量测试同时出现 Codex 的 `TestClose_ForceKillsAllTrackedProcessesAfterCmdOverwrite` 等待 thread ID 超时；未修改该后端，原日志保存在忽略的 `.local/go-test-full.log`。

最终验证：`go test -p 1 -tags no_web -count=1 ./...` 全量通过；Antigravity 模型发现与 core 模型切换、完整 CUJ 的定向 race 全部通过；`go vet -tags no_web ./...`、`no_web` 构建及 `git diff --check` 通过。日志分别在 `.local/go-test-final.log`、`.local/go-race-cuj.log`、`.local/go-vet.log`。这证明本次串行全量结果，不消除首次默认包并发发生的 Codex 超时记录。

本变更尚未部署；原 `cc-connect` 工作区、二进制、配置及会话未改变。上线须单独核对部署授权、最新 main 与运行忙闲，部署后再由原伙伴执行 list/set 并检查下一轮真实模型，不能借用其他伙伴的项目或会话环境。
