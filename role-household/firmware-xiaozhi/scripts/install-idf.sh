#!/bin/bash
# 装 ESP-IDF v6.1 到 ~/esp/esp-idf（RESEARCH.md 第5节：最低 6.0.1，推荐 6.1）
set -ex
# python 3.9 对 IDF 6.x 太旧，用 uv 装好的 3.12
mkdir -p ~/esp/pybin && ln -sf /Users/zuiho/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12 ~/esp/pybin/python3 && ln -sf ~/esp/pybin/python3 ~/esp/pybin/python
export PATH=~/esp/pybin:$PATH
python3 --version
cd ~/esp
if [ ! -d esp-idf/.git ]; then
  git clone -b v6.1 --depth 1 --recursive --shallow-submodules https://github.com/espressif/esp-idf.git
fi
cd esp-idf && git describe --tags
./install.sh esp32s3
echo IDF_INSTALL_DONE
date
