# 角色小家的小智板子固件（firmware-xiaozhi）

板子：spotpear sp-esp32-s3-1.28-box（ESP32-S3 圆屏）；另支持斑梨 1.28 摄像头版 spotpear sp-esp32-s3-1.28-cam-low（GC0308，补丁 0018 新增板型）。固件基于上游开源小智 [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) 的 `v2.5.2`（49b4380b），这里只放我们的改动，不放上游源码、整片备份和编译出的二进制。

## 内容

- `patches/`：相对 `v2.5.2` 的 19 个提交（`git format-patch v2.5.2..rh` 生成，rh 即 rh-dial-fontfix 42ed5fa）。主要改动：OTA 默认指向本地角色主机、关掉板子自带提示音/唤醒词；为主机推流常开音频通道；圆屏显示和网页同款角色表盘（替换小智默认表情、字幕、状态栏）；提帧率；板子麦克风上行给主机（0008）；表盘尺寸与叠加层改用 conest `firmware/dial/` 的共用组件 cn_dial / cn_dial_lvgl（0009–0014，锁定 conest 472d06e）；熄屏检查与唤醒串行进主任务（0015）、背光渐变按目标判重（0016）、`scripts/build.py` 换板型时一并作废派生的 `build/config/sdkconfig.json`（0017）；新板型 sp-esp32-s3-1.28-cam-low，引脚取斑梨 xiaozhi-esp32-2.1.0 源码并对原理图，开表盘（0018）；表盘字体判定改在主题字体换上之后做，修复开机时用内置英文字体判定不合适就放弃表盘、表盘不显示（0019）。
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

摄像头版把板型换成 `spotpear/sp-esp32-s3-1.28-cam-low`。

打完后的树与原 `rh` 分支（42ed5fa）逐字节一致（两边 tree 均为 e457d281，实测）。编译时 `CONFIG_RH_DIAL` 会从 conest 私有仓库拉 cn_dial，需要 github.com 的 git 凭据。这一版已编译通过，已刷三块板（两块 1.28-box、一块 1.28-cam-low），串口均见 `dial shown`。

## 注意

- 补丁 0004 把 OTA 默认地址写成作者家里 Mac 的局域网地址，别的网络要在 `main/Kconfig.projbuild`（`CONFIG_OTA_URL`）或 menuconfig 里改成自己的主机。
- 主机侧协议（OTA + WebSocket）在 `role-household/rh/` 里。
