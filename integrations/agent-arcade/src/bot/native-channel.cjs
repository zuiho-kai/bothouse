'use strict';
// Original Claude Code owns its login and execution. This process only relays MCP.
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema, LATEST_PROTOCOL_VERSION } = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const {styleInstructions} = require('../core/personas.cjs');

const MAX_BYTES = 200 * 1024;
const MAX_IDS = 200;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_ID = /^[a-km-z]{5}$/;
const PERMISSION_REQUEST = 'notifications/claude/channel/permission_request';
const PERMISSION_REPLY = 'notifications/claude/channel/permission';
const permissionSchema = z.object({
  method: z.literal(PERMISSION_REQUEST),
  params: z.object({request_id:z.string().regex(REQUEST_ID), tool_name:z.string().min(1).max(128),
    description:z.string().max(16000), input_preview:z.string().max(131072)}),
});
const replySchema = z.object({id:z.string().regex(ID), text:z.string().min(1).max(12000)}).strict();
const fail = code => Object.assign(new Error(code), {code});
const terminalErrors = new Set(['resync_required','bridge_access_denied','bridge_request_rejected','invalid_bridge_response',
  'invalid_bridge_events','invalid_bridge_message','bridge_response_too_large','mcp_write_failed']);
function abortableSleep(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {clearTimeout(timer); signal.removeEventListener('abort', finish); resolve();};
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, {once:true});
  });
}

function bridgeConfig(url, token) {
  if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.test(url)) throw fail('invalid_bridge_address');
  let parsed;
  try { parsed = new URL(url); } catch { throw fail('invalid_bridge_address'); }
  if (!parsed.port || Number(parsed.port) > 65535) throw fail('invalid_bridge_address');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('invalid_bridge_capability');
  return {url:parsed.origin, token};
}

async function boundedJSON(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw fail('bridge_response_too_large');
  if (!response.body) throw fail('invalid_bridge_response');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw fail('bridge_response_too_large');
      chunks.push(Buffer.from(value));
    }
    try {return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));}
    catch {throw fail('invalid_bridge_response');}
  } finally { await reader.cancel().catch(() => {}); }
}

function createChannel({url, token, fetchImpl=globalThis.fetch, mcp, timeoutMs=30000, signal, onError=()=>{},persona={enabled:true,selection:'default'},
  reconnectMs=30000, now=()=>performance.now(), sleep=abortableSleep} = {}) {
  const config = bridgeConfig(url, token);
  // Claude's channel runtime does not register negotiated revision 2026-07-28.
  // Revisit this gate only after accepting a newer pinned SDK with the real CLI.
  if (LATEST_PROTOCOL_VERSION >= '2026-07-28') throw fail('unsupported_mcp_revision');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw fail('invalid_bridge_timeout');
  if (!Number.isFinite(reconnectMs) || reconnectMs < 1 || reconnectMs > 30000) throw fail('invalid_bridge_reconnect_window');
  const personaStyle=styleInstructions('claude-native',persona);
  mcp ||= new Server({name:'agent-arcade-wechat', version:'0.1.0'}, {
    capabilities:{experimental:{'claude/channel':{}, 'claude/channel/permission':{}}, tools:{}},
    instructions:'You are talking with the paired owner through their configured chat channel. Messages arrive as <channel task_id="...">. ' +
      'Use the reply tool with that exact task_id as id for answers and clarification questions. ' +
      'Reply naturally, directly and concisely in the owner\'s language. Ordinary conversation needs only your answer. ' +
      'Do not send task-received confirmations, transport diagnostics, internal IDs or routine verification disclaimers. ' +
      'For work requests, describe actual results and any meaningful failure or requested check you could not perform. ' +
      'Never claim a change, test or successful outcome without evidence. A reply ending does not prove task success. ' +
      'Permission decisions arrive separately through Claude Code permission relay; follow the CLI\'s permissions. ' +
      'A relay disconnect does not stop this Claude Code session.' + (personaStyle ? '\n\n' + personaStyle : ''),
  });
  const controller = new AbortController(), messages = new Set(), pending = new Set();
  let cursor = 0, clientId = '', initialized = false, started = false, closing = false, closePromise;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone=resolve; });

  async function request(route, method='GET', payload, {detaching=false, waitMs=timeoutMs} = {}) {
    if (controller.signal.aborted && !detaching) throw fail('bridge_closed');
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body && Buffer.byteLength(body) > MAX_BYTES) throw fail('bridge_request_too_large');
    const local = new AbortController();
    const abort = () => local.abort();
    if (!detaching) controller.signal.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(abort, detaching ? 1000 : Math.max(1,Math.min(timeoutMs,waitMs)));
    try {
      const response = await fetchImpl(config.url + route, {method, body, redirect:'error', cache:'no-store', signal:local.signal,
        headers:{Authorization:`Bearer ${config.token}`, Accept:'application/json',
          ...(clientId ? {'X-Arcade-Client':clientId} : {}), ...(body ? {'Content-Type':'application/json'} : {})}});
      if (!response.ok) throw fail(response.status === 409 ? 'resync_required' : response.status === 401 || response.status === 403 ? 'bridge_access_denied' :
        response.status >= 400 && response.status < 500 && ![408,429].includes(response.status) ? 'bridge_request_rejected' : 'bridge_request_failed');
      return await boundedJSON(response);
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
  }

  async function notify(message) {
    try { await mcp.notification(message); }
    catch { throw fail('mcp_write_failed'); }
  }

  async function verdict(requestId, behavior) {
    if (!pending.has(requestId)) return;
    await notify({method:PERMISSION_REPLY, params:{request_id:requestId, behavior}});
    pending.delete(requestId);
  }

  async function receive(batch) {
    if (!batch || !Array.isArray(batch.events) || batch.events.length > 128 ||
        (batch.closed !== undefined && typeof batch.closed !== 'boolean')) throw fail('invalid_bridge_events');
    for (const event of batch.events) {
      if (closing || controller.signal.aborted) throw fail('bridge_closed');
      if (!event || !Number.isSafeInteger(event.seq) || event.seq < 1) throw fail('invalid_bridge_events');
      if (event.seq <= cursor) continue;
      if (event.type === 'message') {
        if (typeof event.id !== 'string' || !ID.test(event.id) || typeof event.text !== 'string' || !event.text.length || event.text.length > 6000) throw fail('invalid_bridge_message');
        if (!messages.has(event.id)) {
          await notify({method:'notifications/claude/channel', params:{content:event.text, meta:{task_id:event.id}}});
          messages.add(event.id);
          if (messages.size > MAX_IDS) messages.delete(messages.values().next().value);
        }
      } else if (event.type === 'permission_reply') {
        if (typeof event.request_id === 'string' && REQUEST_ID.test(event.request_id) && ['allow','deny'].includes(event.behavior)) {
          await verdict(event.request_id, event.behavior);
        }
      }
      // Unknown events cannot authorize anything, but must not poison the cursor.
      cursor = event.seq;
    }
    return batch.closed === true;
  }

  async function pause(ms) {
    if (controller.signal.aborted) return;
    await sleep(ms, controller.signal);
  }

  function close({notify=true} = {}) {
    if (closing) return closePromise;
    closing = true;
    let finish;closePromise=new Promise(resolve=>{finish=resolve;});
    (async () => {
      try {
        if (notify) for (const id of [...pending]) await verdict(id, 'deny').catch(() => {});
        pending.clear();
        // Complete the authenticated detach before aborting the active HTTP
        // poll. Aborting first can tear down its shared transport mid-detach.
        if (clientId) await request('/detached', 'POST', {}, {detaching:true}).catch(() => {});
      } finally {
        controller.abort();await mcp.close().catch(() => {});
        signal?.removeEventListener('abort', externalAbort);resolveDone();finish();
      }
    })().catch(()=>{controller.abort();resolveDone();finish();});
    return closePromise;
  }
  const externalAbort = () => {void close();};
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', externalAbort, {once:true});

  async function denyOrClose(requestId) {
    try { await verdict(requestId, 'deny'); }
    catch {
      onError('mcp_write_failed');
      await close({notify:false});
    }
  }

  async function attachAndPoll() {
    if (initialized || closing) return;
    initialized = true;
    try {
      const attached = await request('/attached', 'POST', {});
      if (!attached || typeof attached.client_id !== 'string' || !/^[a-f0-9]{32}$/.test(attached.client_id)) throw fail('invalid_bridge_attachment');
      clientId = attached.client_id;
      let failures = 0, recoveryDeadline = null;
      while (!closing && !controller.signal.aborted) {
        try {
          // Only repeat a GET with the committed cursor. Never reattach, replay
          // a tool reply, or repeat a permission decision after uncertainty.
          if (recoveryDeadline !== null && now() >= recoveryDeadline) throw fail('bridge_recovery_expired');
          const batch = await request(`/events?after=${cursor}`, 'GET', undefined,
            {waitMs:recoveryDeadline === null ? timeoutMs : recoveryDeadline-now()});
          if (await receive(batch)) break;
          failures = 0; recoveryDeadline = null;
          if (!batch.events.length) await pause(100);
        } catch (error) {
          if (closing || controller.signal.aborted) break;
          if (terminalErrors.has(error.code) || error.code === 'bridge_recovery_expired') throw error;
          if (recoveryDeadline === null) recoveryDeadline = now()+reconnectMs;
          const remaining = recoveryDeadline-now();
          if (remaining <= 0) throw fail('bridge_recovery_expired');
          await pause(Math.min(250 * 2 ** Math.min(failures++,3),2000,remaining));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) onError(error.code || 'bridge_disconnected');
    } finally { await close(); }
  }

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[{
    name:'reply', description:'Send an answer or result to the paired owner in their configured chat. Use the exact task_id of a message you received as id.',
    inputSchema:{type:'object',properties:{id:{type:'string',maxLength:128},text:{type:'string',minLength:1,maxLength:12000}},required:['id','text'],additionalProperties:false},
  }]}));
  mcp.setRequestHandler(CallToolRequestSchema, async ({params}) => {
    const parsed = replySchema.safeParse(params.arguments);
    if (params.name !== 'reply' || !parsed.success || !messages.has(parsed.data.id) || closing || !clientId) {
      return {isError:true, content:[{type:'text',text:'Reply rejected: use a current forwarded task id and bounded text.'}]};
    }
    try {
      const response = await request('/reply', 'POST', parsed.data);
      if (response?.accepted !== true) throw fail('reply_not_accepted');
      return {content:[{type:'text',text:'Reply accepted by the chat service. Recipient receipt is unknown; do not repeat this internal acknowledgement to the owner.'}]};
    } catch { return {isError:true,content:[{type:'text',text:'Reply relay failed. Check Agent Arcade; do not assume delivery.'}]}; }
  });
  mcp.setNotificationHandler(permissionSchema, async ({params}) => {
    if (!clientId || closing || pending.has(params.request_id)) return;
    pending.add(params.request_id);
    if (pending.size > 100) {await denyOrClose(params.request_id); return;}
    try {
      const response = await request('/permission', 'POST', {request_id:params.request_id, tool_name:params.tool_name,
        input:params.input_preview, description:params.description});
      if (!response || !(response.code === null || typeof response.code === 'string' && response.code.length <= 128)) throw fail('invalid_bridge_permission');
      // No remote context: keep the original terminal prompt authoritative.
      if (response?.relayed === false) pending.delete(params.request_id);
    } catch { await denyOrClose(params.request_id); }
  });
  mcp.oninitialized = () => {void attachAndPoll();};
  mcp.onclose = () => {void close({notify:false});};
  mcp.onerror = () => {onError('mcp_transport_error');};

  return {mcp, done, close, receive,
    async start(transport) {
      if (started || closing || controller.signal.aborted) throw fail('channel_already_started_or_closed');
      started = true;
      await mcp.connect(transport || new StdioServerTransport());
    },
  };
}

async function runChannel({env=process.env, ...options} = {}) {
  const channel = createChannel({url:env.ARCADE_BRIDGE_URL, token:env.ARCADE_BRIDGE_TOKEN,
    persona:{enabled:env.ARCADE_PERSONA_VOICE === undefined || env.ARCADE_PERSONA_VOICE === '1',selection:env.ARCADE_PERSONA_SELECTION === 'sprout' ? 'sprout' : 'default'},
    onError:code=>process.stderr.write(`Agent Arcade local relay stopped (${['resync_required','bridge_access_denied','invalid_bridge_attachment','bridge_disconnected','bridge_recovery_expired'].includes(code)?code:'bridge_error'}). Restart it in Agent Arcade.\n`),
    ...options});
  const stop = () => {void channel.close();};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {await channel.start(); await channel.done;}
  finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await channel.close();}
}

if (require.main === module) runChannel().catch(() => {
  // Never print bridge credentials, server responses, or arbitrary exception text.
  process.stderr.write('Agent Arcade local channel could not connect. Restart its relay in Agent Arcade.\n');
  process.exitCode = 1;
});
module.exports = {createChannel, runChannel};
