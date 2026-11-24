'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
function databasePath() {
  return path.resolve(process.env.SOCIAL_DB || path.join(os.homedir(),'.agent-arcade-social','social.sqlite'));
}
function config() {
  const host = process.env.SOCIAL_HOST || '127.0.0.1';
  const port = Number(process.env.SOCIAL_PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid SOCIAL_PORT');
  let publicOrigin;
  if (process.env.SOCIAL_PUBLIC_ORIGIN) {
    const url = new URL(process.env.SOCIAL_PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || ![url.origin,url.origin+'/'].includes(process.env.SOCIAL_PUBLIC_ORIGIN))
      throw new Error('SOCIAL_PUBLIC_ORIGIN must be an HTTPS origin without a path');
    if (!['127.0.0.1','::1'].includes(host)) throw new Error('Bind HTTPS proxy upstream to loopback');
    publicOrigin = url.origin;
  }
  const filename = databasePath();
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  return {host,port,publicOrigin,filename};
}
module.exports = {config,databasePath};
