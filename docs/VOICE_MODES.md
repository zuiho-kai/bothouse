# 语音三模式：陪伴 / 工作 / 自动

状态：开发中（2026-10-28），默认关闭。对应 PR #601。

语音入口默认仍是一条链路：识别后一律进现有 Agent。打开 `modes_enabled` 后才启用三模式与快脑支线；关闭时行为与旧链路一致，可作为回滚开关。

## 模式

| 模式 | 走哪条链路 | 说明 |
| --- | --- | --- |
| `companion` | 规则白名单命中 → 小脑（快模型）；其余 → 大脑 | 陪伴优先首声速度，不确定时仍走大脑 |
| `work` | 固定走现有 Agent（ACP / 桥接） | 与今天的工作链路相同 |
| `auto` | 先过规则白名单：命中 → 小脑；其余 → 大脑 | 分流只看硬规则，没有相似度阈值 |

- `default_mode` 默认 `work`；设备没上报模式时用它。
- 分流白名单是硬规则（问候、告别、感谢、情绪陪聊、简单时间类、设备口令），不做自造的相似度阈值；拿不准一律走大脑。
- 分错时优先转大脑：小脑未出声失败 → 回退大脑并标 `route_escalated`；已经出声 → 报错不重答（每轮只有一个 `answer_owner`）。
- 工作模式（含回退到大脑的陪伴轮次）按 4 秒口径验收；陪伴模式即使回退大脑也按 2 秒判。

## 配置

都在语音实例配置（`Settings`）里，前缀无：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `modes_enabled` | `false` | 总开关；关闭时其它字段不生效 |
| `default_mode` | `work` | `companion` / `work` / `auto` |
| `fast_brain_provider` | `disabled` | `disabled` / `mock`（离线） / `openai`（OpenAI 兼容流式） |
| `fast_brain_base_url` | 空 | `openai` 时必填 |
| `fast_brain_model` | 空 | `openai` 时必填 |
| `fast_brain_api_key_env` | `FAST_BRAIN_API_KEY` | 只从该环境变量读密钥，不落配置、不落日志 |
| `fast_brain_first_token_timeout_s` | `0.8` | 首字超时且尚未出声 → 回退大脑 |
| `memory_pack_path` | 空 | 预生成的记忆包 JSON；空则不用记忆包 |
| `memory_pack_ttl_s` | `600` | 记忆包后台刷新周期；过期先用旧版 |
| `voice_outbox_dir` | 空 | 语音日记目录；空则用 `data_dir` |

`mock` provider 用于离线验证，不访问网络。

## 设备与网关接口

- `GET /device/{id}/api/mode` 返回当前模式与 `modes_enabled`。
- `PUT /device/{id}/api/mode`，body `{mode, operation_id}`；`operation_id` 用于重试去重，非法模式返回 400。
- `/turn` 可带 `mode` 与 `speech_end_ms`；不带时用设备已保存的模式，再退到 `default_mode`。
- 网关侧：conest PR #254 让 8796 接受板端 `hello.voice_mode` 或 `{"type":"voice_mode","mode":...}`，并在 `POST /turn` 透传 `mode`/`speech_end_ms`。板端 NVS 是模式事实源，网关只做镜像。

## 延迟口径与测量

验收时钟：**用户说完 → 第一句有效回答开始出声**，不含提示音与 "thinking"。

- `e2e_first_playback_ms`：设备上报说完 → 设备上报首段开始播放，这是验收数。
- `e2e_first_audio_ms`：说完 → 8796 首段音频可播放（下限，还没算传到板子）。
- 另有 `submit_to_first_audio_ms`、`route_ms`、`fast_first_token_ms`、`fast_first_sentence_ms`。

目标：陪伴 2 秒、工作 4 秒；`auto` 按实际路由判（小脑 2 秒、大脑 4 秒）。

汇总工具（在 `companion/` 下）：

```sh
PYTHONPATH=. python -m tools.voice_latency_report <events.jsonl 或其目录> --target-ms 2000
```

工具只读已记录的事件，按 `mode/route` 分组给 n、p50、p90、min、max；没有样本时输出空分布，不估计、不补样本。没有真机回执时不得宣称达标。

## 记忆

- **记忆包**：预生成 JSON（人设、近期摘要、高频事实、最近语音对话），进程启动时预读，TTL 到点后台刷新；刷新失败保留上一版。
- **语音日记**：每轮回答成功都追加一条 `voice-outbox.jsonl`（小脑与大脑轮次都写），字段含 `operation_id`、`transcript`、`answer`、`route`、`mode`、`model`、`confidence`、`escalated`；同一 `operation_id` 只写一次，写失败留在队列里下次重试。
- **合并**：`merge_staging()` 只把未复核记录写进 `voice-staging.jsonl`，标注 `voice-origin / 未复核`；不改 wiki/DSH 权威记忆，不把模型推断写成用户事实，冲突留给大脑或主人裁决。

## 未做的部分

- 真机 2 秒 / 4 秒采样与分布（需要刷板与真实模型；当前只有离线 mock 数据）。
- 向量路由（研究笔记里的阈值需要真实语音日志校准，本轮不编数）。
- 板端按键 / 屏幕模式切换（PWR 单击重播、长按关机、BOOT 按住说话/双击 AEC 均已被占用，改按键语义需要主人拍板）；板端固件在 `78/xiaozhi-esp32`，本机只读，未开 PR。
- 全双工 / AEC 未改动，沿用现有设备能力；模式按钮不等于全双工已完成。
