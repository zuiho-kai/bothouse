'use strict';
const P = require('./qq-supervisor-policy.cjs');
const C = require('./qq-supervisor-component-repair-policy.cjs');

function correlated(operation, pending) {
  C.operation(operation);
  if (operation.requestId !== pending.requestId || operation.action !== pending.action ||
      operation.operationId !== pending.operationId) P.fail('invalid_response');
  return operation;
}

module.exports = {
  async componentRepairRead(input) {
    P.supervisorRequest(input, 'componentRepairRead');
    const panel = this._assert(input);
    panel.ticket = null;
    panel.componentRepairInspection = null;
    return this._run(panel, options => this._client(panel, input.supervisorId, options,
      async (client, guard, entry) => {
        const cap = await client.componentRepairCapabilities(guard);
        guard.assertCurrent();
        if (cap === null) return { link: this._public(entry.supervisorId), capability: null, inspection: null };
        C.envelope(cap, entry, ['capability']);
        const capability = C.capability(cap.capability);
        if (!capability.enabled) return { link: this._public(entry.supervisorId), capability, inspection: null };
        const response = await client.componentRepairInspect(guard);
        guard.assertCurrent();
        C.envelope(response, entry, ['inspection']);
        if (response.ledgerId !== cap.ledgerId) P.fail('ledger_mismatch');
        const inspection = C.inspection(response.inspection);
        panel.componentRepairInspection = {
          supervisorId: entry.supervisorId, revision: entry.revision,
          ledgerId: response.ledgerId, inspection, deadline: this.monotonic() + 60000,
        };
        return { link: this._public(entry.supervisorId), capability, inspection };
      }));
  },

  async componentRepairPreview(input) {
    P.supervisorRequest(input, 'componentRepairPreview');
    const panel = this._assert(input);
    this._idle(panel);
    panel.ticket = null;
    const entry = this._entry(panel, input.supervisorId), seen = panel.componentRepairInspection;
    if (entry.pending) P.fail('operation_unresolved');
    if (entry.history.length >= 16) P.fail('history_limit');
    if (!seen || seen.supervisorId !== entry.supervisorId || seen.revision !== entry.revision ||
        this.monotonic() >= seen.deadline) P.fail('observation_expired');
    if (input.action === 'repair') {
      if (!seen.inspection.canPrepare || input.observationId !== seen.inspection.observationId) P.fail('unavailable');
    } else if (!seen.inspection.pending.some(row => row.operationId === input.operationId && row.decisions.includes(input.action))) {
      P.fail('unavailable');
    }
    return this._run(panel, options => this._client(panel, entry.supervisorId, options,
      async (client, guard, currentEntry) => {
        const response = await client.componentRepairPreview({
          action: input.action, observationId: input.observationId, operationId: input.operationId,
        }, guard);
        guard.assertCurrent();
        C.envelope(response, currentEntry, ['preview']);
        if (response.ledgerId !== seen.ledgerId) P.fail('ledger_mismatch');
        const value = C.preview(response.preview);
        if (value.action !== input.action || input.action !== 'repair' && value.operationId !== input.operationId) P.fail('invalid_response');
        const ttl = Math.min(60000, value.expiresAt - this.now());
        if (ttl <= 0) P.fail('expired_ticket');
        const ticket = {
          kind: 'component-repair', ticketId: P.randomUUID(), supervisorId: entry.supervisorId,
          revision: entry.revision, ledgerId: response.ledgerId, action: value.action,
          operationId: value.operationId, serverTicketId: value.ticketId,
          expectedDigest: value.expectedDigest, deadline: this.monotonic() + ttl,
          expiresAt: this.now() + ttl,
        };
        panel.ticket = ticket;
        panel.componentRepairInspection = null;
        const { ticketId, expectedDigest, ...publicPreview } = value;
        return { preview: { ...publicPreview, kind: ticket.kind, ticketId: ticket.ticketId,
          supervisorId: ticket.supervisorId, expiresAt: ticket.expiresAt } };
      }));
  },

  async componentRepairConfirm(input) {
    P.supervisorRequest(input, 'componentRepairConfirm');
    const panel = this._assert(input);
    this._idle(panel);
    const ticket = panel.ticket;
    panel.ticket = null;
    if (!ticket || ticket.kind !== 'component-repair' || ticket.ticketId !== input.ticketId ||
        this.monotonic() >= ticket.deadline) P.fail('expired_ticket');
    const entry = this._entry(panel, ticket.supervisorId);
    if (entry.history.length >= 16) P.fail('history_limit');
    if (entry.pending || entry.revision !== ticket.revision) P.fail('registration_changed');
    return this._run(panel, options => this._client(panel, entry.supervisorId, options,
      async (client, guard, currentEntry) => {
        const pending = {
          kind: 'component-repair', requestId: P.randomUUID(), action: ticket.action,
          operationId: ticket.operationId, ticketId: ticket.serverTicketId,
          expectedDigest: ticket.expectedDigest, phase: 'prepared', createdAt: this.now(),
          ledgerId: ticket.ledgerId, terminal: null,
        };
        const check = () => { guard.assertCurrent(); if (this.monotonic() >= ticket.deadline) P.fail('expired_ticket'); };
        check();
        this.links.setPending(currentEntry.supervisorId, currentEntry.revision, pending);
        let operation = null, outcome = 'unknown', code = null, invoked = false, returned = false;
        try {
          check(); invoked = true;
          const response = await client.componentRepairConfirm({
            requestId: pending.requestId, action: pending.action, operationId: pending.operationId,
            ticketId: pending.ticketId, expectedDigest: pending.expectedDigest,
          }, { signal: guard.signal, assertCurrent: check, onAttempt: () => {
            check(); this.links.setPending(currentEntry.supervisorId, currentEntry.revision, { ...pending, phase: 'attempted' });
          } });
          returned = true;
          C.envelope(response, currentEntry, ['operation']);
          if (response.ledgerId !== pending.ledgerId) P.fail('ledger_mismatch');
          operation = correlated(response.operation, pending);
          outcome = operation.phase === 'completed' ? 'accepted' : operation.phase === 'not_submitted' ? 'rejected' : 'unknown';
          // The owning client settles known results only after transport cleanup.
        } catch (error) {
          code = P.CODES.has(error?.code) ? error.code : 'invalid_response';
          if (!invoked || !returned && error?.submitted === false) {
            this.links.setPending(currentEntry.supervisorId, currentEntry.revision, null);
            outcome = 'not_submitted';
          }
          operation = null;
        }
        return { componentRepairChange: {
          requestId: pending.requestId, action: pending.action, operationId: pending.operationId,
          outcome, operation, pending: this._public(currentEntry.supervisorId).pending !== null, code,
        } };
      }));
  },

  async componentRepairDiscard(input) {
    P.supervisorRequest(input, 'componentRepairDiscard');
    const panel = this._assert(input);
    this._idle(panel);
    const entry = this._entry(panel, input.supervisorId);
    if (entry.pending) P.fail('operation_unresolved');
    panel.ticket = null;
    panel.componentRepairInspection = null;
    return this._run(panel, options => this._client(panel, entry.supervisorId, options,
      async (client, guard, currentEntry) => {
        const response = await client.componentRepairDiscard(guard);
        guard.assertCurrent();
        C.envelope(response, currentEntry, ['discarded']);
        if (response.discarded !== true) P.fail('invalid_response');
        return { discarded: true };
      }));
  },

  async _queryComponentRepair(client, guard, entry) {
    const pending = entry.pending;
    const response = await client.componentRepairQuery(pending.requestId, guard);
    guard.assertCurrent();
    if (response.ledgerId !== pending.ledgerId) P.fail('ledger_mismatch');
    if (response.ok === false) {
      if (response.code !== 'not_found') P.fail('invalid_response');
      const unsent = pending.phase === 'prepared';
      // Defer clearing even an unsubmitted request until this client closes.
      return { componentRepairQuery: {
        requestId: pending.requestId, action: pending.action, operationId: pending.operationId,
        found: false, operation: null, pending: !unsent, canEndRecovery: false,
        code: unsent ? 'not_submitted' : 'not_found',
      } };
    }
    C.envelope(response, entry, ['operation']);
    const operation = correlated(response.operation, pending);
    if (operation.phase === 'unknown' && operation.finishedAt !== null) {
      this.links.setPending(entry.supervisorId, entry.revision, { ...pending, terminal: operation });
    }
    return { componentRepairQuery: {
      requestId: pending.requestId, action: pending.action, operationId: pending.operationId,
      found: true, operation, pending: this._public(entry.supervisorId).pending !== null,
      canEndRecovery: operation.phase === 'unknown' && operation.finishedAt !== null, code: null,
    } };
  },
};
