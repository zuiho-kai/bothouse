# 角色小家的小智板子固件（firmware-xiaozhi）

板子：spotpear sp-esp32-s3-1.28-box（ESP32-S3 圆屏）。固件基于上游开源小智 [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) 的 `v2.5.2`（49b4380b），这里只放我们的改动，不放上游源码、整片备份和编译出的二进制。

## 内容

- `patches/`：相对 `v2.5.2` 的 7 个提交（`git format-patch v2.5.2..rh` 生成）。主要改动：OTA 默认指向本地角色主机、关掉板子自带提示音/唤醒词/麦克风上行；为主机推流常开音频通道；圆屏显示和网页同款角色表盘（替换小智默认表情、字幕、状态栏）；提帧率。
- `FLASH.md`：刷写与整片恢复步骤（按 MAC 认板、先备份再刷）。
- `RESEARCH.md`：调研记录（出厂固件、分区表、小智 OTA/WebSocket 协议）。
- `scripts/`：装 ESP-IDF、编译、读串口日志的脚本。脚本和文档里的路径是原作者本机的 `~/code/role-household-fw`，换机器要改。

## 还原 rh 分支

```bash
git clone https://github.com/78/xiaozhi-esp32.git && cd xiaozhi-esp32
git checkout -b rh v2.5.2
git am /path/to/conest/role-household/firmware-xiaozhi/patches/*.patch
python scripts/build.py spotpear/sp-esp32-s3-1.28-box --wake-word disabled   # 需 ESP-IDF，见 scripts/build-fw.sh
```

打完后的树与原 `rh` 分支（b951562）逐字节一致（`git diff --quiet rh HEAD` 实测）。

## 注意

- 补丁 0004 把 OTA 默认地址写成作者家里 Mac 的局域网地址，别的网络要在 `main/Kconfig.projbuild`（`CONFIG_OTA_URL`）或 menuconfig 里改成自己的主机。
- 主机侧协议（OTA + WebSocket）在 `role-household/rh/` 里。
