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

## News digest (`newsdigest.py`, off by default)

A daily digest of free public RSS by topic. Nothing happens until you turn it on in a JSON config
(`--config`, else `$NEWSDIGEST_CONFIG`, else `<data_dir>/newsdigest.json`, else `~/.bothouse/newsdigest.json`;
no file = defaults):

```json
{"enabled": false, "topics": ["tech", "world"], "send_at": "07:00", "sources": {"games": ["https://example.com/rss"]}}
```

- `enabled`: default `false`. Off, `run` fetches and writes nothing.
- `topics`: built-in `general` 综合, `tech` 科技, `finance` 财经, `world` 国际 (`newsdigest.py topics` lists their
  feeds), or your own names with feeds under `sources`. Default: all four built-in topics.
- `send_at`: daily local time `HH:MM`; default `07:00`.

```sh
python3 bridge/contrib/routine/newsdigest.py run --dry-run          # preview the digest, even while off
python3 bridge/contrib/routine/newsdigest.py schedule -- --project <role> --session-key discord:<channel ID>          # show the cron commands
python3 bridge/contrib/routine/newsdigest.py schedule --apply -- --project <role> --session-key discord:<channel ID>  # make them so
```

`schedule --apply` reuses `bothouse cron`: when on, one daily job described `newsdigest:<ownership hash>` at `send_at` asks the role
to run the digest and share it in that chat in its own words with links; change the config and apply again to move
the time or switch it off (the job is disabled, not deleted). Pass `--bothouse '<binary>'` for a renamed binary;
`-p`/`--data-dir` after `--` pick the instance. `run` also writes `<config dir>/news/<date>.md` and `latest.md`.
The resolved config path, project and target session identify the job. Different configs or targets have independent
switches; repeat apply updates the owned job's time and prompt. Project and session must be explicit or supplied by
`CC_PROJECT`/`CC_SESSION_KEY`. Moving a config or changing a target creates a distinct job: disable the old one using
its original config and target first. Legacy jobs named just `newsdigest` have no verifiable ownership and are left
untouched; inspect and disable those by ID with `bothouse cron edit <id> enabled false` before enabling a replacement.

中文：`newsdigest.py` 按主题抓免 key 的公开 RSS 生成每日新闻摘要，**默认关闭**。在 JSON 配置里设 `enabled`
（默认 false）、`topics`（内置 综合/科技/财经/国际，或在 `sources` 里加自己的源）、`send_at`（每天几点，默认 07:00），
再跑 `schedule --apply -- --project <角色> --session-key <会话>`：开启时用 `bothouse cron` 建一条每日任务，到点让角色抓摘要、用自己的话
带链接发到该会话；改了配置再 apply 一次即可改时间或关闭（关闭只停用，不删除）。
配置绝对路径、角色、目标会话共同确定任务归属；关闭 B 不影响 A。移动配置或换目标前先关闭原任务。
旧的固定名称 `newsdigest` 任务不自动接管，应核对 ID 后手动停用，避免重复发送。
