# Building the embedded management dashboard

The management API and the dashboard use the same HTTP server. An API-only
build can answer `/api/v1/status` while `/` returns 404: the `no_web` build tag
excludes `cmd/cc-connect/plugin_web.go` and `web/embed.go`, so no frontend
filesystem is registered.

For a source build with the dashboard:

```sh
cd bridge
make web                    # pnpm 10, Node.js, and the committed lockfile
go build -o bothouse ./cmd/cc-connect
go test ./cmd/cc-connect -run '^TestEmbeddedDashboardAssets$' -count=1
```

`make build` also builds the frontend before compiling the executable.
`PNPM=/path/to/pnpm make web` selects a particular pnpm installation. Custom
build/install wrappers must build the frontend before Go compilation and must
omit `no_web`. Rebuilding only Go embeds the previous contents of `web/dist`.
`make build-noweb` remains available for intentional API-only builds.

## Local and Tailscale access

Set an explicit listen address in the existing management configuration:

```toml
[management]
enabled = true
host = "127.0.0.1"
port = 9820
token = "replace-with-a-strong-random-secret"
```

For access from other devices on a tailnet, replace `host` with this machine's
Tailscale IP, then open `http://<tailscale-ip>:9820/` from an allowed device.
Binding to that specific address keeps the listener off public and LAN
interfaces; Tailscale must be running before the server starts. Tailnet access
controls still apply.

The static sign-in page is public. API requests accept a Bearer token (or the
existing token query parameter). An empty management token disables API
authentication; it must not be used for remote access. Normal bridge operation
with an empty `host` listens on all interfaces, while setup-only mode defaults
to loopback. Use the explicit host and a nonempty token rather than relying on
those differing defaults. Do not publish this HTTP port through a public
reverse proxy, port forward, or Tailscale Funnel.

Before deployment, check the root document and its JavaScript assets, open an
SPA route directly, and verify that `/api/v1/status` rejects a missing or wrong
token and accepts the configured one. A request from the same machine to its
Tailscale address is not evidence that another device can reach it.
