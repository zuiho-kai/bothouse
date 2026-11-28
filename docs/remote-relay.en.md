# Connect Two Computers via a Relay (Without Tailscale)

When two computers are on different networks and cannot share a Tailscale tailnet, they can still pair and open each other's DSH channels, team desk, and bothouse panel through a self-hosted or community relay server. Neither computer needs a public IP or open firewall ports, and all traffic is end-to-end encrypted between the two DSH instances.

## Tailscale vs. Relay

- **Use Tailscale** if both machines already share a tailnet: direct connection, 6-digit pairing code, no 1 MB request body limit, and direct mobile browser pairing.
- **Use a Relay** if one computer cannot install Tailscale (e.g., office to home): expand **"Not on the same network? Use a relay"** at the bottom of the **Other computers** page.

## Setup in Three Steps

1. **Get a relay address**
   - Self-host `tunnel-relay/` on any VPS or home machine behind HTTPS / Cloudflare Tunnel (see `tunnel-relay/README.md`).
   - Or use an `https://` relay URL (and optional admission code) shared by a friend or community operator.
2. **Host machine: connect and generate a connection string**
   - Open **Other computers** in DSH and expand **Not on the same network? Use a relay**.
   - Enter the relay URL (and admission code if required), then click **Save & connect** until the status shows **Connected**.
   - Click **Generate connection string** to display a one-time string, QR code, and 5-minute countdown.
3. **Controller machine: paste and confirm**
   - Open the same section on the other computer and paste the `bhrelay1:...` string.
   - Verify the relay address and the host's fingerprint shown in the confirmation box, choose **Temporary** or **Remember**, and click **Confirm & connect**.
   - The connection appears in your connected list tagged **Relay** (distinct from **Tailscale**). The host can revoke access at any time, immediately closing active event streams.

> Note: Single forwarded request bodies are capped at **1 MB** by the default relay limit.

## What the Relay Can and Cannot See

| Visible to the relay | Hidden from the relay (E2E encrypted) |
| --- | --- |
| Client/host IP addresses, timestamps, byte counts, and host fingerprint (`hostId`) | Paths (`/collab/...`), headers, device credentials, pairing long code, messages, and response content |

Every request uses a fresh ephemeral X25519 key + HKDF-SHA256 + AES-256-GCM with per-chunk authenticated streaming, and both computers exchange and pin each other's Ed25519 public keys during pairing. The controller verifies `sha256(publicKey) === hostId` so a relay cannot impersonate the host, and the host verifies the caller's Ed25519 signature against its paired-device whitelist before decrypting — dropping unpaired requests at the door even if `hostId` leaks. One-time 128-bit pairing codes expire after 5 minutes and lock after 5 failed attempts.

## Troubleshooting

- **Admission code required / wrong**: Verify the operator's admission code and save again.
- **Cannot reach relay server**: Verify the `https://` URL, network connectivity, and that the relay service/tunnel is running.
- **Remote computer offline**: The relay is reachable, but the host computer is off, DSH is closed, or its relay connection is down.
- **Disconnected / revoked**: The host kicked this device or a temporary link expired; generate a fresh connection string.
- **Remote identity changed**: The host reset its identity keys or the relay returned mismatched keys; confirm with the host owner and re-pair.
