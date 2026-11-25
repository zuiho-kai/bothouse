(() => {
  'use strict';
  let initialized = false, inspection = null, format = 'text';
  const title = document.getElementById('artifact-title');
  const facts = document.getElementById('artifact-facts');
  const body = document.getElementById('artifact-body');
  const jsonButton = document.getElementById('artifact-json');
  const send = message => parent.postMessage({jsonrpc: '2.0', ...message}, '*');
  const applyHostContext = context => {
    if (['light','dark'].includes(context?.theme)) {document.documentElement.dataset.colorScheme=context.theme;document.documentElement.style.colorScheme=context.theme;}
    if (['en','zh-CN'].includes(context?.locale)) document.documentElement.lang=context.locale;
  };
  const render = () => {
    if (!inspection) return;
    title.textContent = inspection.label;
    facts.textContent = `${inspection.bytes} bytes · ${inspection.lines} lines · SHA-256 ${inspection.sha256}`;
    let displayed = inspection.preview;
    if (format === 'json' && inspection.jsonValid && !inspection.truncated) {
      try {displayed = JSON.stringify(JSON.parse(inspection.preview), null, 2);} catch { /* Keep the literal preview for invalid or deeply nested data. */ }
    }
    body.textContent = displayed;
    jsonButton.disabled = !inspection.jsonValid || inspection.truncated;
    document.getElementById('artifact-limit').hidden = !inspection.truncated;
  };
  document.getElementById('artifact-text').addEventListener('click', () => {format = 'text'; render();});
  jsonButton.addEventListener('click', () => {format = 'json'; render();});
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.jsonrpc !== '2.0') return;
    const message = event.data;
    if (message.id === 'arcade-initialize' && message.result?.protocolVersion === '2026-01-26' && !initialized) {
      applyHostContext(message.result.hostContext);initialized = true; send({method: 'ui/notifications/initialized'}); return;
    }
    if (message.method === 'ping' && message.id !== undefined) {send({id: message.id, result: {}}); return;}
    if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
      inspection = null; body.textContent = ''; send({id: message.id, result: {}}); return;
    }
    if(initialized && message.method==='ui/notifications/host-context-changed'){applyHostContext(message.params);return;}
    if (!initialized || message.method !== 'ui/notifications/tool-result') return;
    const value = message.params?.structuredContent;
    if (!value || typeof value.label !== 'string' || value.label.length > 100 || typeof value.preview !== 'string' || value.preview.length > 32768 || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 262144 || !Number.isSafeInteger(value.lines) || value.lines < 0 || value.lines > 65537 || typeof value.jsonValid !== 'boolean' || typeof value.truncated !== 'boolean') return;
    inspection = value; format = 'text'; render();
  });
  send({id: 'arcade-initialize', method: 'ui/initialize', params: {protocolVersion: '2026-01-26', appInfo: {name: 'Agent Arcade result viewer', version: '0.1.0'}, appCapabilities: {availableDisplayModes: ['inline']}}});
})();
