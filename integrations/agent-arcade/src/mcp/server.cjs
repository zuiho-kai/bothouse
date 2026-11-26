'use strict';
// Optional, local stdio MCP server. No filesystem tools, remote connections,
// credential reads, model calls or permission changes.
const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {createExtensionsServer} = require('./extensions.cjs');
const runtime = createExtensionsServer();
runtime.server.connect(new StdioServerTransport()).catch(() => {process.stderr.write('Agent Arcade MCP startup failed.\n'); process.exitCode = 1;});
process.stdin.on('end', () => {void runtime.close();});
