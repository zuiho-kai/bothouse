# Windows desktop windows for the bothouse web UI

Windows has no native bothouse desktop app: the macOS release ships `Bothouse.app`, while the
Windows release ships `bothouse-windows.exe` (CLI/background service) and the web UI.
This helper opens the official web UI in Edge/Chrome **app mode** (no address bar, own taskbar
entry), which is the closest thing to a desktop window without wrapping the app.

It does **not** modify bothouse, run a service, or replace the macOS app. It is a small
contrib script; if you are on macOS use `bothouse-mac.dmg` instead.

## Requirements

- Windows 10/11
- Microsoft Edge or Google Chrome installed
- bothouse already configured and running (or start it first with `bothouse` / `bothouse daemon install`)

## Usage

Open the management panel (port/token come from your `config.toml` under `[management]`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\open-desktop.ps1 `
  -Config "$env:USERPROFILE\.bothouse\config.toml"
```

Open management panel **and** a channel page (cloud_web/hub users; `ChannelUrl` is the
`open_url` printed by `bothouse setup hub`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\open-desktop.ps1 `
  -Config "$env:USERPROFILE\.bothouse\config.toml" `
  -ChannelUrl "<open_url printed by bothouse setup hub>"
```

Options:

| Option | Meaning |
| --- | --- |
| `-Config <path>` | bothouse config (default `%USERPROFILE%\.bothouse\config.toml`); used to find the management host/port |
| `-AdminUrl <url>` | override the management URL |
| `-ChannelUrl <url>` | optional channel page (cloud_web only; other platforms have their own clients) |
| `-Browser auto\|edge\|chrome` | browser to use (default `auto`) |
| `-NoChannel` | only the management panel |
| `-ShowToken` | print the management token found in the config (copy it into the login page) |
| `-CreateShortcuts` | create Desktop shortcuts that run this script again (only when you want the URLs saved; a token in `ChannelUrl` will be stored in the shortcut) |

The management login page asks for the API token from `config.toml`:

```toml
[management]
  port = <your management port>
  token = "your-management-token"
```

## Limitations

- Requires Edge/Chrome; no tray, autostart, auto-update or native menus.
- `--app` windows share the browser profile; no separate bothouse-branded app.
- If `ChannelUrl` contains a token, do not put the shortcut in a shared location; prefer
  starting the script without `-CreateShortcuts` and pasting the URL once.
- The web UI listens on the configured management host (default `localhost`); keep it on a
  trusted machine/LAN only.

## Getting the URLs

- **Management panel**: `<management host>:<port>/` (from `[management]` in `config.toml`; the script adds `http://`).
- **Channel page**: `bothouse setup hub` prints `open_url` for cloud_web hubs; Discord/Feishu
  users have their own desktop/phone clients, so this helper is mainly for the self-hosted channel UI.
