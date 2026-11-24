'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { serviceOrigin } = require('./endpoint.cjs');
const { identityFor, escapeXml, auditPackageContents } = require('./pack.cjs');
const { releaseContact,verifyOfflineSupport,privacySupportError } = require('./support.cjs');
const { renderPrivacy } = require('../server/http.cjs');
const {entryFiles,appWithBuild,clientRelease}=require('../server/client-release.cjs');
const { sourceDetails } = require('../server/public-source.cjs');

const maxBody = 4 * 1024 * 1024;
const voiceRecorder = 'voice-recorder.js';
const voiceWorklet = 'voice-worklet.js';
const voicePlayer = 'voice-queue-player.js';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaPattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^\d+\.\d+\.\d+\.0$/u;
const commitPattern = /^[a-f0-9]{40}$/u;

async function verifyFile(root, item, label) {
  assert(item?.path && shaPattern.test(item.sha256), label + ' needs a path and SHA-256.');
  const file = path.resolve(root, item.path);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  assert(hash.digest('hex') === item.sha256, label + ' SHA-256 mismatch.');
  return file;
}

function readEntry(archive, name) {
  assert(/^[\w.-]+(?:\/[\w.-]+)*$/u.test(name) && !name.split('/').some(part => ['.', '..'].includes(part)),
    'Unexpected archive entry.');
  return execFileSync('tar.exe', ['-xOf', archive, '--', name], { windowsHide: true, maxBuffer: maxBody });
}

function verifyServiceArchive(archive, inventory, publicFiles, stage) {
  assert(inventory && typeof inventory === 'object' && !Array.isArray(inventory), 'Service source inventory needs a file map.');
  const entries = execFileSync('tar.exe', ['-tf', archive], { windowsHide: true, maxBuffer: maxBody, encoding: 'utf8' })
    .split(/\r?\n/u).filter(name => name && !name.endsWith('/'));
  const remaining = new Set(Object.keys(inventory));
  for (const name of entries) {
    assert(remaining.delete(name), 'Unlisted or duplicate entry in service ZIP: ' + name);
  }
  assert(!remaining.size, 'Service ZIP missing inventoried file: ' + remaining.values().next().value);
  for (const name of publicFiles) {
    assert(Object.hasOwn(inventory, 'social/client/' + name), 'Service source inventory missing public file: ' + name);
  }

  const assets = new Map();
  const publicPaths = new Set([...publicFiles, ...entryFiles].map(name => 'social/client/' + name));
  for (const [entry, digest] of Object.entries(inventory)) {
    assert(shaPattern.test(digest), 'Invalid SHA-256 in service source inventory: ' + entry);
    const bytes = readEntry(archive, entry);
    assert(sha256(bytes) === digest, 'Service ZIP source mismatch: ' + entry);
    if (stage) {
      const destination = path.join(stage, entry);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: 'wx' });
    }
    if (publicPaths.has(entry)) assets.set(entry.slice('social/client/'.length), bytes);
  }
  return assets;
}

async function verifyUpgrade(priorFile, nextFile) {
  assert(priorFile && nextFile, 'Supply --previous-service-handoff and --service-handoff for a service upgrade.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-store-upgrade-'));
  try {
    async function stage(file, folder) {
      const handoff = json(file);
      assert(versionPattern.test(handoff.version) && commitPattern.test(handoff.freeze),
        'Upgrade handoff needs a service version and frozen source commit.');
      const root = path.dirname(path.resolve(file));
      const archive = await verifyFile(root, handoff.service, 'Upgrade service ZIP');
      const inventory = json(await verifyFile(root, handoff.serviceFiles, 'Upgrade service inventory'));
      assert.equal(inventory.commit, handoff.freeze, 'Upgrade inventory source mismatch.');
      const directory = path.join(scratch, folder);
      verifyServiceArchive(archive, inventory.files, ['index.html', 'app.js', 'style.css'], directory);
      return { directory, origin: handoff.origin, version: handoff.version, source: handoff.freeze,
        sha256: handoff.service.sha256 };
    }
    const prior = await stage(priorFile, 'previous');
    const next = await stage(nextFile, 'candidate');
    assert(prior.origin && next.origin === prior.origin && next.version !== prior.version && next.sha256 !== prior.sha256,
      'Upgrade requires two distinct versions bound to the same origin.');
    const { verifyMixedClient } = require('./verify-mixed-service-client.cjs');
    return await verifyMixedClient(scratch, prior, next);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function checkIdentity(manifest, identity, version) {
  const tag = manifest.match(/<Identity\s+[^>]*>/u)?.[0] ?? '';
  for (const [field, value] of Object.entries({ Name: identity.name, Publisher: identity.publisher, Version: version })) {
    assert(tag.includes(' ' + field + '="' + escapeXml(value) + '"'), 'MSIX Identity/' + field + ' mismatch.');
  }
  const properties = manifest.match(/<Properties>[\s\S]*?<\/Properties>/u)?.[0] ?? '';
  for (const [field, value] of Object.entries({ DisplayName: identity.displayName, PublisherDisplayName: identity.publisherDisplayName })) {
    assert(properties.includes('<' + field + '>' + escapeXml(value) + '</' + field + '>'), 'MSIX ' + field + ' mismatch.');
  }
  assert(/<Application\s+Id="Social"(?:\s|>)/u.test(manifest), 'MSIX Application/Id mismatch.');
}

function readPublic(origin, route, tls, type, archive) {
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(origin + route), {
      ...tls, agent: false, family: tls.lookup ? 4 : undefined, rejectUnauthorized: true,
      signal: AbortSignal.timeout(archive ? 120000 : 10000), headers: { 'Accept-Encoding': 'identity' },
    }, async res => {
      try {
        assert(res.statusCode === 200, route + ' returned HTTP ' + res.statusCode + '.');
        assert(type.test(res.headers['content-type'] ?? ''), route + ' returned an unexpected Content-Type.');
        let length = 0;
        const chunks = [];
        const hash = archive && createHash('sha256');
        for await (const chunk of res) {
          length += chunk.length;
          assert(length <= (archive?.bytes ?? maxBody), route + ' exceeded the response limit.');
          if (hash) hash.update(chunk);
          else chunks.push(chunk);
        }
        if (hash) {
          assert(length === archive.bytes && hash.digest('hex') === archive.sha256,
            route + ' downloaded ZIP differs from the frozen source.');
          resolve();
        } else {
          assert(length > 0, route + ' returned an empty response.');
          resolve(Buffer.concat(chunks));
        }
      } catch (error) {
        res.destroy();
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function check(args) {
  const { values } = parseArgs({ args, options: {
    handoff: { type: 'string' }, version: { type: 'string' }, origin: { type: 'string' },
    'service-handoff': { type: 'string' },
    'previous-service-handoff': { type: 'string' },
    'upgrade-only': { type: 'boolean' },
    historical: { type: 'boolean' },
    mode: { type: 'string', default: 'store' }, identity: { type: 'string' },
    'operator-name': { type: 'string' }, support: { type: 'string' }, 'test-ca': { type: 'string' },
  } });
  const previous = values['previous-service-handoff'];
  const historical=values.historical===true;
  assert(!historical||(values.mode==='store'&&!values['upgrade-only']),
    '--historical rechecks a historical Store desktop and service pairing.');
  if (values['upgrade-only']) return {
    serviceUpgrade: await verifyUpgrade(previous, values['service-handoff']),
  };
  const { mode, version } = values;
  assert(['store', 'test'].includes(mode), 'Use store or test mode.');
  const origin = serviceOrigin(values.origin, mode);
  const identity = identityFor(mode, values.identity);
  const contact = releaseContact({mode,origin,operatorName:values['operator-name'],support:values.support});
  const destination = new URL(contact.href);
  const isEmail = destination.protocol === 'mailto:';
  const sameOriginSupport = destination.origin === origin;
  assert(values.handoff && versionPattern.test(version), 'Supply the joint handoff and expected MSIX version.');
  const tls = {};
  if (mode === 'test') {
    assert(origin.startsWith('https://arcade-store.test:') && values['test-ca'], 'Test requires the reserved HTTPS host and its temporary CA.');
    tls.ca = fs.readFileSync(values['test-ca']);
    tls.lookup = (_host, _options, callback) => callback(null, '127.0.0.1', 4);
  } else assert(!values['test-ca'], 'Store uses normal TLS trust.');

  const handoff = json(values.handoff);
  assert(handoff.version === version && handoff.origin === origin && commitPattern.test(handoff.freeze),
    'Joint handoff version, origin or source mismatch.');
  const serviceHandoffFile = values['service-handoff'] ?? values.handoff;
  const serviceHandoff = values['service-handoff'] ? json(serviceHandoffFile) : handoff;
  assert(serviceHandoff.origin === origin && versionPattern.test(serviceHandoff.version) && commitPattern.test(serviceHandoff.freeze),
    'Service handoff version, origin or source mismatch.');
  const root = path.dirname(path.resolve(values.handoff));
  const serviceRoot = path.dirname(path.resolve(serviceHandoffFile));
  const [msix, service, packageList, serviceList] = await Promise.all([
    verifyFile(root, handoff.package, 'MSIX'), verifyFile(serviceRoot, serviceHandoff.service, 'Service ZIP'),
    verifyFile(root, handoff.packageFiles, 'MSIX source inventory'),
    verifyFile(serviceRoot, serviceHandoff.serviceFiles, 'Service source inventory'),
  ]);
  const runtimeContents = auditPackageContents(msix);
  const packageFiles = json(packageList);
  const serviceFiles = json(serviceList);
  assert(packageFiles.commit === handoff.freeze && serviceFiles.commit === serviceHandoff.freeze, 'Inventories disagree on frozen source.');
  for (const name of ['store-main.cjs', 'social-host.cjs', 'social-view.cjs', 'privacy-preload.cjs']) {
    assert(shaPattern.test(packageFiles.verifiedFiles?.[name]), 'MSIX source inventory missing ' + name + '.');
  }
  for (const [name, digest] of Object.entries(packageFiles.verifiedFiles)) {
    assert(sha256(readEntry(msix, 'Social/resources/app/' + name)) === digest, 'MSIX source mismatch: ' + name);
  }
  checkIdentity(readEntry(msix, 'AppxManifest.xml').toString('utf8'), identity, version);
  const embedded = JSON.parse(readEntry(msix, 'Social/resources/app/service.json'));
  assert(embedded.origin === origin && embedded.mode === mode, 'Embedded service origin or mode mismatch.');
  const desktopPreload=readEntry(msix,'Social/resources/app/src/preload.cjs').toString('utf8');
  const offlineSupport=verifyOfflineSupport(embedded,contact,desktopPreload.includes('arcade:storeSupport'),{historical});

  const publicFiles = ['index.html', 'conduct.html', 'privacy.html', 'privacy.js', 'app.js', 'style.css'];
  const expectsPublicSource = Object.hasOwn(serviceFiles.files ?? {}, 'social/client/source.html') ||
    Object.hasOwn(serviceFiles.files ?? {}, 'social/server/public-source.cjs');
  if (expectsPublicSource) publicFiles.push('source.html');
  const assets = verifyServiceArchive(service, serviceFiles.files, publicFiles);

  // Older releases may not use either module. Match the deployed service's frozen client.
  const app = assets.get('app.js');
  const voiceFiles = [];
  const requireVoiceFile = name => {
    assert(assets.has(name), 'Frozen client requires missing service ZIP file: social/client/' + name);
    voiceFiles.push(name);
  };
  if (app.includes('./' + voicePlayer)) requireVoiceFile(voicePlayer);
  if (app.includes('./' + voiceRecorder)) requireVoiceFile(voiceRecorder);
  if (app.includes('./' + voiceWorklet) ||
      (assets.get(voiceRecorder)?.includes('./' + voiceWorklet))) requireVoiceFile(voiceWorklet);

  const serviceUpgrade = previous
    ? await verifyUpgrade(previous, serviceHandoffFile)
    : { status: 'not-run', reason: 'No previous service handoff supplied.' };

  const responses = [];
  async function verifyResponse(route, expected, type) {
    const actual = await readPublic(origin, route, tls, type);
    assert(actual.equals(Buffer.from(expected)), route + ' differs from the frozen service or expected public contact.');
    responses.push(route);
    return actual;
  }
  const html = /^text\/html(?:;|$)/iu;
  const js = /^(?:application|text)\/javascript(?:;|$)/iu;
  const jsonType = /^application\/json(?:;|$)/iu;
  await verifyResponse('/healthz', '{"ok":true}', jsonType);
  const release=assets.has('client-start.js')?clientRelease(assets):undefined;
  const home = await verifyResponse('/', release?.document??assets.get('index.html'), html);
  await verifyResponse('/conduct.html', assets.get('conduct.html'), html);
  const privacyTemplate = assets.get('privacy.html');
  assert(privacyTemplate.includes('id="privacy-contact-unconfigured"'), 'Unknown privacy template. Review this release manually.');
  const privacyPage = await verifyResponse('/privacy.html', renderPrivacy(privacyTemplate, contact), html);
  await verifyResponse('/privacy.js', assets.get('privacy.js'), js);
  await verifyResponse('/style.css', assets.get('style.css'), /^text\/css(?:;|$)/iu);
  await verifyResponse('/app.js', release?assets.get('client-start.js'):appWithBuild(app), js);
  if(release){
    await verifyResponse('/client-start.js',assets.get('client-start.js'),js);
    await verifyResponse(release.prefix+'app.js',appWithBuild(app),js);
    await verifyResponse(release.prefix+'style.css',assets.get('style.css'),/^text\/css(?:;|$)/iu);
    if(assets.has('conversation-list.js'))
      await verifyResponse(release.prefix+'conversation-list.js',assets.get('conversation-list.js'),js);
    if(assets.has('vendor/bothouse/rh-md.js'))
      await verifyResponse(release.prefix+'vendor/bothouse/rh-md.js',assets.get('vendor/bothouse/rh-md.js'),js);
  }
  for (const file of voiceFiles){
    await verifyResponse('/'+file,assets.get(file),js);
    if(release)await verifyResponse(release.prefix+file,assets.get(file),js);
  }
  await verifyResponse('/api/v1/public-privacy-contact', JSON.stringify({ url: isEmail ? null : destination.href }), jsonType);
  let publicSource;
  if (expectsPublicSource) {
    const sourceFile = await verifyFile(serviceRoot, serviceHandoff.source, 'Public source ZIP');
    const bytes = fs.statSync(sourceFile).size;
    assert(bytes > 0 && (serviceHandoff.source.bytes === undefined || serviceHandoff.source.bytes === bytes),
      'Public source ZIP size mismatch.');
    const { version, freeze: commit, source: { sha256 } } = serviceHandoff;
    const route = '/source/' + commit + '/' + sha256 + '.zip';
    const link = home.toString('utf8').match(/<a\b[^>]*\bhref="(\.\/source\.html)"[^>]*>/u)?.[1];
    assert(link, 'The signed-out home page is missing its source link.');
    const page = new URL(link, origin).pathname;
    const template = assets.get('source.html').toString('utf8');
    assert(template.includes('<!-- current-source -->'), 'Unknown public source template.');
    const expected = template.replace('<!-- current-source -->', () => sourceDetails({ version, commit, sha256, route }))
      .replace('<!-- source-page-address -->', () => escapeXml(origin + page));
    const actual = await verifyResponse(page, expected, html);
    const download = actual.toString('utf8').match(/<a\b[^>]*\bhref="(\/source\/[^"]+\.zip)"[^>]*>/u)?.[1];
    assert(download === route, 'The public source link does not match this deployed service.');
    await readPublic(origin, download, tls, /^application\/zip(?:;|$)/iu, { bytes, sha256 });
    responses.push(download);
    publicSource = { version, commit, sha256, bytes };
  }
  let support = isEmail ? 'email-link-verified-delivery-unchecked' : 'external-link-verified-destination-unchecked';
  if (sameOriginSupport) {
    const route = destination.pathname + destination.search;
    assert(!/^\/api(?:\/|$)/iu.test(destination.pathname), 'A support page cannot be an API route.');
    const body = await readPublic(origin, route, tls, /^(?:text\/html|text\/plain)(?:;|$)/iu);
    assert(body.toString('utf8').trim() && !body.equals(assets.get('index.html')),
      'Support URL returned empty content or the login page.');
    responses.push(route);
    assert(!body.equals(privacyPage) && !body.equals(privacyTemplate), privacySupportError);
    support = 'same-origin-support-page-verified';
  }
  return { mode, version, origin, source: handoff.freeze, msixSha256: handoff.package.sha256, runtimeContents,
    serviceZipSha256: serviceHandoff.service.sha256, serviceFilesVerified: Object.keys(serviceFiles.files).length,
    anonymousGet: responses, support, offlineSupport, serviceUpgrade,
    purpose:historical?'historical-service-pairing':mode==='store'?'store-submission-preflight':'packaging-test',
    storeSubmissionChecksPassed:mode==='store'&&!historical, ...(publicSource && { publicSource }) };
}

if (require.main === module) {
  check(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.upgrade ? JSON.stringify(error.upgrade, null, 2) : error.message);
    process.exitCode = 1;
  });
}
