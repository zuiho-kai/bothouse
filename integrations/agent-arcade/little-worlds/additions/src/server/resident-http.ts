import type {IncomingMessage,ServerResponse} from 'node:http';
import type {planetResidents} from './planet-residents.ts';
import {RequestError} from './errors.ts';

export async function readBody(req:IncomingMessage,limit:number){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){
    const bytes=Buffer.from(chunk);size+=bytes.length;
    if(size>limit)throw new RequestError(413,'Request too large.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function jsonBody(req:IncomingMessage,limit:number){
  const text=await readBody(req,limit);
  let body;
  try{body=JSON.parse(text);}catch{throw new RequestError(400,'Invalid JSON.');}
  if(!body||Array.isArray(body)||typeof body!=='object')throw new RequestError(400,'Expected an object.');
  return body as Record<string,unknown>;
}

// Host handoff and a same-cookie, native form for standalone use. All interpolated
// values below are server-generated UUIDs or hexadecimal credentials.
export async function residentSettings(req:IncomingMessage,res:ServerResponse,
  residents:ReturnType<typeof planetResidents>,owner:string){
  const planet=residents.owned(owner);
  if(!planet)throw new RequestError(409,'Claim your home planet before connecting residents.');
  let token='';
  if(req.method==='POST'){
    if(!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host)
      throw new RequestError(403,'Use this world’s own page.');
    if(!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
      throw new RequestError(415,'Use the connection form.');
    const form=new URLSearchParams(await readBody(req,512));
    if(form.get('planet')!==planet)throw new RequestError(409,'Your home planet changed.');
    if(form.get('action')==='connect')token=residents.connect(owner,planet).token;
    else if(form.get('action')==='disconnect')residents.disconnect(owner,planet,form.get('sourceId'));
    else throw new RequestError(400,'Choose a connection action.');
  }else if(req.method!=='GET')throw new RequestError(405,'Method not allowed.');
  const form=(action:string,label:string,id='')=>`<form method="post"><input type="hidden" name="planet" value="${planet}"><input type="hidden" name="action" value="${action}"><input type="hidden" name="sourceId" value="${id}"><button>${label}</button></form>`;
  const slots=residents.connections(owner,planet);
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'"});
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>我的星球居民</title><main><a href="/">返回星球</a><h1>我的星球居民</h1>
<p>连接你管理的 Bothouse 后，到访朋友可以看到获准居民的名字、形象和当前活动。解除连接会从星球移除该来源的居民。</p>
${token?`<p>将下面的专用连接码交给自己电脑上的居民发布端。这段代码只在这里显示一次。</p><textarea readonly aria-label="专用连接码" rows="3" cols="36">${token}</textarea>`:form('connect','连接我的 Bothouse')}
${slots.map(s=>form('disconnect','解除连接 '+String(s.id).slice(0,8),String(s.id))).join('')}</main></html>`);
}
