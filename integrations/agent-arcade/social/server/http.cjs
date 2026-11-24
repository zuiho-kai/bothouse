'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {fail,number} = require('./store.cjs');
const {current,makeAuth} = require('./auth.cjs');

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415,'content_type','请发送 JSON');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 65536) fail(413,'body_limit','请求过大');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400,'json','JSON 格式有误'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'json','需要 JSON 对象');
  return value;
}
function dispatch(store,a,route,body,params) {
  const {method, parts:[root,id,action,msg,sub], parts} = route;
  const key = method + ' ' + parts.join('/');
  switch (key) {
    case 'GET me': return {user:store.user(a)};
    case 'GET users': return {user:store.user(number(params.get('number')))};
    case 'GET friends': return {friends:store.friends(a)};
    case 'GET friend-requests': return store.requests(a);
    case 'POST friend-requests': return {request:store.request(a,number(body.number))};
    case 'GET conversations': return {conversations:store.conversations(a)};
    case 'POST direct': {
      const direct = store.direct(a,number(body.number));
      if (!direct) fail(403,'friends_only','请先添加好友');
      return {conversation:store.conversation(a,direct.id)};
    }
    case 'POST groups': return {conversation:store.createGroup(a,body.title,body.memberNumbers)};
  }
  if (root === 'friend-requests' && parts.length === 3 && method === 'POST' && ['accept','decline'].includes(action))
    return store.decide(a,id,action === 'accept');
  if (root === 'groups' && parts.length === 3 && method === 'POST') {
    if (action === 'members') return {conversation:store.addMembers(a,id,body.memberNumbers)};
    if (action === 'leave') return store.remove(a,id,a,true);
    if (action === 'remove') return store.remove(a,id,number(body.number),false);
  }
  if (root === 'conversations') {
    if (parts.length === 2 && method === 'GET') return {conversation:store.conversation(a,id)};
    if (parts.length === 3 && action === 'messages') {
      if (method === 'GET') return {messages:store.history(a,id,params)};
      if (method === 'POST') return {message:store.send(a,id,body)};
    }
    if (parts.length === 5 && action === 'messages' && sub === 'report' && method === 'POST' && /^\d+$/.test(msg))
      return {report:store.report(a,id,msg,body.reason)};
  }
  fail(404,'route','没有这个接口');
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
async function serveClient(client,pathname,req,res) {
  if (!['GET','HEAD'].includes(req.method)) fail(405,'method','请求方法无效');
  let parts;
  try { parts = decodeURIComponent(pathname).split('/').filter(Boolean); } catch { fail(400,'path','路径有误'); }
  if (parts.some(p => p.startsWith('.') || /[\\:\x00]/.test(p))) fail(404,'asset','资源不存在');
  if (!parts.length) parts.push('index.html');
  const type = mime[path.extname(parts.at(-1))];
  if (!type) fail(404,'asset','资源不存在');
  let bytes;
  try {
    const root = await fs.realpath(client);
    const file = await fs.realpath(path.join(root,...parts));
    const relative = path.relative(root,file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail(404,'asset','资源不存在');
    bytes = await fs.readFile(file);
  } catch { fail(404,'asset','没有找到客户端资源'); }
  res.setHeader('Content-Type',type);
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
function createServer(store,{publicOrigin,client = path.join(__dirname,'../client')} = {}) {
  const auth = makeAuth(store,Boolean(publicOrigin));
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try {
      let origin;
      try { origin = new URL((publicOrigin ? 'https://' : 'http://') + req.headers.host); } catch { fail(400,'host','主机名无效'); }
      const host = origin.hostname.replace(/^\[|\]$/g,'');
      if (publicOrigin ? origin.origin !== publicOrigin : host !== 'localhost' && !net.isIP(host)) fail(403,'host','服务地址不匹配');
      if (req.headers.origin && req.headers.origin !== origin.origin) fail(403,'origin','站点来源不匹配');
      const url = new URL(req.url,origin);
      if (url.origin !== origin.origin) fail(400,'url','地址无效');
      if (url.pathname === '/healthz' && req.method === 'GET') {
        store.one('SELECT 1');
        res.setHeader('Content-Type','application/json');
        return res.end('{"ok":true}');
      }
      if (!url.pathname.startsWith('/api/')) return await serveClient(client,url.pathname,req,res);
      if (!url.pathname.startsWith('/api/v1/')) fail(404,'route','接口版本无效');
      const parts = url.pathname.slice(8).split('/');
      const key = parts.join('/');
      if (!['GET','POST'].includes(req.method)) fail(405,'method','请求方法无效');
      const body = req.method === 'POST' ? await jsonBody(req) : null;
      let result;
      if (req.method === 'POST' && ['register','login'].includes(key)) result = await auth.enter(key === 'register',body,req,res);
      else if (req.method === 'POST' && key === 'logout') result = auth.logout(req,res);
      else {
        const account = current(store,req);
        const handle = () => dispatch(store,account,{method:req.method,parts},body,url.searchParams);
        result = req.method === 'POST' ? store.transaction(handle) : handle();
      }
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify(result));
    } catch (error) {
      if (res.destroyed) return;
      if (!error.status) console.error('Social request failed',error.code || error.name);
      res.writeHead(error.status || 500,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:{code:error.status ? error.code : 'internal',message:error.status ? error.message : '服务器暂时无法处理请求'}}));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
module.exports = {createServer};
