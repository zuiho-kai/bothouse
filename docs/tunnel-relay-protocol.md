# bothouse 跨机中继协议（v1）

本文档定义 bothouse 跨机中继（#2314）的 v1 线缆协议，覆盖服务端（`tunnel-relay/`）与 DSH 电脑端（`dsh/collab/tunnel-*.mjs`）。

## 1. 中继能看到什么 / 看不到什么

| 中继看得到 | 中继看不到 |
| --- | --- |
| 宿主与访问端的 IP、连接时间、流量字节数、`hostId` | 请求路径（`/collab/...`）、请求头与设备凭据（`Bearer` token）、请求与应答正文、聊天内容、配对长码 |

中继只能拒绝转发或拖慢连接，无法窃听、篡改内容，也无法伪造宿主公钥（访问端按 `hostId = sha256(publicKey)` 本地校验）。

## 2. 宿主接入（`WS /v1/host`）

宿主（被访问的电脑）主动发起出站 WebSocket 连接至 `wss://<relay>/v1/host`（**不得**携带 `Origin` 请求头）：

1. 中继发送挑战：
   ```json
   { "type": "challenge", "challenge": "bothouse-tunnel-relay-v1:<32B base64url>", "version": 1 }
   ```
2. 宿主在 10 秒内应答认证（`publicKey` 为 Ed25519 SPKI DER base64，`encKey` 为 X25519 SPKI DER base64，`encKeySig` 为 Ed25519 私钥对 `"bothouse-tunnel-enc-v1:" + encKey` 的签名 base64，`signature` 为 Ed25519 私钥对 `challenge` UTF-8 字节的签名 base64，`admission` 为选填准入码）：
   ```json
   {
     "type": "authenticate",
     "publicKey": "<base64>",
     "signature": "<base64>",
     "encKey": "<base64>",
     "encKeySig": "<base64>",
     "admission": "<optional>"
   }
   ```
3. 中继验签并计算 `hostId = hex(sha256(der(publicKey)))`（64 位小写十六进制），登记在线并返回：
   ```json
   { "type": "ready", "hostId": "<64-hex>" }
   ```
4. 心跳与关闭码：每 20 秒一次 WebSocket ping；10 秒未认证返回 `1008`；准入码错误或被封返回 `4403`；限额返回 `4429`；重复连接或满员返回 `1013`。

## 3. 取宿主公钥（`GET /h/<hostId>/key`）

返回：
```json
{ "hostId": "<64-hex>", "publicKey": "<base64>", "encKey": "<base64>", "encKeySig": "<base64>" }
```
访问端必须独立验证：
1. `hex(sha256(der(publicKey))) === hostId`；
2. `encKey` 为合法 X25519 SPKI DER；
3. `encKeySig` 在 `publicKey` 下验签通过 `"bothouse-tunnel-enc-v1:" + encKey`；
4. 已配对连接若检测到公钥与本地固定值不一致，拒绝连接并提示重新配对。

## 4. 加密信封与请求转发（`POST /h/<hostId>/t`）

### 4.1 请求信封

每个请求使用一把全新的临时 X25519 密钥对与 12 字节随机 `nonce`：
- `aad = UTF8("bothouse-tunnel-v1:" + ephemeral + ":" + nonce + ":" + expires)`
- `shared = X25519(ephemeralPriv, hostEncPub)`
- `material = HKDF-SHA256(ikm=shared, salt=nonce, info=aad, len=64)`
  - `reqKey = material[0..32]`（加密请求）
  - `replyKey = material[32..64]`（加密应答流）
- 明文 JSON：`{ method, path, headers, body?(base64) }`，其中 `path` 必须是 `/collab` 或 `/collab/*`。
- 外层 JSON：`{ v: 1, ephemeral, nonce, expires, ciphertext }`，其中 `ciphertext = base64(AES-256-GCM(reqKey, nonce, aad, plaintext) || tag16)`。
- 宿主校验 `expires >= now && expires <= now + 120000`，并用 `sha256(aad)` 去重防重放。

### 4.2 中继帧

- 中继 → 宿主：`{ "type": "request", "id": "<uuid>", "body": "<base64 of POST body>" }`；访问端中途断开时发 `{ "type": "cancel", "id": "<uuid>" }`。
- 宿主 → 中继：`{ "type": "head", "id", "status": 200 }` → 若干 `{ "type": "chunk", "id", "data": "<base64>" }` → `{ "type": "end", "id" }`（出错发 `{ "type": "error", "id" }`）。

### 4.3 流式应答加密分块

外层 `status = 200` 的响应流由连续二进制记录组成，按块加密以支持 SSE 事件流与防截断：
- 每条记录格式：`[1B type][4B uint32BE len(ct+tag)][ct][16B GCM tag]`
  - `type = 1`（HEAD，必须为 seq 0）：明文 JSON `{ status, headers }`
  - `type = 2`（DATA）：原始响应字节分片（单片不超过 48 KiB）
  - `type = 3`（END）：空载荷，显式结束标记；流在收到 `type = 3` 之前关闭视为被截断并报错
- 每条记录使用独立 IV：`0x00000000 || uint64BE(seq)`（`seq` 从 0 递增），AAD 为 `aad || header(5B)`，密钥为 `replyKey`。

## 5. 连接串与错误码

- 连接串格式：`bhrelay1:<base64url(JSON({ r: relayOrigin, h: hostId, c: longCode128b, e: expiresAtMs, n?: hostName }))>`。
- 128 位长码 5 分钟有效、错 5 次作废、用一次即废，且与 Tailscale 6 位码隔离。
- 常见错误码：宿主不在线 `503 HOST_OFFLINE`、超限/忙 `429 RELAY_BUSY` / `RATE_LIMITED`、请求体超 1 MB `413 TOO_LARGE`、响应超时 `504 RELAY_TIMEOUT`、信封过期/重放 `409 ENVELOPE_EXPIRED` / `ENVELOPE_REPLAY`、信封校验失败 `401 ENVELOPE_INVALID`、路径非法 `400 INVALID_PATH`。

## 6. 测试向量

确定性测试向量位于 `tunnel-relay/test/vectors.json`，由 `dsh/collab/tunnel-identity.test.mjs` 与 `dsh/collab/tunnel-crypto.test.mjs` 自动校验。
