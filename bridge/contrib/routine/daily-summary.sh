#!/bin/sh
# daily-summary.sh — template: a role posts something to a channel on a schedule.
# It only calls cc-connect's own cron (`cc-connect cron add`); there is no separate scheduler.
# cc-connect must be running. Edit the four values below (or pass them as environment variables), then run:
#   sh daily-summary.sh            add the job
#   cc-connect cron list           see it;  cc-connect cron exec <id>  run it now;  cc-connect cron del <id>  remove it
set -eu

PROJECT=${PROJECT:?set PROJECT: the project name of the role in config.toml (cc-connect cron list / the wizard result)}
SESSION_KEY=${SESSION_KEY:?set SESSION_KEY: where to post, e.g. discord:<channel ID> or cloud_web:<channel>}
DEFAULT_CRON="0 21 * * *"
CRON=${CRON:-$DEFAULT_CRON}   # every day at 21:00 (minute hour day month weekday, local time)
DEFAULT_PROMPT="Pick one thing from today in this channel worth remembering and summarise it in three sentences or fewer."
PROMPT=${PROMPT:-$DEFAULT_PROMPT}

exec "${CC_CONNECT:-cc-connect}" cron add --project "$PROJECT" --session-key "$SESSION_KEY" \
  --cron "$CRON" --prompt "$PROMPT" --desc "daily summary"
