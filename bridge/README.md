# bothouse bridge

The bridge bundled with bothouse connects your local AI CLIs to messaging platforms.

Download the native app from [Releases](https://github.com/zuiho-kai/bothouse/releases): macOS `.dmg` (Bothouse.app), Windows `.exe`, or the Linux executable. First launch opens the browser setup wizard. The macOS app is unsigned: right-click → Open the first time. Checksums are in `SHA256SUMS`.

For terminal installation:

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
bothouse
```

Windows uses `install.ps1` and installs `bothouse.exe`. Private-repository installation, configuration, and prerequisites are in [Getting started](../docs/GETTING_STARTED.md). New installs use `~/.bothouse`; when it does not exist, an existing legacy directory is reused without moving files.

See the [main README](../README.md), [installation guide](INSTALL.md), and [configuration example](config.example.toml). For source builds, `make build` creates `bothouse`; the Go module and internal package paths retain their historical names.

The upstream bridge's MIT notice remains in [LICENSE-MIT-upstream](LICENSE-MIT-upstream). Thanks to its original authors and contributors. See [third-party licenses](../THIRD-PARTY-LICENSES.md).
