# 与角色小家（role-household）的协作说明

角色小家是同一方向的另一半：自有云端频道（类 Discord，WebSocket 推送）、多角色全局发言锁（同一时间只有一个在说，人说话可打断）、以后每个角色一台 ESP32 圆屏小机器人。CoNest 已有成熟的语音链路（mlx_whisper 转写、Qwen3-TTS 分块流式、每位伙伴一种音色）。

拟定分工（待双方确认）：

```
  云端频道（role-household hub）
        ▲              ▲
  角色主机 + 发言锁      语音节点（CoNest companion/voice）
                       麦克风转文字 → 发进频道
                       频道发言 → 按角色音色播放
```

- 频道、发言锁、硬件：role-household。
- 语音输入输出：复用 CoNest 的 `companion/voice`，通过频道的文字接口接入。
- 开放问题：本仓库许可证（见 #9）；`companion/voice` 是否拆成可独立使用的包。
