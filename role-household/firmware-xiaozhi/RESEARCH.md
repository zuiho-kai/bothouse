# 角色小家固件调研（2026-10-19，只读，未刷写）

## 1. 备份（完成）
- 文件：/Users/zuiho/code/role-household-fw/backup/90-70-69-f5-89-e4.bin（16777216 字节，60.4 秒读完），日志同目录 backup.log
- sha256：5f43746ca27056b334f151366e6896d4d359ef47beb1b53bf5a0d7ad4ec69a3a（shasum -a 256 实测）
- 注意：esptool 实测这块板 MAC 是 90:70:69:f5:89:e4，不是任务里写的 f6:69:98（那是另一块板，或笔误）。文件按实测 MAC 命名。另两块到货后各自再备份。
- 芯片：ESP32-S3 QFN56 rev v0.2，内嵌 PSRAM 8MB，晶振 40MHz，USB-Serial/JTAG（backup.log 开头输出）。
- 分区表（从备份 0x8000 解析）：nvs 0x9000/16K；otadata 0xd000；phy_init 0xf000；ota_0 0x20000/0x3f0000；ota_1 0x410000/0x3f0000；assets 0x800000/8MB（皮肤/表情/唤醒词模型资源）。
- 备份内字符串：OTA https://api.tenclass.net/xiaozhi/ota/ ，WS wss://api.tenclass.net/xiaozhi/v1/ 。即出厂是官方小智固件（连 xiaozhi.me），不是 Spotpear 私有服务。
- 恢复：esptool write-flash 0 <bak>.bin 即可整片还原。

## 2. 开源小智里的对应板
- 有：main/boards/spotpear/sp-esp32-s3-1.28-box/（config.h、config.json、sp-esp32-s3-1.28-box.cc、power_manager.h、README.md）
  https://github.com/78/xiaozhi-esp32/tree/main/main/boards/spotpear/sp-esp32-s3-1.28-box
  该目录最近提交 d91d6824（2026-07-27）；仓库最新 release v2.5.2（2026-10-11），main 的 CMakeLists PROJECT_VER 为 2.5.3。
- README 同时列出两个商品页链接（小短腿款、挂胸款），所以两款共用这一个 board（README.md 第 4-5 行）。仍要等插上实板用日志核对（如触摸、电池脚）。
- 引脚（config.h）：
  - 屏：GC9A01（`#include <esp_lcd_gc9a01.h>`，组件 espressif/esp_lcd_gc9a01 ~2.0.4），240x240，SPI：SCLK=4 MOSI=2 CS=5 DC=47 RST=38，背光=42（反相），40MHz，mirror_x=true
  - 音频：ES8311 codec（ES8311_CODEC_DEFAULT_ADDR），I2C SDA=15 SCL=14；I2S MCLK=16 WS=45 BCLK=9 DIN=10 DOUT=8；功放 PA=46；输入输出采样率 24000
  - 触摸：CST816D，SDA=11 SCL=7 RST=6 INT=12
  - 电池：ADC=1，充电检测=41；LED=48；BOOT 键=0
  - 注意：config.h 注释写着 "Movecall Moji configuration"，是复制来的，不影响引脚。
- 编译选板：`idf.py set-target esp32s3` → menuconfig → Xiaozhi Assistant → Board Type → Spotpear ESP32-S3-1.28-BOX（README.md）。
- 商品页（spotpear.cn 小短腿款）没有写驱动芯片和引脚，只说出厂装小智、可自行刷别的固件。

## 3. 怎么接自建服务器
- OTA 地址：
  - 编译时：main/Kconfig.projbuild 第 3-5 行 `CONFIG_OTA_URL`，默认 https://api.tenclass.net/xiaozhi/ota/
  - 运行时：NVS 键 `ota_url` 优先于编译值（main/ota.cc 第 56-62 行 GetCheckVersionUrl）。配网热点页（http://192.168.4.1）顶部「高级选项」可填并保存（xinnan-tech 的 docs/firmware-setting.md 第 31 行）。所以不重编也能改地址。
- WebSocket 地址：不用单独配。设备请求 OTA 地址，OTA 返回 JSON 里带 `websocket`（url、token）和可选 `mqtt` 段，设备存进 NVS（main/ota.cc 第 159-190 行）。服务端实现见 core/api/ota_handler.py 的 _get_websocket_url。
- 协议文档（官方）：
  - https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md（中文 websocket_zh.md）
  - MQTT+UDP 备选：docs/mqtt-udp.md；MCP：docs/mcp-protocol.md；动态字形：docs/glyph-push.md
- 协议要点（websocket.md）：
  - 握手头：Authorization(Bearer token)、Protocol-Version、Device-Id(MAC)、Client-Id(UUID)
  - 设备先发 hello：type=hello、version、features(mcp/aec/glyph_push)、transport=websocket、audio_params{format=opus, sample_rate=16000, channels=1, frame_duration=60}；服务端须在 10 秒内回 hello（transport=websocket，可带 audio_params 指定下行采样率）
  - 二进制帧：v1 裸 Opus；v2 带 16 字节头；v3 带 4 字节头（type,reserved,len）
  - 设备→服务端 JSON：listen(state=start/stop/detect)、abort、mcp
  - 服务端→设备 JSON：stt(text)、llm(emotion, text)、tts(state=start/stop/sentence_start)、mcp、system、alert、custom
  - 表情：llm 消息的 emotion 字段（如 happy、sad、neutral），设备本地按名字切动画。
  - 重点：服务端能主动推 tts start + Opus 帧 + llm emotion 给已连着的设备，不一定要等设备先说话——这需要实板验证（文档示例流程是设备先 listen）。
- 开源服务端：xinnan-tech/xiaozhi-esp32-server（10.9k star，2026-10-16 仍在更新）
  - main/xiaozhi-server/core/websocket_server.py、core/connection.py、core/handle/helloHandle.py、textHandle.py、receiveAudioHandle.py、sendAudioHandle.py（emotion/tts 发送）、core/api/ota_handler.py
  - 部署：docs/Deployment.md；固件配置：docs/firmware-setting.md
  - 其他实现：joey-zhou/xiaozhi-esp32-server-java、AnimeAIChat/xiaozhi-server-go、hackers365/xiaozhi-esp32-server-golang（官方 README 第 137-142 行）
- 主机侧最小实现：自写一个 aiohttp/websockets 服务，提供 OTA JSON 端点 + ws 端点，几百行；不必整套部署 xinnan 全模块（它自带 ASR/LLM/TTS，我们已有自己的）。

## 4. 本地唤醒词
- Kconfig 三种（main/Kconfig.projbuild 约 916-970 行）：关闭 / `USE_AFE_WAKE_WORD`（WakeNet+AFE，用预置词，如「你好小智」）/ `USE_CUSTOM_WAKE_WORD`（MultiNet 命令词）。
- 自定义词路线：`CONFIG_CUSTOM_WAKE_WORD` 填拼音、空格分隔（默认 "xiao tu dou"），`CUSTOM_WAKE_WORD_DISPLAY`（默认「小土豆」，唤醒后发给服务器的问候文本），`CUSTOM_WAKE_WORD_THRESHOLD`（1-99，默认 20，越小越灵敏）。需要 ESP32-S3 + PSRAM，本板满足。
- 实现：main/audio/wake_words/custom_wake_word.cc，用 esp_mn_commands_add 把拼音当命令词加入 MultiNet，不需训练。所以「xiao ju」「jing yu niang」「cai hong mao」都可直接配，且无需重训。
- 局限（需要实测）：MultiNet 是命令词识别，不是专用唤醒词模型，误唤醒和短词（两字）识别率通常不如 WakeNet；一块板一个词，三块板各配各的。同音字（橘/局/菊）靠拼音，没问题。
- 要正式 WakeNet 自定义词：Espressif 有两条路，付费定制流程，或文档里提到的 TTS 合成数据训练（esp-sr 2.5.4 readme；TTS Pipeline V3 支持中文，2026-04 发布说明）。https://components.espressif.com/components/espressif/esp-sr/versions/2.5.4/readme 。官方原话我没能核实训练周期和费用。
- 固件 README 另说可在线生成唤醒词/字体/表情/背景：78/xiaozhi-assets-generator（对应分区里 8MB assets）。

## 5. 本机编译环境
- 现状：本机未装 ESP-IDF（~/esp、~/.espressif 都不存在，idf.py 无）；有 cmake、ninja；系统 python 3.9.6。
- 要求：官方 README 第 17、117 行——最低 ESP-IDF v6.0.1，推荐 v6.1，不再支持 5.x。组件 espressif/esp-sr==2.4.7。
- 安装：git clone esp-idf v6.1 --recursive + install.sh esp32s3（要下 xtensa 工具链，约 1.5-3GB；预计 15-30 分钟，取决于网络，可能要代理）。我没实测。
- 首次编译：预计 10-20 分钟（含组件下载、esp-sr 模型）；增量 1-3 分钟。均为经验估计，没在本机测过。
- 若 python 3.9 与 IDF 6.x 不兼容，要另装较新 python（uv 可装）。

## 6. 两条路对比
| | A 小智固件改地址 | B 自写精简固件 |
|---|---|---|
| 工作量 | 极小：设 OTA 地址（热点页即可，甚至不用编译），主机侧写 OTA+ws 服务 | 大：I2S/ES8311、Opus 解码、GC9A01 动画、Wi-Fi 配网、OTA 都要自己写 |
| 屏幕/音频/触摸/电池 | 已有现成驱动，实板验证过 | 要自己抄 config.h 再调 |
| 唤醒词 | 自带 MultiNet 自定义词 | 要自己集成 esp-sr |
| 表情 | 用小智表情集 + assets 可换；emotion 名字有限 | 完全自定义，可对应角色 |
| 对「原来的有点笨」 | 笨在云端（tenclass 的模型/人设），固件本身不笨；换主机后端就解决 | 同上，但无谓重写 |
| 风险 | 协议固定为小智模型：设备主导对话回合；主机主动推播需验证；固件跟官方升级 | 工期、调试、音频回声 |

推荐：先 A，且是「魔改」而非「只改地址」。
1. 马上：不刷固件也行，热点页把 OTA 地址指向主机，主机侧实现 OTA+ws 小智协议，把现有 rh 的角色大脑接上，先验证端到端。
2. 然后 fork 78/xiaozhi-esp32，选 spotpear/sp-esp32-s3-1.28-box，改 Kconfig 默认 OTA、自定义唤醒词（xiao ju 等）、表情资源，固件里再加角色特有行为（主机主动推送 tts/表情）。
3. 只有当 A 的协议限制（比如主机主动说话、自定义表情）确实卡住才考虑 B。B 的价值只在表情/交互完全自定义，代价大，现在没有证据需要。
- 备份在手，随时可恢复，刷写风险低。

## 用户原话里没有、我加的设定
- 无（以上均为调研，没有加功能）。待验证：主机主动推播、同款两个商品页是否真共用同一 board 配置、MultiNet 唤醒准确率。
