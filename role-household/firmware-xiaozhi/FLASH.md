# 刷写与恢复（spotpear sp-esp32-s3-1.28-box ×3）

只在用户在场时刷。镜像来自 `xiaozhi-esp32` 的 `rh` 分支，见 `build-out/SHA256SUMS`。

## 0. 环境

```bash
export PATH=~/esp/pybin:$PATH
. ~/esp/esp-idf/export.sh          # 之后 python -m esptool 可用（ESP-IDF v6.1 自带 esptool v5）
cd ~/code/role-household-fw
shasum -a 256 -c build-out/SHA256SUMS   # 先核对镜像没坏
```

## 1. 找三块板的端口，按 MAC 认板（只读）

三块板都用 USB 线接 Mac（板子是 ESP32-S3 自带 USB-Serial/JTAG，不用驱动）。

```bash
ls /dev/cu.usbmodem*
for p in /dev/cu.usbmodem*; do echo "== $p"; python -m esptool -p $p read-mac | grep -i '^MAC'; done
```

端口名（如 `/dev/cu.usbmodem101`）随插的 USB 口变，每次都按上面命令重新对一遍。
已知：`90:70:69:f5:89:e4` 已备份（2026-10-19 在 `/dev/cu.usbmodem101` 上读的）。另两块的 MAC 在第一次插上时填到这里：

| MAC | 本次端口 | 备份文件 |
|---|---|---|
| 90:70:69:f5:89:e4 | /dev/cu.usbmodem101 | backup/90-70-69-f5-89-e4.bin |
| （待填） | | |
| （待填） | | |

哪块板当哪个角色在主机配置里定，不在固件里（固件三块完全一样）。

## 2. 没备份过的板先整片备份（只读，16MB 约 60 秒）

```bash
PORT=/dev/cu.usbmodemXXX
MAC=$(python -m esptool -p $PORT read-mac | awk '/^MAC/{print $2}' | tr : -)
python -m esptool -p $PORT -b 921600 read-flash 0 0x1000000 backup/$MAC.bin 2>&1 | tee backup/$MAC.log
shasum -a 256 backup/$MAC.bin
```

备份没成功的板不要刷。

## 3. 刷写

**只写 otadata 和 app，不要从 0x0 写 merged 整包。** `merged-binary.bin` 从 0x0 连续铺到 assets 末尾，中间 0x9000–0xD000
（nvs，存 Wi-Fi）是填充的 0xFF，写进去等于把 Wi-Fi 清掉（2026-10-19 核对：merged 包 0x9000 起 16K 全是 0xFF；
原来这里写的「不含 nvs」不对）。分区表、bootloader、assets 没变时只写下面两段：

```bash
# 刷前先存一份当前 nvs（万一被清，用它写回：write-flash 0x9000 backup/pre-dial/nvs-<板>.bin）
python -m esptool -p $PORT -b 921600 read-flash 0x9000 0x4000 backup/pre-dial/nvs-$(basename $PORT).bin
python -m esptool --chip esp32s3 -p $PORT -b 921600 write-flash 0xd000 build-out/ota_data_initial.bin 0x20000 build-out/xiaozhi.bin
```

三块并行（每块一个后台进程，各写各的日志，`wait` 等全部结束）：

```bash
mkdir -p logs
for p in /dev/cu.usbmodem*; do
  n=$(basename $p)
  python -m esptool --chip esp32s3 -p $p -b 921600 write-flash 0xd000 build-out/ota_data_initial.bin 0x20000 build-out/xiaozhi.bin > logs/flash-$n.log 2>&1 &
done
wait
grep -L "Hash of data verified" logs/flash-*.log   # 有输出的就是没刷成的板
```

USB 连不上（esptool 报 No serial data received，2026-10-19 这块板刷两次后出现过）时不用拔插，走 Wi-Fi 升级：
把编好的 `xiaozhi.bin` 放到 `build-out/ota/xiaozhi.bin`，用 `RH_XIAOZHI_FIRMWARE=~/code/role-household-fw/build-out/ota/xiaozhi.bin`
启动主机 `rh.host`。板子连上时主机比对固件，不一样就让它自己下载、写另一个 OTA 分区、重启（不碰 nvs，不出声；新固件起不来会回滚）。
主机日志里有「固件 A → B ... 升级」和重连后的「固件已是 B」。

全新的板（没刷过 rh 固件、分区表或 assets 要换）才写 merged 整包，写完 Wi-Fi 要重配，或用该板备份里的 nvs 段写回：
`dd if=backup/<MAC>.bin bs=4096 skip=9 count=4 of=/tmp/nvs.bin` 再 `write-flash 0x9000 /tmp/nvs.bin`。
分区表和出厂一致（nvs 0x9000、ota_0 0x20000、ota_1 0x410000、assets 0x800000）。

屏幕：刷完开机就是角色表盘（固件 `CONFIG_RH_DIAL`），显示「等待主机」；连上主机后主机告诉它是哪个角色、换上头像。
看板子屏幕现在的样子：固件自带 MCP 工具 `self.screen.snapshot`（主机发 MCP，板子把截图 POST 到给的地址）。
出厂 nvs 里没有 `ota_url` 键（2026-10-19 扫过备份），所以刷完会用编译默认的 `http://192.168.31.111:8791/xiaozhi/ota/`（Mac en0 的局域网 IP，见 ~/wiki/hopover/hopover/hopover.md）。Mac 的 IP 变了，就在热点页「高级选项」改 OTA 地址（存进 nvs 的 `ota_url`），或改 Kconfig 默认值后重编重刷。

刷不进时：按住 BOOT 键再插 USB（或按住 BOOT 点一下 RST）进下载模式，再刷；把 `-b 921600` 降到 `460800`。

看开机日志（确认连的是主机、没出声、没收音）：

```bash
idf.py -p $PORT monitor     # 在 xiaozhi-esp32/ 目录下；Ctrl+] 退出
```
日志里应有 `rh: local sound suppressed`（本该响的提示音被压掉），按键后应有 `rh: listening disabled, staying idle`。

板子连不上主机时：先配 Wi-Fi（板子开热点，手机连上开 http://192.168.4.1）；热点页「高级选项」里也能临时改 OTA 地址（存进 nvs 的 `ota_url`，会覆盖编译默认值）。

## 4. 恢复出厂（用整片备份）

```bash
python -m esptool --chip esp32s3 -p $PORT -b 921600 write-flash 0 backup/<该板MAC>.bin
```

整片 16MB 写回，包括出厂 nvs（Wi-Fi、小智云端的 websocket/mqtt 配置），等于回到备份那一刻。必须用这块板自己的备份（按 MAC 对应），不要混用。
如果刷了别的东西后 nvs 乱了，只清 nvs：`python -m esptool -p $PORT erase-region 0x9000 0x4000`（Wi-Fi 要重配）。
