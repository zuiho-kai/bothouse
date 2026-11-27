# tunnel-relay

bothouse 跨机连接的自托管中继（#2314 第一阶段：中继本体）。两台电脑都主动往外连中继，中继只按 hostId 转发密文，不读内容、没有账号。

```bash
npm ci && node scripts/demo.mjs            # 本机起中继 + 假宿主 + 假访问端，打印每一步，最后 OK
node --test test/*.test.mjs                # 单测
node scripts/demo.mjs https://<你的中继>   # 对已部署的中继走一遍（有准入码时设 RELAY_ADMISSION_CODE）
```

## 接口（v1）

- `GET /healthz` → `{"service":"bothouse-tunnel-relay","status":"ok"}`
- `WS /v1/host`（宿主连，不许带 Origin 头）：中继发 `{type:"challenge",challenge}` → 宿主回 `{type:"authenticate",publicKey(Ed25519 SPKI DER base64),signature(对 challenge 的签名 base64),admission?,encKey?,encKeySig?}` → 中继验签，hostId = sha256(公钥 DER)，回 `{type:"ready",hostId}`。10 秒不认证断开，20 秒心跳。
- `GET /h/<hostId>/key` → 宿主登记时交的公钥（访问端自己算 sha256 对 hostId）。
- `POST /h/<hostId>/t`（访问端发信封，≤1MB）→ 中继发宿主 `{type:"request",id,body(base64)}`；宿主回 `head{status}` / 多个 `chunk{data}` / `end`，中继原样流回；访问端断开时发宿主 `{type:"cancel",id}`。宿主不在线 503，超并发 429，超大 413。

加密信封、长码配对、DSH 接入是第二阶段（#2314 2.x），还没做。

## 部署

```bash
docker build -t bothouse-tunnel-relay .
docker run -d --name relay --restart unless-stopped -p 127.0.0.1:4321:4321 \
  -e RELAY_ADMISSION_CODE=<随机串> -e RELAY_TRUST_PROXY=1 bothouse-tunnel-relay
```

前面套 HTTPS：Caddy `reverse_proxy 127.0.0.1:4321 { flush_interval -1 }`，或 `cloudflared tunnel --url http://127.0.0.1:4321`。

环境变量：`PORT`（4321）、`RELAY_BIND`、`RELAY_ADMISSION_CODE`（设了就只收带这个码的宿主）、`RELAY_TRUST_PROXY=1`（在反代后面时按 X-Forwarded-For 限流）、`RELAY_MAX_HOSTS`、`RELAY_MAX_BODY`。

结构改自 [Kooyu](https://github.com/sh2001sh/Kooyu/blob/e33137b/services/relay/src/server.mjs)（MIT），去掉了账号网关、信箱、推送和预览。
