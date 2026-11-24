# Fixed macOS credential helper

`credential-helper.swift` is a separately installed, user-owned executable. It
reads one existing generic-password item and implements Electron 45.2.1's macOS
`v10` encryption format. It never adds, changes or deletes a Keychain item, changes
an ACL, listens on a socket, starts a command, or exports the Keychain password.
Keep this executable's bytes and signature unchanged across normal App updates.
A required helper security update is a separate, explicit installation event.

## Compile-time configuration

Generate `BrokerConfiguration.swift` in a private build directory, outside the
repository and application data. Production must use these exact values; the
helper rejects any other production service/account, nonempty Keychain path, or
requirement shape before Keychain access. Replace the synthetic 40-hex pin below
with the exact verified local signing-profile certificate pin at compile time:

```swift
enum BrokerConfiguration {
    static let peerRequirement = "identifier \"io.github.agentarcade.desktop\" and certificate root = H\"0123456789abcdef0123456789abcdef01234567\""
    static let service = "agent-arcade Safe Storage"
    static let account = "agent-arcade Key"
    static let keychainPath = ""
    static let testing = false
}
```

An empty production `keychainPath` means the current UID's
`Library/Keychains/login.keychain-db`, resolved using `getpwuid`, not the caller's
`HOME`. `SecItemCopyMatching` is restricted to that opened Keychain, the exact
service/account and generic-password class; zero or multiple matches fail.
Runtime arguments, environment, and request fields cannot replace these values.
Production accepts only the full requirement
`identifier "io.github.agentarcade.desktop" and certificate root = H"<40 hex>"`.
The setup flow must generate that value from the verified local signing profile,
and require agreement with the signed App metadata and helper signing identity;
the public source does not embed one owner's signing certificate.
Electron [45.2.1 source, lines 654–656](https://github.com/electron/electron/blob/v45.2.1/shell/browser/electron_browser_main_parts.cc#L654)
sets the base service/account names. Its [MAS-compatibility patch](https://github.com/electron/electron/blob/v45.2.1/patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch)
then appends `" Key"` for this non-MAS App. The exact existing item is service
`agent-arcade Safe Storage`, account `agent-arcade Key`; both were confirmed by
read-only local metadata. The helper reads that existing item without copying,
deleting or migrating it. The App preserves its historic name before readiness.

From a trusted build environment (example arm64; set the intended architecture
explicitly):

```sh
xcrun swiftc -parse-as-library -O -whole-module-optimization \
  -target arm64-apple-macos12.0 \
  -module-cache-path /absolute/private-build/module-cache \
  src/mac/credential-helper.swift /absolute/private-build/BrokerConfiguration.swift \
  -o /absolute/private-build/credential-helper
```

Sign that output once with the pinned local identity and `--options runtime,kill`,
without debug/get-task-allow or runtime exception entitlements, using the parent
installer's protected signing flow. Do not use `BROKER_NATIVE_UNIT` for production.
Strictly verify signature/requirement, expected architecture and digest before
installing. An App must authenticate the **running** helper before writing any
plaintext to its stdin, rather than checking a path and then trusting a later
spawn. The helper verifies its caller; this does not replace the reverse check.

## Protocol and caller boundary

Only `[]` and `["--authorize"]` are accepted as helper arguments. Unknown flags,
including `--self-test`, fail. There is no CLI encryption/decryption bypass.
All normal operations require a verified live parent, same real/effective UID,
stable kernel PID/start time, pinned code requirement, valid dynamic signature,
strict static sealed-bundle validation, Hardened Runtime and kill flags, and no
debugged/get-task-allow status. Inspector and remote-debugging arguments fail.
The production App must also disable RunAsNode, NODE_OPTIONS and inspector fuses,
enforce ASAR integrity/ASAR-only loading, and reject remote debugging at bootstrap.
Code identity is not a sandbox against arbitrary same-user process compromise.

After initial verification, stdout receives exactly one newline-delimited ready
frame, `{ "version": 1, "status": "ready", "pid": <actual getpid()> }`. Then
the helper reads at most 512 KiB from stdin until EOF and accepts one exact JSON
request:

```json
{"version":1,"operation":"status"}
{"version":1,"operation":"encrypt","text":"synthetic example"}
{"version":1,"operation":"decrypt","data":"<canonical base64>"}
```

Success is `status:"ok"` with respectively `available:true`, base64 `data`, or
`text`. Failure is `status:"error"` with only one of `unauthorized`,
`invalid_request`, `keychain_unavailable`, `key_not_found`, `crypto_failed`, or
`internal_error`. Errors never include raw OS errors, paths, plaintext or input.
The process exits after one result. SIGALRM terminates it after 8 seconds (normal)
or 120 seconds (authorization), including stdin wait and OS interaction; the JS
bridge maps a deadline termination to `timeout`. Parent death is checked every
100 ms; parent identity and code are rechecked around secret access and output.

Normal mode sets `SecKeychainSetUserInteractionAllowed(false)` before its first
Keychain API. `--authorize` sets it true, accepts **only status**, and also requires
the verified parent argv to contain `--arcade-credential-authorize-worker`.
It makes a single read of the existing item, never retries or creates a key.
First authorization can still require the owner; locked/deleted items, revoked
permissions and helper replacement remain failure/authorization boundaries.

The derived AES key and original password are not returned. Temporary mutable
buffers are wiped on ordinary returns, on a best-effort basis: Swift/Foundation
strings and copies, crash state and OS process memory are not guaranteed zeroized.
Plaintext crosses the authenticated App/helper pipe because the App needs API
credentials. There is no plaintext persistence in the helper.

## Isolated verification

Run `node scripts/mac-credential-helper-native-unit.cjs` on macOS. It compiles a
separate `BROKER_NATIVE_UNIT` executable, executes only synthetic PBKDF2/AES known
answers and protocol checks, compiles the normal main, and verifies that its
unsupported `--self-test` flag fails before caller/Keychain access. It creates no
Keychain and opens no existing Keychain. The synthetic vector was independently
checked with Python `hashlib.pbkdf2_hmac` and `/usr/bin/openssl enc -aes-128-cbc`.

Keychain integration tests require a separate helper compiled with `testing:true`:
both service/account must start `agent-arcade.test.`, and `keychainPath` must be an
absolute dedicated `.keychain-db`, never `login.keychain-db`. The test parent must
still be signed and match the test requirement; only runtime/kill requirements
are relaxed. Do not ship or install that executable. No production-item test is
part of the native unit script.

Production acceptance still needs distinct App builds with the same installed
helper, cold restarts, denied/cancelled access, wrong-signature and PID/parent-exit
cases, malformed/oversize requests, exact vault/chat retention, and confirmation
that Electron internals do not independently query Safe Storage. A passing
synthetic test is not real-profile or prompt-free-update acceptance.
