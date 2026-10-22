#!/bin/sh
# 旧入口（已有的 agent.closed 钩子和 cron 还在调它）：转给同目录的 sub-wiki.py（三个系统同一份）
exec "${WIKI_PYTHON:-python3}" -X utf8 -I "$(dirname -- "$0")/sub-wiki.py" "$@"
