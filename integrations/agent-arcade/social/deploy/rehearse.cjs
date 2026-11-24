'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const crypto = require('node:crypto');
const {once} = require('node:events');
const {fork, spawn, execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {makeBackup} = require('./backup.cjs');

const [caddyArgument, opensslArgument, outputArgument, ...extra] = process.argv.slice(2);
const social = path.resolve(__dirname, '..');
const children = new Set();

function inputHashes() {
  const entries = ['CONTRACT.md', 'package.json', 'client', 'server', 'deploy', 'assets/stickers'].flatMap(name => {
    const target = path.join(social, name);
    if (fs.statSync(target).isFile()) return [target];
    return fs.readdirSync(target, {recursive: true, withFileTypes: true})
      .filter(entry => entry.isFile())
      .map(entry => path.join(entry.parentPath, entry.name));
  });
  for(const source of ['core/static-image.cjs','core/sticker-reply.cjs','bot/companion-reply-preference.cjs','bot/followup-time.cjs',
    'bot/group-media-request.cjs','bot/group-spoken-dialogue.cjs','bot/qq-public-lookup.cjs','core/cloudflare-image-request.cjs','core/group-drawing-portrait.cjs',
    'bot/group-drawing-request.cjs','bot/social-flow.cjs','ui/chat-drawing-request.js'])entries.push(path.join(social,'../src',source));
  return Object.fromEntries(entries.sort().map(file => [path.relative(social, file).split(path.sep).join('/'),
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}

function track(child) {
  const closed = once(child, 'close').catch(() => {});
  child.closedForRehearsal = closed;
  children.add(child);
  closed.then(() => children.delete(child));
  return child;
}

async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await child.closedForRehearsal;
}

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(filename, port, origin) {
  const child = track(fork(path.join(social, 'server', 'main.cjs'), {
    env: {...process.env, SOCIAL_DB: filename, SOCIAL_HOST: '127.0.0.1',
      SOCIAL_PORT: String(port), SOCIAL_PUBLIC_ORIGIN: origin, SOCIAL_DEEPSEEK_KEY:'', SOCIAL_OPENAI_KEY:'', SOCIAL_ANTHROPIC_KEY:''},
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true
  }));
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    child.closedForRehearsal.then(() => { throw new Error('Social server exited before listening'); }),
    delay(8000, undefined, {ref: false}).then(() => { throw new Error('Social server readiness timed out'); })
  ]);
  assert.equal(ready.port, port);
  return child;
}

function makeClient(origin, certificate, trust = true) {
  const agent = new https.Agent({ca: trust ? certificate : undefined, keepAlive: false});
  let cookie;
  let cookieAttributes = [];
  const call = (pathname, payload, headers = {}) => new Promise((resolve, reject) => {
    const request = https.request(new URL(pathname, origin), {
      method: payload === undefined ? 'GET' : 'POST', agent, family: 4, servername: 'localhost',
      headers: {
        ...(cookie && {cookie}),
        ...(payload !== undefined && {'Content-Type': 'application/json', Origin: origin}),
        ...headers
      }
    }, response => {
      const parts = [];
      response.on('data', chunk => parts.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const setCookie = response.headers['set-cookie']?.[0];
        if (setCookie) [cookie, ...cookieAttributes] = setCookie.split(/;\s*/);
        const raw = Buffer.concat(parts).toString('utf8');
        try {
          const data = response.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : raw;
          resolve({status: response.statusCode, data});
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(2500, () => request.destroy(new Error('HTTPS request timed out')));
    request.on('error', reject);
    request.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
  return {call, cookieAttributes: () => cookieAttributes};
}

async function ready(client, proxy) {
  for (let index = 0; index < 40; index++) {
    if (proxy.exitCode !== null) throw new Error('Caddy exited before serving HTTPS');
    try {
      const result = await client.call('/healthz');
      if (result.status === 200) {
        assert.deepEqual(result.data, {ok: true});
        return;
      }
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
    }
    await delay(150);
  }
  throw new Error('HTTPS readiness timed out');
}

async function main() {
  if (!caddyArgument || !opensslArgument || !outputArgument || extra.length) {
    throw new Error('Usage: node rehearse.cjs CADDY_EXECUTABLE OPENSSL_EXECUTABLE NEW_OUTPUT_DIRECTORY');
  }
  const caddy = fs.realpathSync(caddyArgument);
  const openssl = fs.realpathSync(opensslArgument);
  const output = path.resolve(outputArgument);
  fs.mkdirSync(output, {mode: 0o700});
  const inputs = inputHashes();
  const run = (exe, args) => execFileSync(exe, args, {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const version = run(caddy, ['version']).trim();
  // Adapt only: this never binds the example host or requests a public certificate.
  const production = JSON.parse(run(caddy, ['adapt', '--config', path.join(__dirname, 'Caddyfile'), '--adapter', 'caddyfile']));
  const proxyConfig = JSON.stringify(production);
  assert(proxyConfig.includes('"dial":"127.0.0.1:8787"'));
  assert(proxyConfig.includes('http.request.remote.host'));

  let upstream = await freePort();
  const port = await freePort();
  while (upstream === port) upstream = await freePort();
  const origin = 'https://localhost:' + port;
  const certificateFile = path.join(output, 'loopback.crt');
  const key = path.join(output, 'loopback.key');
  const opensslConfig = path.join(output, 'openssl.cnf');
  fs.writeFileSync(opensslConfig, '[req]\ndistinguished_name=dn\n[dn]\n');
  run(openssl, ['req', '-config', opensslConfig, '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost', '-out', certificateFile, '-keyout', key]);
  const certificate = fs.readFileSync(certificateFile);
  const quote = value => JSON.stringify(value.replaceAll('\\', '/'));
  const config = path.join(output, 'Caddyfile');
  fs.writeFileSync(config, [
    '{', '  admin off', '  auto_https disable_redirects', '  persist_config off', '}',
    'import ' + quote(path.join(__dirname, 'social-proxy.caddy')),
    origin + ' {', '  bind 127.0.0.1', '  tls ' + quote(certificateFile) + ' ' + quote(key),
    '  import arcade_social_proxy 127.0.0.1:' + upstream, '}', ''
  ].join('\n'));
  const filename = path.join(output, 'live', 'social.sqlite');
  let server = await startServer(filename, upstream, origin);
  const originalPid = server.pid;
  const proxy = track(spawn(caddy, ['run', '--config', config, '--adapter', 'caddyfile'], {
    env: {...process.env, XDG_DATA_HOME: path.join(output, 'caddy-data'), XDG_CONFIG_HOME: path.join(output, 'caddy-config')},
    windowsHide: true, stdio: ['ignore', 'ignore', 'inherit']
  }));
  const first = makeClient(origin, certificate);
  const second = makeClient(origin, certificate);
  await ready(first, proxy);
  await assert.rejects(makeClient(origin, certificate, false).call('/healthz'), /certificate/i);
  assert.equal((await first.call('/')).status, 200);
  assert.equal((await first.call('/app.js')).status, 200);
  assert.equal((await first.call('/api/v1/me')).status, 401);
  const wrongHost = await first.call('/healthz', undefined, {Host: 'wrong.invalid'});
  assert(wrongHost.status >= 400 || wrongHost.data === '');
  assert.equal((await first.call('/api/v1/register', {}, {Origin: 'https://wrong.invalid'})).status, 403);
  const password = crypto.randomBytes(20).toString('hex');
  const accountA = 'deploy_alpha';
  const accountB = 'deploy_beta';
  for (const [client, number] of [[first, accountA], [second, accountB]]) {
    const registered = await client.call('/api/v1/register', {number, displayName: number, password});
    assert([200, 201].includes(registered.status));
    assert.equal(registered.data.user.number, number);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert(client.cookieAttributes().includes(attr));
  }
  const sentRequest = await first.call('/api/v1/friend-requests', {number: accountB});
  assert([200, 201].includes(sentRequest.status));
  const id = sentRequest.data.request.id;
  const accepted = await second.call('/api/v1/friend-requests/' + id + '/accept', {});
  assert([200, 201].includes(accepted.status));
  const conversationId = accepted.data.conversation.id;
  const messages = '/api/v1/conversations/' + conversationId + '/messages';
  const firstMessage = {clientId: 'rehearsal-first', text: 'Synthetic message before the restart'};
  const sent = await first.call(messages, firstMessage);
  assert([200, 201].includes(sent.status));
  assert.equal((await second.call(messages)).data.messages[0].text, firstMessage.text);
  const snapshotDir = path.join(output, 'snapshot');
  const snapshot = await makeBackup(filename, snapshotDir);
  assert((await fs.promises.stat(snapshot)).size > 0);
  assert.deepEqual(fs.readdirSync(snapshotDir), ['social.sqlite']);
  await assert.rejects(makeBackup(filename, snapshotDir), {code: 'EEXIST'});

  // Restart the actual server without restarting the proxy. The Windows child
  // termination also exercises recovery of the WAL-backed state.
  await stop(server);
  server = await startServer(filename, upstream, origin);
  const restartedPid = server.pid;
  assert.notEqual(originalPid, restartedPid);
  await ready(second, proxy);
  assert.equal((await second.call('/api/v1/me')).data.user.number, accountB);
  assert.equal((await second.call('/api/v1/friends')).data.friends[0].number, accountA);
  assert.equal((await second.call(messages)).data.messages[0].id, sent.data.message.id);
  const retry = await first.call(messages, firstMessage);
  assert.equal(retry.data.message.id, sent.data.message.id);
  assert.equal((await first.call(messages)).data.messages.length, 1);
  await stop(server);

  // Restore the verified snapshot to a different database, leaving the live
  // test directory untouched.
  const restoredDirectory = path.join(output, 'restored');
  fs.mkdirSync(restoredDirectory, {mode: 0o700});
  const restoredFile = path.join(restoredDirectory, 'social.sqlite');
  fs.copyFileSync(snapshot, restoredFile, fs.constants.COPYFILE_EXCL);
  const restored = await startServer(restoredFile, upstream, origin);
  await ready(second, proxy);
  const clean = makeClient(origin, certificate);
  const loggedIn = await clean.call('/api/v1/login', {number: accountB, password});
  assert.equal(loggedIn.data.user.number, accountB);
  assert.equal((await clean.call(messages)).data.messages[0].id, sent.data.message.id);
  assert.equal((await clean.call('/api/v1/friends')).data.friends[0].number, accountA);
  await stop(restored);
  await stop(proxy);
  assert.equal(children.size, 0);

  assert.deepEqual(inputHashes(), inputs, 'Deployment inputs changed during the rehearsal');
  fs.writeFileSync(path.join(output, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n', {flag: 'wx'});
  const evidence = {
    passed: true, node: process.version, caddy: version, scope: 'loopback HTTPS only',
    productionCaddyfileAdapted: true, certificateVerified: true, invalidOriginRejected: true, wrongHostDidNotReachService: true,
    staticClientServed: true, independentClientSessions: 2, secureCookies: true,
    persistedSessionFriendshipAndMessage: true, duplicateAfterRestartReturnedOriginalId: true,
    hotBackupCheckedAndRestoredOnSeparatePath: true, standaloneBackupFile: true, backupRefusedOverwrite: true,
    cleanLoginOnRestoredDatabase: true, originalPid, restartedPid,
    publicNetworkVerified: false, opensslTrustScope: 'request-scoped local test certificate'
  };
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(evidence));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => { await Promise.all([...children].reverse().map(stop)); });
