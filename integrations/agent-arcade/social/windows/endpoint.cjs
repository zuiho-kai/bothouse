'use strict';

const isIanaExampleDomain=hostname=>/(?:^|\.)example\.(?:com|net|org)$/u.test(hostname);
const isLocalDnsName=hostname=>/(?:^|\.)(?:localhost|local|lan|test|invalid|example|internal|onion|home\.arpa)\.?$/u.test(hostname);

function serviceOrigin(value, mode) {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('Missing service origin.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      ![url.origin, url.origin + '/'].includes(value)) {
    throw new Error('Use a canonical origin without credentials or a path.');
  }
  if (mode === 'store' && isIanaExampleDomain(url.hostname)) {
    throw new Error('Store cannot use an IANA example domain. Use the deployed service HTTPS origin.');
  }
  const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u.test(url.hostname);
  if (mode === 'store' && isLocalDnsName(url.hostname)) {
    throw new Error('Store cannot use a local or reserved DNS name: ' + url.hostname + '. Use the deployed service HTTPS origin.');
  }
  if (mode === 'store' && url.protocol === 'https:' && dnsName) return url.origin;
  if (['test', 'test-signed'].includes(mode) && url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port) return url.origin;
  if (mode === 'test' && url.protocol === 'https:' && url.hostname === 'arcade-store.test' && url.port) return url.origin;
  throw new Error('Store requires an HTTPS DNS origin. Local tests use explicit loopback or the reserved HTTPS test host.');
}

module.exports = { serviceOrigin, isIanaExampleDomain, isLocalDnsName };
