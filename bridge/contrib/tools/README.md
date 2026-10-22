# Small tools for agents

Three command-line tools every role can use with its own shell tool. They come with cc-connect: new roles from the
setup wizard get them, and `cc-connect setup tools on --work-dir <dir> --agent <type>` adds them to an existing
role. "on" copies the scripts to `<data_dir>/tools` (default `~/.cc-connect/tools`) and writes a block between
`<!-- conest:tools -->` markers into the role's persona file saying what each tool is for and how to run it.
`off` removes the block (or one tool with `--only`); `status` shows what is on.

| tool | what it does | needs |
|---|---|---|
| `peek.py` | what each bot is doing right now: last action, how long ago, last steps (read-only) | uv |
| `watchvid.py` | turns a video link (Bilibili, YouTube, anything yt-dlp reads) into frames, transcript, bullet comments, top comments and a `watchvid-index.md` | uv, ffmpeg + ffprobe |
| `websearch.py` | free web search (DuckDuckGo/Bing/Brave via ddgs; Baidu/Sogou/360/Bilibili for Chinese) and page text | uv |

## Install what they need

- **uv** runs every tool and installs its Python packages on first use (requests, yt-dlp, trafilatura, …):
  <https://docs.astral.sh/uv/getting-started/installation/> (`curl -LsSf https://astral.sh/uv/install.sh | sh`).
- **ffmpeg** (watchvid only): macOS `brew install ffmpeg`, Debian/Ubuntu `sudo apt install ffmpeg`,
  Windows `winget install Gyan.FFmpeg`. watchvid says so and stops when it is missing.

No API key, account or cookie is required.

## Use by hand

```sh
T=~/.cc-connect/tools
uv run -q --script $T/peek.py                 # one line per bot
uv run -q --script $T/peek.py <bot> -n 20     # one bot's last 20 steps
uv run -q --script $T/watchvid.py 'https://www.youtube.com/watch?v=jNQXAC9IVRw'   # last line: index path
uv run -q --script $T/websearch.py search "query" 5
uv run -q --script $T/websearch.py fetch https://example.com
```

Each script's `--help` (or its docstring) has the details.

### peek

Reads cc-connect's `config.toml` (`--config`, else `$CC_CONNECT_CONFIG`, `./config.toml`, `~/.cc-connect/config.toml`).
Each `[[projects]]` entry is a bot, named by `team_name` or `name`; its agent type and `work_dir` say where the
session log is: Claude Code (`~/.claude/projects/…`), Codex (`~/.codex/sessions`, matched by cwd), DSH
(`$DSH_HOME/sessions`, matched by cwd; `DSH_HOME` from the project's agent env or its cmd script). Antigravity only
reports whether its conversation file changed; other agent types are listed as not supported.

### watchvid

Output goes to `--out`, else `$WATCHVID_DIR`, else `<data_dir>/media`. Transcript: the site's own subtitles or
auto-captions when it has them; for real speech-to-text set `WATCHVID_ASR_URL` to any OpenAI-compatible
`/v1/audio/transcriptions` endpoint (plus `WATCHVID_ASR_KEY`, `WATCHVID_ASR_MODEL`, default `whisper-1`).
Optional: a Bilibili `Cookie` header in `~/.config/watchvid/bilibili.cookie` for higher quality (logged out works,
about 480P); `WATCHVID_CN_PROXY` for an HTTP proxy with a mainland-China exit when Bilibili blocks your IP.

### websearch

`search "query" [n] [engine]` with engine `auto` (default), `global`, `cn`, `baidu`, `sogou`, `so360`, `zhihu`, `bili`.
Optional `WEBSEARCH_CN_PROXY` for the Chinese engines. Zhihu answers that need a login come back partial.
