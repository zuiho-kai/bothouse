'use strict';

// Fixed-version Shell code restoration. Account data, installation descriptors,
// selections and prepared metadata are never rewritten. No process is started
// or stopped. Every mutable path is derived from the fixed component store.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const F = require('./qq-node-repair-fs.cjs');
const M = require('./qq-managed-shell-repair-metadata.cjs');
const { validTree, sameTree } = require('./qq-managed-node-code-repair.cjs');
const { withShellCodeGate } = require('./qq-shell-code-gate.cjs');
const { QQNodeRepairStage } = require('./qq-node-repair-stage.cjs');
const { QQComponentPackages } = require('./qq-component-package.cjs');

const MAX_RECORD = 32 * 1024 * 1024;
const CODES = new Set([
  'invalid_request', 'invalid_response', 'changed', 'cancelled', 'preview_required',
  'preview_expired', 'unsafe_path', 'manifest_invalid', 'managed_installation_changed',
  'artifact_changed', 'artifact_conflict', 'archive_invalid', 'archive_unsafe',
  'archive_limit', 'package_not_staged', 'digest_mismatch', 'size_mismatch',
  'runtime_running', 'runtime_locked', 'process_check_failed', 'operation_in_progress',
  'component_locked', 'desktop_running', 'shell_repair_unavailable',
  'shell_repair_not_needed', 'shell_repair_scope_unverified',
  'shell_repair_source_unavailable', 'shell_repair_changed', 'shell_repair_busy',
  'shell_repair_history_full', 'shell_repair_failed', 'shell_repair_readback_failed',
  'shell_repair_unconfirmed', 'shell_repair_recovery_required',
  'shell_repair_cleanup_unconfirmed',
]);
function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code.replace(/^node_repair_/, 'shell_repair_') : '';
  return CODES.has(code) ? code : 'shell_repair_failed';
}
function fail(code = 'shell_repair_changed') {
  throw Object.assign(new Error(`Managed Shell recovery failed (${code}).`), { code });
}
const proof = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'bytes'));
const absent = () => ({ present: false });
function matchesManifest(tree, manifest) {
  if (!tree.present) return false;
  const files = tree.rows.filter(row => row.kind === 'file');
  const dirs = tree.rows.filter(row => row.kind === 'directory' && row.path).map(row => row.path).sort();
  return files.length === manifest.files.length && F.equal(dirs, [...manifest.directories].sort()) &&
    manifest.files.every(expected => files.some(row => row.path === expected.path &&
      row.size === expected.size && row.sha256 === expected.sha256));
}

class QQManagedShellCodeRepair {
  constructor({ root, setupId, lockRoot, processHost, packages, io = fs,
    now = Date.now, monotonic = () => performance.now(),
    metadataReader = M.readManagedShellRepairMetadata,
    stageFactory = options => new QQNodeRepairStage({ ...options, component: 'napcat-shell' }),
  } = {}) {
    if (!F.UUID.test(setupId) || typeof processHost?.snapshot !== 'function' ||
        typeof now !== 'function' || typeof monotonic !== 'function' ||
        typeof metadataReader !== 'function' || typeof stageFactory !== 'function') fail('invalid_request');
    this.root = F.local(root);
    this.p = M.paths(this.root);
    this.setupId = setupId;
    this.lockRoot = F.local(lockRoot || path.join(path.dirname(this.root), 'qq-runtime-locks'));
    Object.assign(this, { host: processHost, io, now, monotonic, metadataReader, stageFactory });
    this.packages = packages || new QQComponentPackages({ root: this.root, component: 'napcat-shell' });
    this.active = null;
    this.observation = null;
    this.draft = null;
    this.stages = new Map();
    this.closing = false;
    this.closed = false;
  }

  _check(options = {}) {
    F.current(options);
    options.gate?.();
    if (this.closing || this.closed) fail('changed');
  }

  _task(options, operation) {
    if (this.active || this.closing || this.closed) return Promise.reject(Object.assign(
      new Error('Managed Shell recovery is busy.'), { code: 'shell_repair_busy' }));
    const controller = new AbortController(), abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const task = { controller, promise: null };
    this.active = task;
    // Cancellation stops operational checks. Keep the ownership gate itself
    // usable to record an already owned, incomplete stage as abandoned, exactly
    // as the Node repair does; it is not permission to publish cancelled code.
    task.promise = Promise.resolve().then(() => withShellCodeGate({ root: this.root }, gate => {
      const owned = { ...options, signal: controller.signal, gate };
      this._check(owned);
      return operation(owned);
    })).catch(error => {
      if (error?.result) return { ...error.result, cleanupVerified: false, code: safeCode(error) };
      fail(safeCode(error));
    }).finally(() => {
      options.signal?.removeEventListener('abort', abort);
      if (this.active === task) this.active = null;
    });
    return task.promise;
  }

  _selection(id) {
    const file = path.join(this.lockRoot, 'component-selections', `${id}.json`);
    return F.exists(file, this.io) ? { present: true, proof: proof(F.read(file,
      { max: 32768, io: this.io })) } : absent();
  }

  _capture(check = () => {}) {
    check();
    const peers = [], base = path.join(this.root, 'qq-installations');
    for (const id of F.names(base, F.LIMITS.maxInstallations, this.io)) {
      check();
      if (!F.UUID.test(id)) fail('shell_repair_scope_unverified');
      const value = this.metadataReader({ root: this.root, setupId: id, io: this.io });
      const m = value.repairMetadata;
      peers.push({ value, binding: { setupId: id, installationId: value.installationId,
        descriptorSha256: value.descriptorSha256, descriptorIdentity: m.descriptorIdentity,
        installationIdentity: m.installationIdentity, workIdentity: m.workIdentity,
        configIdentity: m.configIdentity, qqDataIdentity: m.qqDataIdentity,
        selection: this._selection(value.installationId),
        qq: { file: value.qq.file, size: value.qq.size, sha256: value.qq.sha256 },
      } });
    }
    const own = peers.find(row => row.value.setupId === this.setupId)?.value;
    if (!own) fail('managed_installation_changed');
    if (peers.some(row => row.value.current.manifestSha256 !== own.current.manifestSha256)) fail('manifest_invalid');
    const binding = { setupId: this.setupId, versionParentIdentity: own.repairMetadata.versionParentIdentity,
      manifestSha256: own.current.manifestSha256, manifestIdentity: own.repairMetadata.manifestIdentity,
      peers: peers.map(row => row.binding) };
    check();
    return { binding, manifest: own.manifest, scope: {
      installations: binding.peers.map(({ setupId, installationId }) => ({ setupId, installationId })),
      enumeration: 'component-store', allWithinStoreVerified: true,
      outsideStoreMetadataEnumerated: false,
    } };
  }

  _assertBinding(binding, check = () => {}) {
    const fresh = this._capture(check);
    if (!F.equal(fresh.binding, binding)) fail('shell_repair_changed');
    return fresh;
  }

  _locks(binding) {
    if (!F.exists(this.lockRoot, this.io)) return;
    const ids = new Set(binding.peers.map(row => row.installationId));
    for (const name of F.names(this.lockRoot, F.LIMITS.maxProcesses, this.io)) {
      // The existing Shell selection policy already refuses any account lease,
      // including stale or partial records. Recovery does not weaken that rule.
      if (/^[a-f0-9]{64}\.json(?:\.recover)?$/.test(name)) fail('runtime_locked');
      if (name === 'configuration.edit') fail('operation_in_progress');
      const match = /^installation-([a-f0-9]{64})\.lock(?:\.recover)?$/.exec(name);
      if (match && ids.has(match[1])) fail('component_locked');
    }
  }

  async _stopped(binding, check) {
    check(); this._locks(binding);
    let rows;
    try { rows = await this.host.snapshot(); } catch { fail('process_check_failed'); }
    check();
    if (!Array.isArray(rows) || rows.length > F.LIMITS.maxProcesses) fail('process_check_failed');
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.pid) || row.pid < 1 ||
          typeof row.name !== 'string' || typeof row.executable !== 'string') fail('process_check_failed');
      const name = row.name.toLowerCase();
      if (name === 'napcatqq-desktop.exe') fail('desktop_running');
      if (['qq.exe', 'napcatwinbootmain.exe'].includes(name) && !path.isAbsolute(row.executable)) fail('process_check_failed');
      if (path.isAbsolute(row.executable)) {
        const rel = path.relative(this.p.codeRoot, row.executable);
        if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ||
            binding.peers.some(peer => F.samePath(peer.qq.file, row.executable))) fail('runtime_running');
      }
    }
    this._locks(binding); check();
  }

  _dir(id) {
    if (!F.UUID.test(id)) fail('invalid_request');
    return path.join(this.p.operationsRoot, id);
  }
  _owner(value) {
    return { schema: 'qq_shell_code_preparing_v1', operationId: value.operationId,
      createdAt: value.createdAt, operationIdentity: value.operationIdentity,
      operationParentIdentity: value.operationParentIdentity, recoveryIdentity: value.recoveryIdentity,
      binding: value.binding, before: value.before };
  }
  _record(id) {
    const dir = this._dir(id), raw = F.read(path.join(dir, 'prepared.json'), { max: MAX_RECORD, io: this.io });
    let value;
    try { value = JSON.parse(raw.bytes); } catch { fail('shell_repair_unconfirmed'); }
    if (!F.keys(value, ['schema', 'operationId', 'createdAt', 'preparationProof', 'operationIdentity',
      'operationParentIdentity', 'recoveryIdentity', 'binding', 'before', 'staged', 'source']) ||
        value.schema !== 'qq_shell_code_repair_v1' || value.operationId !== id ||
        !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 ||
        !F.sameIdentity(value.operationIdentity, F.directory(dir, this.io)) ||
        !F.sameIdentity(value.operationParentIdentity, F.directory(this.p.operationsRoot, this.io)) ||
        !F.sameIdentity(value.recoveryIdentity, F.directory(this.p.recoveryRoot, this.io)) ||
        !validTree(value.before) || !validTree(value.staged) || !F.plain(value.binding) ||
        !F.HEX.test(value.binding.manifestSha256) || !Array.isArray(value.binding.peers) ||
        !value.binding.peers.length || value.binding.peers.length > F.LIMITS.maxInstallations ||
        !F.keys(value.source, ['verification', 'archiveBytes', 'fileCount', 'totalBytes']) ||
        !['full-pinned-archive-and-manifest', 'owned-incomplete-stage'].includes(value.source.verification) ||
        value.source.archiveBytes !== M.SOURCE.size || value.source.fileCount !== value.staged.files ||
        value.source.totalBytes !== value.staged.bytes) fail('shell_repair_unconfirmed');
    const preparing = path.join(dir, 'preparing.json');
    if (F.exists(preparing, this.io)) {
      const old = F.read(preparing, { max: MAX_RECORD, io: this.io });
      let owner;
      try { owner = JSON.parse(old.bytes); } catch { fail('shell_repair_unconfirmed'); }
      if (!F.equal(proof(old), value.preparationProof) || !F.equal(owner, this._owner(value))) fail('shell_repair_unconfirmed');
    }
    return { dir, value, proof: proof(raw) };
  }

  _intent(record) {
    const file = path.join(record.dir, 'intent.json');
    if (!F.exists(file, this.io)) return null;
    const links = this.io.lstatSync(file, { bigint: true }).nlink === 2n ? 2 : 1;
    const intent = F.read(file, { max: MAX_RECORD, links, io: this.io });
    if (intent.sha256 !== record.proof.sha256) fail('shell_repair_unconfirmed');
    if (links === 2) {
      const pending = F.read(this.p.pending, { max: MAX_RECORD, links: 2, io: this.io });
      if (!F.sameIdentity(intent, pending) || intent.sha256 !== pending.sha256) fail('shell_repair_unconfirmed');
    }
    return proof(intent);
  }

  _terminal(record) {
    const file = path.join(record.dir, 'terminal.json');
    if (!F.exists(file, this.io)) return null;
    const raw = F.read(file, { max: 4096, io: this.io });
    let value;
    try { value = JSON.parse(raw.bytes); } catch { fail('shell_repair_unconfirmed'); }
    if (!F.keys(value, ['schema', 'operationId', 'intentSha256', 'outcome', 'at']) ||
        value.schema !== 'qq_shell_code_terminal_v1' || value.operationId !== record.value.operationId ||
        value.intentSha256 !== record.proof.sha256 || !['completed', 'restored', 'abandoned'].includes(value.outcome) ||
        !Number.isSafeInteger(value.at) || value.at < 0) fail('shell_repair_unconfirmed');
    return { value, proof: proof(raw) };
  }

  _physical(record, check = () => {}) {
    const capture = this._assertBinding(record.value.binding, check), value = record.value;
    const live = F.tree(this.p.codeRoot, { io: this.io, missing: true, check });
    const old = F.tree(path.join(record.dir, 'old-code'), { io: this.io, missing: true, check });
    const staged = F.tree(path.join(record.dir, 'staged-code'), { io: this.io, missing: true, check });
    const complete = value.source.verification === 'full-pinned-archive-and-manifest';
    const originalLive = sameTree(value.before, live, { moved: true });
    const originalRetained = value.before.present && sameTree(value.before, old, { moved: true });
    const preparedLive = complete && sameTree(value.staged, live, { moved: true }) && matchesManifest(live, capture.manifest);
    const preparedStaged = sameTree(value.staged, staged, { moved: true }) && (!complete || matchesManifest(staged, capture.manifest));
    let state = 'blocked';
    if (originalLive && !old.present && preparedStaged) state = 'unchanged';
    else if (!live.present && (originalRetained || !value.before.present && !old.present) && preparedStaged) state = 'old-retained';
    else if (preparedLive && (originalRetained || !value.before.present && !old.present) && !staged.present) state = 'published';
    return { live, old, staged, state, originalLive, originalRetained, preparedLive, preparedStaged };
  }

  _assertPhysical(record, physical, check) {
    check();
    const current = this._record(record.value.operationId);
    if (!F.equal(current.proof, record.proof) || !F.equal(current.value, record.value)) fail('shell_repair_changed');
    F.assertTree(this.p.codeRoot, physical.live, { io: this.io, check });
    F.assertTree(path.join(record.dir, 'old-code'), physical.old, { io: this.io, check });
    F.assertTree(path.join(record.dir, 'staged-code'), physical.staged, { io: this.io, check });
    check();
  }

  _decisions(record, physical) {
    const terminal = this._terminal(record);
    if (terminal) {
      if (!F.exists(this.p.pending, this.io)) return [];
      this._intent(record);
      return (terminal.value.outcome === 'completed' ? physical.state === 'published' : physical.state === 'unchanged')
        ? ['acknowledge-complete'] : [];
    }
    if (physical.state === 'unchanged') return ['abandon-prepared'];
    if (record.value.source.verification !== 'full-pinned-archive-and-manifest') return [];
    if (physical.state === 'old-retained') return record.value.before.present
      ? ['complete-prepared', 'restore-original'] : ['complete-prepared'];
    return physical.state === 'published' ? ['acknowledge-complete'] : [];
  }

  _list() {
    const history = [], pending = [];
    let bytes = 0;
    const ids = F.exists(this.p.operationsRoot, this.io)
      ? F.names(this.p.operationsRoot, F.LIMITS.maxHistoryRecords, this.io) : [];
    for (const id of ids) {
      if (!F.UUID.test(id)) fail('shell_repair_scope_unverified');
      try {
        const record = this._record(id), terminal = this._terminal(record), intent = this._intent(record);
        if (terminal && intent?.nlink === 1) {
          // A later repair may legitimately change live code. Ended history is
          // descriptive only; it grants no authority over its retained tree.
          const old = F.tree(path.join(record.dir, 'old-code'), { io: this.io, missing: true });
          const staged = F.tree(path.join(record.dir, 'staged-code'), { io: this.io, missing: true });
          if (terminal.value.outcome === 'completed'
            ? staged.present || !sameTree(record.value.before, old, { moved: true })
            : old.present || !sameTree(record.value.staged, staged, { moved: true })) fail('shell_repair_unconfirmed');
          bytes += old.bytes + staged.bytes;
          history.push({ operationId: id, state: terminal.value.outcome, endedAt: terminal.value.at,
            retainedBytes: old.bytes + staged.bytes });
        } else {
          const physical = this._physical(record);
          bytes += physical.old.bytes + physical.staged.bytes;
          pending.push({ operationId: id, state: intent ? 'interrupted' : 'prepared_only',
            decisions: this._decisions(record, physical) });
        }
      } catch {
        pending.push({ operationId: id, state: 'blocked', decisions: [] });
        for (const name of ['old-code', 'staged-code']) {
          const file = path.join(this._dir(id), name);
          if (F.exists(file, this.io)) bytes += F.tree(file, { io: this.io }).bytes;
        }
      }
    }
    if (bytes > F.LIMITS.maxHistoryBytes) fail('shell_repair_history_full');
    return { history, pending, retention: { records: ids.length, bytes,
      maxRecords: F.LIMITS.maxHistoryRecords, maxBytes: F.LIMITS.maxHistoryBytes } };
  }

  inspect(options = {}) {
    this.draft = null;
    return this._task(options, async owned => {
      const check = () => this._check(owned), capture = this._capture(check);
      const before = F.tree(this.p.codeRoot, { io: this.io, missing: true, check });
      let source = 'unverified', stopped = 'unverified', reason = null;
      try {
        const artifact = await this.packages.verify({ version: M.VERSION, signal: owned.signal });
        if (artifact?.component !== 'napcat-shell' || artifact.sha256 !== M.SOURCE.sha256 ||
            artifact.size !== M.SOURCE.size || artifact.assetId !== M.SOURCE.assetId) fail('shell_repair_source_unavailable');
        source = 'verified-cache';
      } catch (error) { source = error.code === 'package_not_staged' ? 'not-staged' : 'unverified'; reason = safeCode(error); }
      check();
      try { await this._stopped(capture.binding, check); stopped = 'verified'; }
      catch (error) { stopped = ['runtime_running', 'runtime_locked', 'desktop_running'].includes(error.code) ? 'running' : 'unverified'; reason = safeCode(error); }
      check(); this._assertBinding(capture.binding, check);
      const list = this._list();
      let state = !before.present ? 'missing' : matchesManifest(before, capture.manifest) ? 'healthy' : 'damaged';
      if (F.exists(this.p.pending, this.io) || list.pending.some(row => row.state !== 'prepared_only')) {
        state = 'recovery_required'; reason = 'shell_repair_recovery_required';
      }
      const observationId = randomUUID();
      this.observation = { observationId, binding: capture.binding, before };
      return { observationId, component: 'napcat-shell', version: M.VERSION, versionId: M.RELEASE_ID,
        state, source: { state: source, archiveBytes: M.SOURCE.size }, stopped, reason, scope: capture.scope,
        canPrepare: ['damaged', 'missing'].includes(state) && source === 'verified-cache' && stopped === 'verified' && !list.pending.length,
        metadata: { descriptorVerified: true, manifestVerified: true }, ...list };
    });
  }

  preview({ observationId, ...options } = {}) {
    this.draft = null;
    return this._task(options, async owned => {
      const observed = this.observation;
      this.observation = null;
      if (!F.UUID.test(observationId) || observed?.observationId !== observationId) fail('preview_required');
      const check = () => this._check(owned);
      M.assertManagedShellRepairReady({ root: this.root, io: this.io });
      const capture = this._assertBinding(observed.binding, check);
      await this._stopped(capture.binding, check);
      const before = F.tree(this.p.codeRoot, { io: this.io, missing: true, check });
      if (!sameTree(before, observed.before)) fail('shell_repair_changed');
      if (matchesManifest(before, capture.manifest)) fail('shell_repair_not_needed');
      const list = this._list();
      if (list.pending.length) fail('shell_repair_recovery_required');
      if (list.retention.records >= F.LIMITS.maxHistoryRecords ||
          list.retention.bytes + before.bytes + F.LIMITS.maxTreeBytes > F.LIMITS.maxHistoryBytes) fail('shell_repair_history_full');
      F.ensureDirectory(this.p.operationsRoot, this.io);
      const operationId = randomUUID(), dir = this._dir(operationId);
      F.mkdir(dir, this.io);
      const basis = { operationId, createdAt: this.now(), operationIdentity: F.identity(F.directory(dir, this.io)),
        operationParentIdentity: F.identity(F.directory(this.p.operationsRoot, this.io)),
        recoveryIdentity: F.identity(F.directory(this.p.recoveryRoot, this.io)), binding: capture.binding, before };
      const preparing = F.writeExclusive(path.join(dir, 'preparing.json'), this._owner(basis), { io: this.io, check });
      let stage, written = false;
      try {
        stage = this.stageFactory({ packages: this.packages, io: this.io });
        if (typeof stage?.prepare !== 'function' || typeof stage?.close !== 'function') fail('invalid_response');
        this.stages.set(operationId, stage);
        const prepared = await stage.prepare({ operationDir: dir, manifest: capture.manifest,
          signal: owned.signal, assertCurrent: check });
        check();
        if (!prepared || !F.samePath(prepared.path, path.join(dir, 'staged-code')) ||
            !matchesManifest(prepared.proof, capture.manifest)) fail('invalid_response');
        const staged = F.tree(prepared.path, { io: this.io, check });
        if (!sameTree(staged, prepared.proof)) fail('shell_repair_changed');
        this._assertBinding(capture.binding, check);
        await this._stopped(capture.binding, check);
        F.assertTree(this.p.codeRoot, before, { io: this.io, check });
        F.assertTree(prepared.path, staged, { io: this.io, check });
        const value = { schema: 'qq_shell_code_repair_v1', ...basis,
          preparationProof: proof(preparing), staged, source: prepared.source };
        F.writeExclusive(path.join(dir, 'prepared.json'), value, { io: this.io, check }); written = true;
        const record = this._record(operationId);
        this._removePreparing(record);
        const ticket = this._newTicket('repair', record);
        return { operation: 'shell-code-repair', ...ticket.public, operationId,
          component: 'napcat-shell', version: M.VERSION, versionId: M.RELEASE_ID, scope: capture.scope,
          source: prepared.source, previousTree: before.present ? 'present' : 'absent',
          effects: { replacesCode: true, retainsOriginalTreeIfPresent: true,
            changesDescriptors: false, changesPreparedManifest: false, writesAccountData: false,
            changesWorkPaths: false, versionChange: false, automaticStop: false, automaticStart: false } };
      } catch (error) {
        if (!written) try {
          owned.gate(); this._assertBinding(capture.binding); F.assertTree(this.p.codeRoot, before, { io: this.io });
          if (!F.sameIdentity(basis.operationIdentity, F.directory(dir, this.io)) ||
              !F.equal(proof(F.read(path.join(dir, 'preparing.json'), { max: MAX_RECORD, io: this.io })), proof(preparing))) fail();
          let staged;
          if (typeof stage?.captureOwnedTree === 'function') staged = stage.captureOwnedTree(dir);
          else { staged = F.tree(path.join(dir, 'staged-code'), { io: this.io, missing: true }); if (staged.present) fail(); }
          F.writeExclusive(path.join(dir, 'prepared.json'), { schema: 'qq_shell_code_repair_v1', ...basis,
            preparationProof: proof(preparing), staged, source: { verification: 'owned-incomplete-stage',
              archiveBytes: M.SOURCE.size, fileCount: staged.files, totalBytes: staged.bytes } }, { io: this.io });
          const record = this._record(operationId);
          this._publishIntent(record, () => owned.gate()); this._settle(record, 'abandoned'); this._removePreparing(record);
        } catch { /* Unknown preparation residue is retained and blocks another repair. */ }
        throw error;
      }
    });
  }

  _newTicket(kind, record, extra = {}) {
    const ticketId = randomUUID(), expectedDigest = F.sha(JSON.stringify([record.proof, extra, ticketId]));
    const expiresAt = this.now() + F.LIMITS.previewTTL;
    this.draft = { kind, ticketId, expectedDigest, operationId: record.value.operationId,
      recordProof: record.proof, deadline: this.monotonic() + F.LIMITS.previewTTL, ...extra };
    return { public: { ticketId, expectedDigest, expiresAt } };
  }
  _consume(kind, ticketId, expectedDigest) {
    const value = this.draft; this.draft = null;
    if (!value || value.kind !== kind || value.ticketId !== ticketId || value.expectedDigest !== expectedDigest) fail('preview_required');
    return value;
  }
  _ticket(ticket, owned) {
    this._check(owned);
    if (this.monotonic() >= ticket.deadline) fail('preview_expired');
  }
  _removePreparing(record) {
    const file = path.join(record.dir, 'preparing.json');
    if (!F.exists(file, this.io)) return;
    const current = proof(F.read(file, { max: MAX_RECORD, io: this.io }));
    if (!F.equal(current, record.value.preparationProof)) fail('shell_repair_unconfirmed');
    if (!F.equal(this._record(record.value.operationId).proof, record.proof)) fail();
    const expected = Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'sha256'));
    if (!F.equal(F.stat(file, { max: MAX_RECORD, io: this.io }), expected)) fail();
    this.io.unlinkSync(file);
    if (F.exists(file, this.io)) fail('shell_repair_unconfirmed');
  }
  _publishIntent(record, check) {
    const file = path.join(record.dir, 'intent.json');
    if (F.exists(file, this.io) || F.exists(this.p.pending, this.io)) fail('shell_repair_recovery_required');
    const written = F.writeExclusive(file, F.read(path.join(record.dir, 'prepared.json'),
      { max: MAX_RECORD, io: this.io }).bytes, { io: this.io, check });
    if (written.sha256 !== record.proof.sha256) fail();
    check(); this.io.linkSync(file, this.p.pending);
    const a = F.read(file, { max: MAX_RECORD, links: 2, io: this.io });
    const b = F.read(this.p.pending, { max: MAX_RECORD, links: 2, io: this.io });
    if (!F.sameIdentity(a, b) || a.sha256 !== record.proof.sha256 || b.sha256 !== a.sha256) fail('shell_repair_unconfirmed');
  }
  _settle(record, outcome) {
    const file = path.join(record.dir, 'terminal.json');
    if (!F.exists(file, this.io)) F.writeExclusive(file, { schema: 'qq_shell_code_terminal_v1',
      operationId: record.value.operationId, intentSha256: record.proof.sha256, outcome, at: this.now() }, { io: this.io });
    else if (this._terminal(record).value.outcome !== outcome) fail('shell_repair_unconfirmed');
    const intent = this._intent(record);
    if (!intent) fail('shell_repair_unconfirmed');
    if (F.exists(this.p.pending, this.io)) {
      const pending = F.read(this.p.pending, { max: MAX_RECORD, links: 2, io: this.io });
      if (!F.sameIdentity(intent, pending) || pending.sha256 !== record.proof.sha256) fail('shell_repair_unconfirmed');
      this.io.unlinkSync(this.p.pending);
      if (F.exists(this.p.pending, this.io)) fail('shell_repair_unconfirmed');
    }
    M.assertManagedShellRepairReady({ root: this.root, io: this.io });
  }
  _recoveryRequired(id) {
    try { const record = this._record(id); return F.exists(this.p.pending, this.io) || !!this._intent(record) && !this._terminal(record); }
    catch { return true; }
  }
  _receipt(id, values = {}) {
    return { operationId: id, operation: 'shell-code-repair', committed: false, liveCode: 'unchanged',
      oldTreeRetained: false, readback: 'unavailable', recoveryRequired: false, cleanupVerified: true,
      descriptorBytesUnchanged: null, manifestBytesUnchanged: null, selectionBytesUnchanged: null,
      dataPathsUnchanged: null, accountDataVerification: 'not-read', automaticStart: false,
      automaticStop: false, versionChange: false, code: null, ...values };
  }
  _preserved() { return { descriptorBytesUnchanged: true, manifestBytesUnchanged: true,
    selectionBytesUnchanged: true, dataPathsUnchanged: true }; }

  confirm({ ticketId, expectedDigest, ...options } = {}) {
    const ticket = this._consume('repair', ticketId, expectedDigest);
    return this._task(options, async owned => {
      let attempted = false, published = false, verified = false;
      const check = () => this._check(owned);
      try {
        this._ticket(ticket, owned);
        const record = this._record(ticket.operationId);
        if (!F.equal(record.proof, ticket.recordProof) || record.value.source.verification !== 'full-pinned-archive-and-manifest') fail();
        const physical = this._physical(record, check);
        if (physical.state !== 'unchanged') fail();
        await this._stopped(record.value.binding, check); this._assertPhysical(record, physical, check);
        this._ticket(ticket, owned); this._publishIntent(record, check);
        const latest = this._physical(record, check);
        if (latest.state !== 'unchanged') fail();
        await this._stopped(record.value.binding, check); this._assertPhysical(record, latest, check);
        this._ticket(ticket, owned); this._assertBinding(record.value.binding, check); attempted = true;
        if (record.value.before.present) this.io.renameSync(this.p.codeRoot, path.join(record.dir, 'old-code'));
        check(); const phase = this._physical(record, check);
        if (phase.state !== 'old-retained' && !(phase.state === 'unchanged' && !record.value.before.present)) fail('shell_repair_unconfirmed');
        await this._stopped(record.value.binding, check); this._assertPhysical(record, phase, check);
        this._assertBinding(record.value.binding, check);
        this.io.renameSync(path.join(record.dir, 'staged-code'), this.p.codeRoot); published = true;
        const after = this._physical(record);
        if (after.state !== 'published') fail('shell_repair_readback_failed');
        verified = true; owned.gate(); this._settle(record, 'completed');
        return this._receipt(ticket.operationId, { committed: true, liveCode: 'same-version-verified',
          oldTreeRetained: record.value.before.present, readback: 'full-manifest', ...this._preserved() });
      } catch (error) {
        let old = null;
        try { const record = this._record(ticket.operationId), state = this._physical(record);
          if (state.state === 'published') { published = true; verified = true; old = record.value.before.present; }
        } catch { /* Preserve the strongest independently known publication fact. */ }
        return this._receipt(ticket.operationId, { committed: published ? true : attempted ? null : false,
          liveCode: verified ? 'same-version-verified' : attempted ? 'unverified' : 'unchanged',
          oldTreeRetained: old === null ? attempted ? null : false : old,
          readback: verified ? 'full-manifest' : 'unavailable',
          ...(verified ? this._preserved() : {}), recoveryRequired: this._recoveryRequired(ticket.operationId),
          cleanupVerified: safeCode(error) !== 'shell_repair_cleanup_unconfirmed', code: safeCode(error) });
      }
    });
  }

  reconcilePreview({ operationId, decision, ...options } = {}) {
    this.draft = null;
    return this._task(options, async owned => {
      const check = () => this._check(owned), record = this._record(operationId), state = this._physical(record, check);
      if (!this._decisions(record, state).includes(decision)) fail('shell_repair_recovery_required');
      await this._stopped(record.value.binding, check); this._assertPhysical(record, state, check);
      const terminal = this._terminal(record), physical = { live: state.live.digest, old: state.old.digest, staged: state.staged.digest };
      const ticket = this._newTicket('reconcile', record, { decision, terminal, physical });
      return { operation: 'shell-code-reconcile', operationId, decision, ...ticket.public,
        component: 'napcat-shell', version: M.VERSION, versionId: M.RELEASE_ID, scope: this._capture(check).scope,
        effects: { publishesPreparedCode: decision === 'complete-prepared', restoresOriginalCode: decision === 'restore-original',
          settlesExistingPublication: decision === 'acknowledge-complete', removesRetainedCode: false,
          changesDescriptors: false, changesPreparedManifest: false, writesAccountData: false,
          automaticStart: false, automaticStop: false, versionChange: false } };
    });
  }

  reconcileConfirm({ ticketId, expectedDigest, ...options } = {}) {
    const ticket = this._consume('reconcile', ticketId, expectedDigest);
    return this._task(options, async owned => {
      let attempted = false;
      const outcome = ticket.terminal?.value.outcome || (ticket.decision === 'abandon-prepared' ? 'abandoned'
        : ticket.decision === 'restore-original' ? 'restored' : 'completed');
      try {
        this._ticket(ticket, owned);
        const check = () => this._check(owned), record = this._record(ticket.operationId), state = this._physical(record, check);
        if (!F.equal(record.proof, ticket.recordProof) || !F.equal(this._terminal(record), ticket.terminal) ||
            !F.equal(ticket.physical, { live: state.live.digest, old: state.old.digest, staged: state.staged.digest }) ||
            !this._decisions(record, state).includes(ticket.decision)) fail();
        await this._stopped(record.value.binding, check); this._assertPhysical(record, state, check);
        this._ticket(ticket, owned);
        if (!this._intent(record)) this._publishIntent(record, check);
        this._assertBinding(record.value.binding, check); this._assertPhysical(record, state, check);
        this._ticket(ticket, owned);
        if (ticket.decision === 'complete-prepared') { attempted = true; this.io.renameSync(path.join(record.dir, 'staged-code'), this.p.codeRoot); }
        else if (ticket.decision === 'restore-original') { attempted = true; this.io.renameSync(path.join(record.dir, 'old-code'), this.p.codeRoot); }
        const after = this._physical(record);
        if (outcome === 'completed' ? after.state !== 'published' : after.state !== 'unchanged') fail('shell_repair_unconfirmed');
        owned.gate(); this._settle(record, outcome); this._removePreparing(record);
        return this._receipt(ticket.operationId, { operation: 'shell-code-reconcile', committed: true,
          liveCode: outcome === 'completed' ? 'same-version-verified' : outcome === 'restored' ? 'original-restored' : 'unchanged',
          oldTreeRetained: outcome === 'completed' && record.value.before.present,
          readback: outcome === 'completed' ? 'full-manifest' : 'original-proof', ...this._preserved() });
      } catch (error) {
        let verified = false, retained = null;
        try { const record = this._record(ticket.operationId), state = this._physical(record);
          verified = outcome === 'completed' ? state.state === 'published' : state.state === 'unchanged' &&
            (ticket.decision === 'restore-original' ? attempted : !!this._terminal(record));
          if (verified) retained = outcome === 'completed' && record.value.before.present;
        } catch { /* Unknown state is retained. No replay or rollback. */ }
        return this._receipt(ticket.operationId, { operation: 'shell-code-reconcile', committed: verified ? true : attempted ? null : false,
          liveCode: verified ? outcome === 'completed' ? 'same-version-verified' : outcome === 'restored' ? 'original-restored' : 'unchanged'
            : attempted ? 'unverified' : 'unchanged', oldTreeRetained: retained,
          readback: verified ? outcome === 'completed' ? 'full-manifest' : 'original-proof' : 'unavailable',
          ...(verified ? this._preserved() : {}), recoveryRequired: this._recoveryRequired(ticket.operationId),
          cleanupVerified: safeCode(error) !== 'shell_repair_cleanup_unconfirmed', code: safeCode(error) });
      }
    });
  }

  async discard() {
    this.draft = null; this.observation = null; this.active?.controller.abort();
    await this.active?.promise.catch(() => {});
    for (const [id, stage] of [...this.stages]) {
      if ((await stage.close())?.closed !== true) fail('shell_repair_cleanup_unconfirmed');
      this.stages.delete(id);
    }
    F.retryCloses(this.io);
    return { discarded: true };
  }
  async close() {
    this.closing = true;
    await this.discard(); this.closed = true;
    return { closed: true };
  }
}

module.exports = { QQManagedShellCodeRepair, safeCode, matchesManifest };
