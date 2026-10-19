#!/bin/bash
# 编译 rh 分支，spotpear/sp-esp32-s3-1.28-box；产物拷到 build-out/。不刷写。
set -ex
export PATH=~/esp/pybin:$PATH
grep -q IDF_INSTALL_DONE ~/code/role-household-fw/logs/install-idf.log || { echo "IDF not installed yet"; exit 1; }
. ~/esp/esp-idf/export.sh
idf.py --version
cd ~/code/role-household-fw/xiaozhi-esp32
git rev-parse --abbrev-ref HEAD; git rev-parse HEAD
python scripts/build.py spotpear/sp-esp32-s3-1.28-box --wake-word disabled
echo "--- sdkconfig check"
grep -E '^CONFIG_OTA_URL|RH_|^CONFIG_FREERTOS_HZ=|^CONFIG_FLASH_.*ASSETS=|^CONFIG_WAKE_WORD_DISABLED|^CONFIG_USE_.*WAKE_WORD|^CONFIG_BOARD_TYPE_SPOTPEAR_ESP32_S3_1_28_BOX' sdkconfig
# 板子 config.json sdkconfig_append 里的 CONFIG_FREERTOS_HZ=1000（提帧率，xiaozhi-esp32 1ac6ef1）必须进了这次构建
grep -qx 'CONFIG_FREERTOS_HZ=1000' sdkconfig || { echo 'CONFIG_FREERTOS_HZ is not 1000'; exit 1; }
OUT=~/code/role-household-fw/build-out
mkdir -p $OUT
cp build/merged-binary.bin $OUT/rh-sp-esp32-s3-1.28-box-merged.bin
cp build/xiaozhi.bin build/ota_data_initial.bin build/flasher_args.json $OUT/ 2>/dev/null || true
cp build/bootloader/bootloader.bin build/partition_table/partition-table.bin $OUT/ 2>/dev/null || true
cp sdkconfig $OUT/sdkconfig.used
cd $OUT && shasum -a 256 *.bin | tee SHA256SUMS
echo BUILD_DONE; date
