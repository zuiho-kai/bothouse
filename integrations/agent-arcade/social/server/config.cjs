'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {loadPublicSource}=require('./public-source.cjs');
function databasePath() {
  return path.resolve(process.env.SOCIAL_DB || path.join(os.homedir(),'.agent-arcade-social','social.sqlite'));
}
function privacyContact(env) {
  const name=env.SOCIAL_PUBLIC_OPERATOR_NAME?.trim();
  const contact=env.SOCIAL_PUBLIC_PRIVACY_CONTACT?.trim();
  if(!name&&!contact)return undefined;
  if(!name||Array.from(name).length>120||/[\x00-\x1f\x7f]/u.test(name))
    throw new Error('Invalid SOCIAL_PUBLIC_OPERATOR_NAME');
  if(!contact||contact.length>500||/[\s\\\x00-\x1f\x7f]/u.test(contact))
    throw new Error('Invalid SOCIAL_PUBLIC_PRIVACY_CONTACT');
  const email=/^[a-z0-9_+-]+(?:\.[a-z0-9_+-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
  if(email.test(contact))return {name,href:'mailto:'+contact,label:contact};
  let url;
  try {url=new URL(contact);} catch {}
  if(!url||!/^https:\/\//i.test(contact)||url.protocol!=='https:'||url.username||url.password)
    throw new Error('SOCIAL_PUBLIC_PRIVACY_CONTACT must be a public email address or HTTPS URL');
  return {name,href:url.href,label:url.href};
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
  return {host,port,publicOrigin,filename,privacyContact:privacyContact(process.env),
    publicSource:loadPublicSource(path.join(__dirname,'../..'))};
}
module.exports = {config,databasePath,privacyContact};
