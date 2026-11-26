# DSH ACP 正文增量

配合 Issue #284，打通 DSH 的实时正文与私密语音转发。`source.patch` 基于本机 DSH steer 源码提交 `ecc89fff43a85d7f836a99472dd31e672fd89c26`，包含源码、回归及对应文档，依赖原有 `agent/assistant-stream` 事件，不修改 agent-loop。上游代码遵循本目录 [MIT 许可](LICENSE-MIT-DeepSeek)。

## 构建与启用

在独立 DSH 工作区核对上述基线，执行 `git apply --check /path/to/source.patch`，再执行 `git apply /path/to/source.patch`。使用该安装原有锁文件安装依赖，完成其 `build:artifacts` 后再执行 `build:check`。禁止清理本地目录时，可通过 tsc 构建 ACP 及依赖类型，再用 tsdown 按 ACP 包筛选并传 --no-clean 增量构建；这不等于执行了上游全仓构建验证。源码与构建产物须来自同一版本；不要修改正在运行的安装。


historyEnvelope 和 publicReplyJson 必须成对开启：模型历史保留规范 JSON，ACP 展示时解码为正文；旧历史不改写。普通聊天也需启用这对设置，实时转发开关仅按语音请求开启。

首个公开字符即时转成 ACP `agent_message_chunk`；首句标点到达后下游开始合成。公开插件仍先隔离原始草稿，只发布专用答复调用或正文起点严格 JSON 中的 `reply` 字段。普通 text、思考与工具参数不作为早期正文。原始草稿等待、模型首字时间和 TTS 首包仍会计入等待，不能承诺总时长三秒。

## 失败与验证

流式发布的前缀无法撤回。已发布后，失败或放弃的尝试使原请求失败，不拼接重试答案；最终提交不重复全文。ACP 仅处理原 Agent、当前请求与对应 attempt，取消后忽略后续实时帧。下游失败即停止后续播放，保留失败状态。默认完整答复模式保持兼容。

DSH 工作区：

~~~sh
pnpm exec vitest run packages/acp/acp/tests/live-stream.spec.ts packages/acp/acp/tests/live-text.spec.ts packages/acp/acp/tests/updates.spec.ts --maxWorkers=2
~~~

首字回归在模型输出一个字符后暂停，断言 ACP 已收到字符而请求尚未完成；其他回归覆盖不重复、失败、取消、前缀改写和会话隔离。bothouse 的公开插件、relay 与设备 API 回归分别覆盖从字段到首句以及模型未完成时取音频。真实模型计时与真机试听须另行记录。
