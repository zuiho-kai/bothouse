# Scheduled channel messages / 定时往频道发消息

cc-connect already has a scheduler (`cc-connect cron`, jobs kept in its data dir and run by the running
cc-connect). `daily-summary.sh` is a minimal template on top of it: every day at 21:00 the role gets a
prompt in the given channel's session and its answer is posted there.

```sh
PROJECT=ju SESSION_KEY=discord:<channel ID> sh bridge/contrib/routine/daily-summary.sh
cc-connect cron list
cc-connect cron exec <id>     # try it now
cc-connect cron del <id>      # remove it
```

What to change:

- `CRON`: five fields, `minute hour day month weekday` (`0 9 * * 1-5` = 09:00 on weekdays).
- `PROMPT`: what the role should do each time (a summary, a reminder, checking something).
- `SESSION_KEY`: the channel. Discord: `discord:<channel ID>`; other platforms use their own session key
  (it is shown by `cc-connect sessions` / in the hook variable `CC_HOOK_SESSION_KEY`).
- To run a shell command instead of a prompt, use `cc-connect cron add ... --exec "<command>"`; its output
  is posted. Other options: `cc-connect cron add -h` (`--session-mode new_per_run`, `--timeout-mins`, `--silent`).

You can also just ask the role in the channel ("post a summary here every evening at nine"): cc-connect gives
the agent `CC_PROJECT` and `CC_SESSION_KEY`, so it can run `cc-connect cron add` for the current channel itself.

中文：cc-connect 自带定时任务（`cc-connect cron`）。上面的模板每天 21:00 让角色在指定频道的会话里执行一次提示词，
回答发到该频道。改 `CRON`（分 时 日 月 周）、`PROMPT`（每次做什么）、`SESSION_KEY`（哪个频道，Discord 是
`discord:<频道 ID>`）即可；想跑命令就用 `--exec`。也可以直接在频道里跟角色说「每天晚上九点在这里发个总结」，
角色自己会用 `cc-connect cron add` 给当前频道加上。
