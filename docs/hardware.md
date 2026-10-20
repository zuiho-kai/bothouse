# 线 3（可选）：把板子接到 CoNest

没有板子不用看这篇，线 1 + 线 2 已经能完整用。

做完这篇：板子屏幕显示角色表盘；对板子叫她的名字说一句话，这句发进 Discord 给对应的 bot，她的回答在板子上念出来。
板子不直接连 Discord，中间隔着本机的**角色小家主机**（`role-household/`）：

```
板子 ──Wi-Fi：OTA + WebSocket（端口 8791）──▶ 角色小家主机 rh.host ──webhook──▶ Discord 频道 ──▶ ccm 里的 bot
板子 ◀──────────── 念摘要 ─────────────────── 主机 ◀── ccm 的 message.sent 钩子（bot 回了什么）
```

## 先选固件

| | 1.28 圆屏（角色小家固件） | 1.75 AMOLED（conest 自己的固件） |
|---|---|---|
| 板子 | spotpear sp-esp32-s3-1.28-box | Waveshare ESP32-S3-Touch-AMOLED-1.75 |
| 固件 | 上游开源小智 [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) `v2.5.2` + `role-household/firmware-xiaozhi/patches/` 14 个补丁 | 自写 IDF 工程 |
| 状态 | 能用：前几版已在真板上和角色小家主机跑通；补丁里最新的表盘改动（0009–0014）已编译，还没刷板验证 | **还不能用**：工程骨架在未合并的 [PR #72](https://github.com/Zssan12/conest/pull/72)；main 上只有素材打包工具（`firmware/esp32s3/`） |
| 怎么接 | 下面「1.28：从开箱到第一句话」 | 等 PR #72 合并后补；现在先看 `firmware/esp32s3/README.md` |

手上是别的 ESP32-S3 小智板：上游小智支持的板子大多能套这些补丁，但表盘（`CONFIG_RH_DIAL`）只接了 1.28 这块，别的板要自己接。

## 1.28：从开箱到第一句话

下面用两个变量代替路径，换成你自己的：

```sh
export CONEST=/path/to/conest                 # 本仓库
export FW=/path/to/xiaozhi-esp32              # 小智源码（第 2 步 clone 的位置）
```

`role-household/firmware-xiaozhi/FLASH.md` 和 `scripts/` 里写的 `~/code/role-household-fw` 是原作者本机的目录，对应这里的 `$FW` 的上一级。

### 1. 装 ESP-IDF

照 [ESP-IDF 官方安装说明](https://docs.espressif.com/projects/esp-idf/) 装（作者用 v6.1），之后 `. <esp-idf>/export.sh`，
`idf.py --version` 能出版本号。`role-household/firmware-xiaozhi/scripts/install-idf.sh` 是作者的安装脚本，可以参考。

### 2. 打补丁、改主机地址、编译

```sh
git clone https://github.com/78/xiaozhi-esp32.git "$FW" && cd "$FW"
git checkout -b rh v2.5.2
git am "$CONEST"/role-household/firmware-xiaozhi/patches/*.patch
```

**改 OTA 地址**：补丁把板子默认去找的主机地址写成了原作者家里那台 Mac 的局域网地址。编译前改成你跑主机那台电脑的地址：

```sh
idf.py menuconfig    # Xiaozhi Assistant → OTA URL，改成 http://<你电脑的局域网 IP>:8791/xiaozhi/ota/
```

（或者直接改 `main/Kconfig.projbuild` 里 `config OTA_URL` 的 `default`。）不改也行：刷完后在板子的配网热点页「高级选项」里填，
会存进板子，覆盖编译默认值（见第 4 步）。`8791` 要和 `roles.toml` 的 `[xiaozhi] port` 一致。

编译：

```sh
python scripts/build.py spotpear/sp-esp32-s3-1.28-box --wake-word disabled
```

表盘组件 `cn_dial` 从 conest 仓库拉（`main/idf_component.yml`），conest 是私有仓库时要有 github.com 的 git 凭据。

### 3. 先备份，再刷

**每块板刷之前先整片备份**（16MB，约 60 秒，只读），刷坏了能原样写回。步骤和命令见
`role-household/firmware-xiaozhi/FLASH.md` 第 1、2 节（按 MAC 认板、`read-flash`）。备份没成功的板不要刷。

刷写见 FLASH.md 第 3 节。要点：已经是这套固件的板只写 `ota_data_initial.bin` 和 `xiaozhi.bin` 两段，**不要从 0x0 写 merged 整包**，
那会把板子存的 Wi-Fi 清掉。全新的板（出厂小智）才写整包。刷不进时按住 BOOT 再插 USB。

恢复出厂：FLASH.md 第 4 节，用这块板自己的备份整片写回。

### 4. 配 Wi-Fi

板子开机连不上网时会开一个热点。手机连上，打开 `http://192.168.4.1`，填家里的 Wi-Fi。
没在第 2 步改 OTA 地址的，在同一页「高级选项」里填 `http://<你电脑的局域网 IP>:8791/xiaozhi/ota/`。
板子和电脑要在同一个局域网。

### 5. 主机认板子、绑角色

先按[线 1](ccm-and-wiki.md)、[线 2](connect-discord-feishu.md) 把 ccm 和 Discord 跑起来，再起角色小家主机：

```sh
cd "$CONEST"/role-household
uv sync
cp roles.example.toml roles.toml && cp .env.example .env     # 都是本地文件，不进 git
# 按 role-household/README.md「全本地启动」起 hub 和主机
```

板子第一次连上，主机日志里有「未绑定的板子 xx:xx:xx:xx:xx:xx 连上了」。把这个 MAC 写进 `roles.toml`：

```toml
[xiaozhi]
port = 8791

[[xiaozhi.boards]]
device = "xx:xx:xx:xx:xx:xx"
role = "a"            # roles.toml 里哪个角色
```

重启主机，板子屏幕换成这个角色的表盘。

### 6. 接 Discord：叫她的名字说话

在 `roles.toml` 的 `[discord]`：`relay = true`、`channel = "<默认发言频道 ID>"`、`play = true`（真板出声；没人在场时关掉），
加一条 `[[discord.bots]]` 把 Discord bot 映射到这个角色。token / webhook 地址写进 `.env`。
默认发言频道和自动选频道怎么配见线 2 最后一节；逐项说明见 `role-household/docs/DISCORD_BODY.md`。

ccm 那边要让主机知道 bot 回了什么：全局 `[[hooks]]` 的 `message.sent` 指向 `http://127.0.0.1:8791/rh/discord/hook`。

## 怎么验证

1. 主机日志：板子连上、绑到角色；开了 relay 时有「[discord] 自检通过」。
2. 对板子说「<角色唤醒词>，你好」→ 默认频道里出现一条「板子」发的消息，@ 了对应的 bot。
3. bot 回复后，板子念出一两句（配了摘要）或全文；屏幕表盘在「说话」状态。
4. 说「暂停」，板子停下。
