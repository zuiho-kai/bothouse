# Optional resumable transfer service

This is an independent, original HTTPS service. It does not modify NapCat,
read QQ/AI credentials, execute files or start a shell. The desktop's existing
NapCat transfers remain available. Deploy it only on a host you administer;
there is no automatic remote installation or service registration.

It supports resumable single-file uploads with tus 1.0, immutable single-file,
directory and batch ZIP download snapshots, and explicit no-overwrite upload
publication. A directory ZIP includes observed empty directories and original
file bytes; it is not an atomic tree snapshot or an ACL/metadata backup.

## Install and run

The tested service runtime is **Node 24.18.0 on Windows/NTFS**. Windows uses an
OS-held named pipe for single-process ownership; Linux uses an abstract Unix
socket, whose platform execution remains unverified by the Windows evidence.
Other platforms are rejected. Only one process may use a state directory.

From this repository, install the separate locked dependencies:

```powershell
cd deploy/transfer-helper
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
```

Use [config.example.json](config.example.json) as a template in a private
directory outside the repository. All paths must be absolute. Replace the
example instance UUID with a new persistent UUID and generate a separate token
using at least 32 cryptographically random bytes encoded as base64url. The
token file contains only that token (43..256 base64url characters); never use
a NapCat, QQ, AI, account or existing website credential. Keep the token and
TLS private key readable only by the service account/administrator.

Provision a valid server certificate/key for the intended HTTPS hostname.
The client verifies the certificate and hostname, optionally a private CA and
SPKI pin. There is no HTTP or insecure-TLS mode. The service itself accepts
only its separate bearer token plus configured instance UUID. No browser
Origin or cookie authentication is accepted.

Explicitly create the state directory, exported roots and each writable
root's private staging directory. The service will not create these roots.
Every staging directory must be on the same filesystem as its target root,
outside all exported roots, and separate from the state directory. The state
database may be on a different volume. Multiple writable roots may therefore
reside on different volumes, each with its own staging directory. Do not
export the state, staging, credential or TLS-key directories.

Restrict the service account's filesystem permissions to the selected roots
and private directories. Symlinks/junctions and non-ordinary files are refused;
parent/file identities are rechecked. This does not sandbox a malicious local
administrator, hardlink aliases or an external process with write access to
these directories. Avoid concurrent external edits during snapshot creation
or publication. Changing a root/staging identity invalidates retained jobs.

```powershell
# From deploy/transfer-helper; substitute your private configuration path.
npm start -- D:\ArcadeTransferPrivate\config.json
```

The example listens on loopback intentionally. For a remote deployment,
explicitly bind the desired interface and configure the host firewall. TLS is
terminated by this service; forwarded headers do not override authority.
Use your normal service supervisor to run this exact command under the
restricted account. The CLI prints only fixed readiness/failure information.
Ctrl+C/SIGTERM closes owned sockets and files; it does not discard jobs.

The repository source and this deployment package must keep their relative
layout. Do not copy only this folder without `src/transfer-helper`. No service
dependencies are installed in the Electron package.

## Progress, recovery and cleanup

- Uploads are limited to 64 MiB per file, download snapshots to 128 MiB,
  chunks to 4 MiB, and private retained data/reservations to 512 MiB total.
  At most 64 active jobs and 1,024 total records are retained. Directory/batch
  snapshots have 20 selections, 4,096 entries and 32 levels maximum.
- Every acknowledged upload offset follows a data fsync and SQLite FULL
  transaction containing the contiguous prefix hash. Restart verifies the
  exact owned file and prefix before truncating an uncommitted private tail.
  An interrupted PATCH can retain a partial chunk; query HEAD after it has
  settled. Do not poll HEAD concurrently with PATCH.
- Length completion means uploaded, not published. Finalization verifies the
  whole SHA-256, records intent, and uses an exclusive hardlink into the chosen
  directory. It never overwrites a target. A normal desktop confirmation may
  transfer and finalize in sequence without another prompt.
  Publication keeps the staging file's service-account permissions/ACLs;
  it does not inherit a different consumer's permissions or restore source
  metadata. Configure the service/staging ACLs for intended consumers.
- If creation or publication loses its response, query the original
  clientJobId. Do not create another job or repeat finalization automatically.
  A restart may prove publication by the exact original inode and hash. A
  missing/replaced target after a publication intent remains unknown; querying
  never repeats the link operation or changes an exported file.
- Download snapshots are fixed private byte representations with full
  SHA-256 and strong ETag. GET/HEAD support exact single byte ranges. Resume
  requires the same snapshot and If-Range; mismatch returns 412 rather than a
  full-body fallback. Local save is a separate client verification step.
- Pause/Close retains the job. Explicit discard only removes verified
  unpublished private staging, never the user's source or a published target.
  Access expires after 24 hours. Startup/new-job/minute sweeps remove normal
  expired owned objects and keep queryable tombstones for seven more days.
  No timer resumes transfers or publishes files.
- A cleanup failure or uncertain ownership/publication is retained, consumes
  quota and is reported. These cases are not automatically removed at TTL.
  Stop the service and investigate/back up its private state before operator
  repair; do not edit the SQLite journal to manufacture completion or delete
  an unknown object. This first version has no automatic destructive repair.
  Refusing new jobs when the quota is full is intentional.

## Verification boundary

```powershell
npm test
```

The focused tests use the production HTTPS service, pinned tus protocol engine,
temporary NTFS files, public synthetic TLS material and actual child process
exits/reopens. They cover lost responses, write/fsync/offset crash boundaries,
publication before/after-link recovery, two competing processes, Range restart,
raw binary and ZIP/empty-directory bytes, no overwrite, cross-volume state and
per-root staging, authentication, quotas, expiry and cleanup ownership.
No real account, remote deployment, credential or user file is used. These are
process-crash tests, not a power-failure or storage-hardware guarantee.

## Dependencies and cost

`@tus/server` 2.4.7 and `@tus/utils` 0.7.3 provide the tus wire protocol.
Their default FileStore is deliberately not used: its ordinary offset/stat
and file writes do not supply this service's durable finalization contract.
`yazl` 3.3.1 writes immutable ZIPs; no archive contents are executed. SQLite is
Node's builtin module. All direct versions and transitive integrity values
are locked in this folder. See [dependency notices](THIRD_PARTY_NOTICES.md).

Deployment needs a managed Node process, HTTPS identity, separate secret,
restricted disk roots and private storage. Snapshot creation reads/copies the
source once and uses disk/quota; resume then transfers only the requested
remaining bytes. No measured throughput or bandwidth saving is claimed for
an actual remote host.
