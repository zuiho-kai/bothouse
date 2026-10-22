#!/bin/zsh
# 每个 sub 角色（bots.json 里列的）的记忆 wiki，和主角色的 ~/wiki 同一份程序（bin/ingest.py）、同样的触发。
# 每次先 export.py 把她的会话转成转录，再跑 ~/wiki/bin/ingest.py，
# 经她自己的 bin/ingest.py（转发到共享版，WIKI_DIR=她的 wiki；她的 config.json 写明是谁的）。
#
#   sub-wiki.sh pending   每 30 分钟（cc-connect cron，见 README）
#   sub-wiki.sh nightly   周一至周六 03:00（夜间整理 + 反思 dream）
#   sub-wiki.sh lint      周日 03:00
#   sub-wiki.sh hook      cc-connect 的 agent.closed 钩子（她的 agent 进程关掉时；对应主角色的 SessionEnd hook）：
#                         环境变量 CC_HOOK_PROJECT / CC_HOOK_AGENT_SESSION_ID，立刻返回，后台导出并整理那一个会话
#
# 各位串行跑（夜里和主角色各用各的锁：锁在各自 wiki 里；串行是为了同一时间只占一份 Codex 额度）。
# 锁和主角色一样：白天（pending、hook）不等锁——ingest --pending 拿不到锁就跳过、--session 拿不到就排进队列，
# export.py --no-wait 拿不到某位的锁就跳过她（下一次补）；夜里（nightly、lint）等锁。
# 日志：本目录 sub-wiki.log（本脚本）+ 各 wiki 的 .ingest.log（ingest 自己的）。
set -u
here=${0:A:h}
log=$here/sub-wiki.log
py=${WIKI_PYTHON:-/usr/bin/python3}
# bots.json（$WIKI_BOTS，默认本目录；格式见 bots.example.json）→ cc-connect 项目名 → bot key，bot key → wiki 目录
typeset -A wiki wdir
for line in ${(f)"$($py -I $here/export.py --list)"}; do  # 每行：<bot> <project> <wiki 目录>
  parts=(${=line}); wiki[${parts[2]}]=${parts[1]}; wdir[${parts[1]}]=${parts[3]}
done

say() { echo "$(date '+%F %T') $*" >> $log }

run_one() {  # <wiki 目录名> <ingest 参数…>
  # 走她自己的 bin/ingest.py（转发入口）：它确认 ~/wiki/bin 是共享版才转发，不是就拒绝（~/wiki 没合或回退时
  # 旧版会把橘的会话写进她的 wiki；review 2026-10-20 sub-parity-code-2 A）
  local b=$1; shift
  say "$b ingest $*"
  $py -I ${wdir[$b]}/bin/ingest.py "$@" 2>> ${wdir[$b]}/.ingest.log ||
    say "$b ingest $* exited $?"
}

mode=${1:-}
case $mode in
  pending|nightly|lint)
    say "start $mode"
    nowait=(); [[ $mode == pending ]] && nowait=(--no-wait)
    $py -I $here/export.py $nowait >> $log 2>&1 || say "export failed (ingest still runs on what is there)"
    for b in ${(k)wdir}; do run_one $b --$mode; done
    say "done $mode" ;;
  hook)
    b=${wiki[${CC_HOOK_PROJECT:-}]:-}
    [[ -n $b ]] || exit 0  # 主角色有 Claude Code 自己的 SessionEnd hook；bots.json 外的项目不管
    id=${CC_HOOK_AGENT_SESSION_ID:-}
    # 钩子有超时（cc-connect 默认 10 秒）：脱离出去跑，马上返回。cc-connect 的环境带着 secrets.env 的全部变量：
    # 和主角色的 ingest.py --hook 一样只留最小环境：HOME、PATH 同橘的写法，USER LOGNAME TMPDIR LANG 有就照传
    # （ingest.py main() 的 --hook 分支），zsh -f 不读启动文件；WIKI_BOTS/WIKI_TRANSCRIPTS/WIKI_PYTHON 照传
    nohup /usr/bin/env -i HOME=$HOME PATH=$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin USER=${USER:-$(id -un)} \
      LOGNAME=${LOGNAME:-${USER:-$(id -un)}} ${TMPDIR:+TMPDIR=$TMPDIR} ${LANG:+LANG=$LANG} \
      ${WIKI_BOTS:+WIKI_BOTS=$WIKI_BOTS} ${WIKI_TRANSCRIPTS:+WIKI_TRANSCRIPTS=$WIKI_TRANSCRIPTS} ${WIKI_PYTHON:+WIKI_PYTHON=$WIKI_PYTHON} \
      /bin/zsh -f $0 hook-run $b $id >/dev/null 2>&1 &
    exit 0 ;;
  hook-run)
    b=$2; id=${3:-}
    say "hook $b agent session ${id:-?}"
    $py -I $here/export.py --no-wait $b >> $log 2>&1 || say "export $b failed"
    # 导出文件名里带 agent 会话 id（<后 8 位>-<id>.jsonl）；找不到就按 --pending 处理所有空闲会话
    f=( ${WIKI_TRANSCRIPTS:-$here/transcripts}/$b/*/*${id}*.jsonl(N) )
    if [[ -n $id && ${#f} -eq 1 ]]; then run_one $b --session ${f[1]:t:r}; else run_one $b --pending; fi ;;
  *)
    echo "usage: sub-wiki.sh pending|nightly|lint|hook" >&2; exit 2 ;;
esac
