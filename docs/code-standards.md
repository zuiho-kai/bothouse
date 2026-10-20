# 代码规范与验收

人和 Agent 共用这一份。AGENTS.md、CLAUDE.md 只指向这里；流程（Issue→分支→PR）见 CONTRIBUTING.md，这里只写“做到什么程度才算完”和从返工里学到的教训。

## 验收要求

一个 PR 进入审核前，作者自己做完下面几条，并把证据写进 PR 描述：

1. **修复要先红后绿。** 行为修复附回归测试；写明去掉修复后这条测试红在哪（测试名 + 失败输出一行）。没法写自动测试的，写清手工复现步骤和前后现象。
2. **全量测试跑在沙箱里。** bridge 的 Go 测试经 `tests/testutil` 的沙箱跑：临时 HOME、清掉真实 agent 目录和会话变量、PATH 最前放会失败的假 CLI（见下节）。提交前跑 `cd bridge && go test -tags no_web -p 1 -count=1 ./...`，写明结果；已知基线失败见 docs/GO_TEST_BASELINE.md，不能拿它掩盖新增失败。
3. **有真实入口的，在真实入口验证。** 改了网页、安装向导、命令行或 bot 行为，就在对应入口实际跑一遍，PR 里写跑了什么命令、看到了什么（截图、日志片段、输出）。CI 绿和测试绿只是前提，不等于入口可用。真实入口验证不得发真实频道消息、不得动生产配置，除非任务明确授权。
4. **PR 写前后行为和证据。** 描述写“触发条件 → 改前行为 → 改后行为”，每条结论带证据（文件:行、命令输出、截图）。审核者对照 diff 核。
5. **合并锁定审过的提交。** 审核结论写明审的是哪个完整 SHA；合并用 `gh pr merge --squash --match-head-commit <该 SHA>`，审核后又有新提交就重新审。

## 测试沙箱

在包的 TestMain 里接上：

~~~go
func TestMain(m *testing.M) { os.Exit(testutil.RunSandboxed(m)) }
~~~

- 单个测试换 HOME 用 `testutil.SetHome(t, dir)`，不要只设 HOME（Windows 读 USERPROFILE）。
- 生产代码新读了指向用户目录、运行中会话或凭据（`*_API_KEY`、`*_TOKEN`、`*_BASE_URL`）的环境变量，就加进 `testutil.SandboxClearedVars`；新接一个 agent CLI，就把默认命令名加进 `testutil.SandboxStandIns`。
- 测试要判断“本机装没装某个 CLI”再决定跑不跑时，用 `testutil.LookPathReal`，它把沙箱假件当作没装，测试会跳过而不是去跑假件。
- 只有 agent/claudecode、agent/codex、tests/integration 三个真实 provider 集成测试包用 `testutil.RunSandboxedOrProviderIntegration`：显式设 `CC_RUN_PROVIDER_INTEGRATION=1` 时让路去读真实配置和凭据；其余包设了它也照样隔离。
- bridge 下所有带测试的包都已接入（每个包一个 `sandbox_main_test.go`；已有 TestMain 的包用 `testutil.Sandboxed(func() int { ... })` 包一层）。新建带测试的包要同样接上。

## 前端截图

改 `bridge/web/` 的 PR 会由 CI（.github/workflows/ui-preview.yml）构建前端、起一个隔离的 cc-connect（临时配置，不连任何平台和模型），用无头浏览器截图，作为 artifact 挂到 PR。截图只说明页面能渲染，不代替第 3 条的真实入口验证。

## 教训

每晚复盘扫前一天合并的 PR 和返工，条目追加在本段末尾，只追加不改旧条目。复盘后把下面 `reviewed-through:` 改成扫到的最后一个 main 提交 SHA，下次从它之后开始扫。

格式（一条一行）：

~~~
- YYYY-MM-DD 〔PR #编号 或 提交 SHA 前 7 位〕现象：返工或出错的具体表现。规则：以后怎么做。来源：链接或文件:行。
~~~

reviewed-through: （尚未复盘）

<!-- 教训条目追加在这一行之下 -->
