#!/bin/sh
# bothouse for JiuwenSwarm, one line:
#   curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/jiuwenswarm/plugin-pkg/install.sh | sh
# Finds the Python that JiuwenSwarm was installed into (from the jiuwenswarm-start on PATH) and runs install.py
# with it. From a checkout it uses the files next to this script; piped from curl it downloads them first
# (files.txt).
set -eu
RAW=https://raw.githubusercontent.com/zuiho-kai/bothouse/main
PKG=jiuwenswarm/plugin-pkg

start=$(command -v jiuwenswarm-start || true)
if [ -z "$start" ]; then
  echo "没找到 jiuwenswarm-start：先装 JiuwenSwarm（pip install workswarm），并让它在 PATH 里。" >&2
  exit 1
fi
# pip writes the interpreter into the script's first lines: "#!/path/python", or "'''exec' /path/python" for long paths
py=$(head -n 3 "$start" | sed -n -e "s/^#!\(.*python[0-9.]*\)$/\1/p" -e "s/^'''exec' \(.*python[0-9.]*\) .*/\1/p" | head -n 1)
if [ -z "$py" ] || [ ! -x "$py" ]; then
  echo "看不出 $start 用的是哪个 Python：用 JiuwenSwarm 所在环境的 python 运行 install.py。" >&2
  exit 1
fi

dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -z "$dir" ] || [ ! -f "$dir/install.py" ]; then
  # piped from curl: files.txt lists every file install.py reads, as paths in the repository
  top=$(mktemp -d)
  trap 'rm -rf "$top"' EXIT
  mkdir -p "$top/$PKG"
  curl -fsSL "$RAW/$PKG/files.txt" -o "$top/$PKG/files.txt"
  while read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$top/$(dirname "$f")"
    curl -fsSL "$RAW/$f" -o "$top/$f"
  done < "$top/$PKG/files.txt"
  dir=$top/$PKG
fi
"$py" "$dir/install.py"
