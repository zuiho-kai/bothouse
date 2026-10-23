// Native lifecycle -> standard ACP updates. No prompts or child output cross
// this boundary. The ACP owner check uses the exact parent Agent reference.
export function attachSubagentUpdates(ctx, { carrierKeyOf, ownedRecord, notify, agents }) {
  const active = new Map();
  const queues = new WeakMap();
  const send = (entry, status, started = false) => {
    const previous = queues.get(entry.record) ?? Promise.resolve();
    const delivery = previous.then(async () => {
      await entry.record.drainUpdates();
      await notify({
        sessionId: String(entry.parent.session.id),
        update: {
          sessionUpdate: started ? 'tool_call' : 'tool_call_update',
          toolCallId: 'subagent/' + entry.runId,
          ...(started ? { title: entry.id, kind: 'other' } : {}),
          status: status === 'running' || status === 'waiting' ? 'in_progress' : status === 'failed' ? 'failed' : 'completed',
          _meta: { 'bothouse/subagent': { id: entry.id, runId: entry.runId, status } },
        },
      });
    }).catch((error) => ctx.logger.warn('subagent update failed: ' + String(error)));
    queues.set(entry.record, delivery);
    return delivery;
  };
  ctx.on('subagent/start', function (info) {
    const parent = carrierKeyOf(this);
    const record = ownedRecord(parent);
    if (!record || !info.id || !info.runId) return;
    const key = String(info.runId);
    if (active.has(key)) return;
    const entry = { record, parent, runId: key, id: String(info.id), child: info.local ? agents.get(info.id) : undefined };
    active.set(key, entry);
    return send(entry, 'running', true);
  });
  ctx.on('subagent/end', function (info) {
    const entry = active.get(String(info.runId));
    if (!entry || entry.parent !== carrierKeyOf(this) || entry.id !== String(info.id)) return;
    active.delete(entry.runId);
    const status = info.stopReason === 'completed' ? 'completed' : info.stopReason === 'aborted' ? 'stopped' : 'failed';
    return send(entry, status);
  });
  ctx.on('agent/status', ({ agent, status }) => {
    for (const entry of active.values()) {
      if (entry.child === agent && (status === 'idle' || status === 'running')) {
        void send(entry, status === 'idle' ? 'waiting' : 'running');
      }
    }
  });
  ctx.on('dispose', () => active.clear());
}
