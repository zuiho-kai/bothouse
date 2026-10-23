// Native lifecycle -> standard ACP updates. No prompts or child output cross
// this boundary. The ACP owner check uses the exact parent Agent reference.
// Public labels only: the child's short task label from its own
// subagent/descriptor event, its agent preset as name, and the name of the
// tool it is calling as its step — never tool arguments or message text.
export function attachSubagentUpdates(ctx, { carrierKeyOf, ownedRecord, notify, agents }) {
  const active = new Map();
  const queues = new WeakMap();
  // Labels seen on a child's session before or after its run starts.
  const labels = new Map();
  const labelsOf = (id) => labels.get(id) ?? {};
  const send = (entry, status, started = false) => {
    const { name, task } = labelsOf(entry.id);
    const meta = { id: entry.id, runId: entry.runId, status };
    if (name) meta.name = name;
    if (task) meta.task = task;
    if (entry.step) meta.step = entry.step;
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
          _meta: { 'bothouse/subagent': meta },
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
    const entry = { record, parent, runId: key, id: String(info.id), child: info.local ? agents.get(info.id) : undefined, status: 'running' };
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
        entry.status = status === 'idle' ? 'waiting' : 'running';
        void send(entry, entry.status);
      }
    }
  });
  ctx.on('session/event', (session, event) => {
    const id = session?.header?.id ?? session?.id;
    if (!id || !event) return;
    const key = String(id);
    let label;
    if (event.type === 'subagent/descriptor' && typeof event.data?.label === 'string') label = { task: event.data.label.trim() };
    else if (event.type === 'agent-preset/selected' && typeof event.data?.agentPreset === 'string') label = { name: event.data.agentPreset.trim() };
    if (label) {
      labels.set(key, { ...labelsOf(key), ...label });
      for (const entry of active.values()) if (entry.id === key) void send(entry, entry.status);
      return;
    }
    if (event.type !== 'tool/call' || typeof event.data?.name !== 'string') return;
    for (const entry of active.values()) {
      if (entry.id === key && entry.status === 'running' && entry.step !== event.data.name) {
        entry.step = event.data.name;
        void send(entry, entry.status);
      }
    }
  });
  ctx.on('dispose', () => { active.clear(); labels.clear(); });
}
