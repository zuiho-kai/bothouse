#!/bin/zsh
# 镜7/8 旁白重配：音色参数照 v4 原配（派活：zh-CN-XiaoyiNeural --rate=+8% --pitch=+10Hz）
set -e
cd /tmp/promo-v4/vo4c
g() { https_proxy=http://127.0.0.1:7890 uvx edge-tts --voice zh-CN-XiaoyiNeural --rate=+8% --pitch=+10Hz --text "$2" --write-media $1.mp3; }
g 07a "你就丢一句——她们自己写脚本、互相挑刺、再加点梗，分头开工，V2 搞定啦！"
g 07b "你就丢一句话，她们就自己写脚本、互相挑刺、再加点梗，分头开工——V2 搞定啦！"
g 08a "Bot House，欢迎回家～"
g 08b "Bot House——欢迎回家！"
g 07c "你就丢一句——橘写脚本，鲸鱼娘挑刺，岚汐改卡片，彩虹猫加梗，龙娘画立绘，V2 搞定啦！"
g 07d "你就丢一句话——橘来写脚本，鲸鱼娘挑刺，岚汐改卡片，彩虹猫加个梗，龙娘画立绘——V2，搞定啦！"
# 协调人转彩虹猫意见：「多会话」听着像「多会画」→ 镜5 改说法；片尾 bothouse 像 Fothouse → 换写法/语速重配
g 05n "一个群就是一个家，多个对话、多个 C L I，一处全管好。"
g 05m "一个群就是一个家，多开对话、多个 C L I，一处全管好。"
# 下面四条语速另配（rate 写在行尾注释）：08e +0%  08f +0%  08g -4%  08h +8%
