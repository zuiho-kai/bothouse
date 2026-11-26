'use strict';
const {createHash} = require('node:crypto');
const {setImmediate: yieldTurn} = require('node:timers/promises');
const {BoundedTaskStore} = require('./task-store.cjs');
const {APP_URI, APP_SCRIPT_HASH, appResource} = require('./app-resource.cjs');
const MAX_TEXT = 65536, MAX_BYTES = 262144;
let dependencies;
function loadDependencies() {
  if (dependencies) return dependencies;
  const {McpServer} = require('@modelcontextprotocol/sdk/server/mcp.js');
  const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
  const {InMemoryTransport} = require('@modelcontextprotocol/sdk/inMemory.js');
  const {CreateTaskResultSchema, CallToolResultSchema} = require('@modelcontextprotocol/sdk/types.js');
  const {z} = require('zod');
  const inputSchema = {text: z.string().max(MAX_TEXT), label: z.string().min(1).max(100).default('Text artifact')};
  const tool = {title: 'Inspect a text artifact', description: 'Compute bytes, line count and SHA-256 of supplied UTF-8 text. No file access, commands or model calls. Completion means this inspection finished, not that an agent task succeeded.', inputSchema, annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false}, execution: {taskSupport: 'required'}, _meta: {ui: {resourceUri: APP_URI, visibility: ['model', 'app']}}};
  return dependencies = {McpServer, Client, InMemoryTransport, CreateTaskResultSchema, CallToolResultSchema, tool};
}

async function inspectText({text, label}, signal, yieldWork = yieldTurn) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > MAX_BYTES) throw Error('Text exceeds the UTF-8 byte limit.');
  const hash = createHash('sha256');
  // Yield between chunks so cancellation interrupts actual work, not just a badge.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    await yieldWork(); if (signal.aborted) throw Error('Inspection cancelled.');
    hash.update(bytes.subarray(offset, offset + 1024));
  }
  if (signal.aborted) throw Error('Inspection cancelled.');
  let jsonValid = false;
  try {JSON.parse(text); jsonValid = true;} catch { /* Plain text is valid input. */ }
  const structuredContent = {label, bytes: bytes.length, lines: text ? text.split(/\r\n|\r|\n/).length : 0, sha256: hash.digest('hex'), jsonValid, preview: text.slice(0, 32768), truncated: text.length > 32768, verification: 'supplied-text-only'};
  return {content: [{type: 'text', text: `${label}: ${structuredContent.bytes} UTF-8 bytes; SHA-256 ${structuredContent.sha256}. This checks the supplied text only.`}], structuredContent};
}

function createExtensionsServer({onChange, yieldWork, limit} = {}) {
  const {McpServer, tool} = loadDependencies();
  const store = new BoundedTaskStore({onChange, limit});
  const server = new McpServer({name: 'agent-arcade-artifacts', version: '0.1.0'}, {capabilities: {tasks: {list: {}, cancel: {}, requests: {tools: {call: {}}}}}, taskStore: store, maxToolInputElements: 10});
  const work = new Set();
  server.registerResource('text-inspection-ui', APP_URI, {mimeType: 'text/html;profile=mcp-app', description: 'Bundled, offline text result viewer'}, async () => ({contents: [appResource()]}));
  server.experimental.tasks.registerToolTask('inspect_text', tool, {
    createTask: async (args, extra) => {
      const task = await extra.taskStore.createTask({ttl: extra.taskRequestedTtl, pollInterval: 250});
      const promise = (async () => {
        // Start after CreateTaskResult can return to the requester.
        await yieldTurn();
        try {
          const result = await inspectText(args, store.signal(task.taskId, extra.sessionId), yieldWork);
          await extra.taskStore.storeTaskResult(task.taskId, 'completed', result);
        } catch (error) {
          if ((await store.getTask(task.taskId, extra.sessionId))?.status !== 'working') return;
          await extra.taskStore.storeTaskResult(task.taskId, 'failed', {isError: true, content: [{type: 'text', text: error.message === 'Text exceeds the UTF-8 byte limit.' ? error.message : 'Text inspection failed; no agent process was affected.'}]}).catch(() => {});
        }
      })();
      work.add(promise); void promise.finally(() => work.delete(promise));
      return {task};
    },
    getTask: async (_args, extra) => extra.taskStore.getTask(extra.taskId),
    getTaskResult: async (_args, extra) => extra.taskStore.getTaskResult(extra.taskId),
  });
  return {server, store, close: async () => {store.close(); await Promise.allSettled([...work]); await server.close();}};
}

async function createLocalExtensions(options = {}) {
  const runtime = createExtensionsServer(options);
  const {Client, InMemoryTransport, CreateTaskResultSchema, CallToolResultSchema} = loadDependencies();
  const client = new Client({name: 'agent-arcade-desktop', version: '0.1.0'}, {capabilities: {tasks: {}, extensions: {'io.modelcontextprotocol/ui': {mimeTypes: ['text/html;profile=mcp-app']}}}});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport); await client.connect(clientTransport);
  return {
    inspect: async input => (await client.request({method: 'tools/call', params: {name: 'inspect_text', arguments: input, task: {ttl: 60000}}}, CreateTaskResultSchema)).task,
    list: async () => {const tasks = []; let cursor; do {const page = await client.experimental.tasks.listTasks(cursor); tasks.push(...page.tasks); cursor = page.nextCursor;} while (cursor); return tasks;},
    get: id => client.experimental.tasks.getTask(id),
    result: id => client.experimental.tasks.getTaskResult(id, CallToolResultSchema, {timeout: 10000}),
    cancel: id => client.experimental.tasks.cancelTask(id),
    resource: async () => (await client.readResource({uri: APP_URI})).contents[0],
    close: async () => {await client.close(); await runtime.close();},
  };
}
module.exports = {createExtensionsServer, createLocalExtensions, inspectText, APP_URI, APP_SCRIPT_HASH, MAX_TEXT, MAX_BYTES};
