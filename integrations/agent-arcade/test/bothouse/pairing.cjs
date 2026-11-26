'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fork,execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{once}=require('node:events');
const [root,run,python]=process.argv.slice(2);
const env={...process.env,SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:'0',SOCIAL_DB:path.join(run,'social.sqlite'),BOTHOUSE_DATA_DIR:run,SOCIAL_BOTHOUSE_PYTHON:python};
let server,origin;
async function start(){server=fork(path.join(root,'social/server/main.cjs'),[],{env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});const [{port}]=await once(server,'message');origin='http://127.0.0.1:'+port;}
async function stop(){if(!server)return;const exit=once(server,'exit');server.kill();await exit;server=null;}
function logged(login){
 let cookie;
 const api=async(route,body,expected=200)=>{
   const r=await fetch(origin+'/api/v1/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie&&{cookie})},...(body&&{body:JSON.stringify(body)})});
   if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
   const v=await r.json();assert.equal(r.status,expected,route+' '+JSON.stringify(v.error));return v;
 };
 return {api,register:()=>api('register',{number:login,password:randomUUID(),displayName:login}),login};
}
function operator(...args){return execFileSync(process.execPath,[path.join(root,'social/server/bothouse/pair.cjs'),...args],{env,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
async function roles(w){const r=await w.api('ai-contacts');return r.contacts.map(x=>x.id).sort();}
async function main(){
 await start();
 try{
 const a=logged('first_alpha'),b=logged('first_beta'),c=logged('first_gamma');for(const u of [a,b,c])await u.register();
 assert.deepEqual(await roles(a),[]);assert.deepEqual(await roles(b),[]);
 const receipt={prePairCounts:[0,0],arcadeIdsInUpstream:0};
 if(!fs.existsSync(path.join(root,'social/server/bothouse/pair.cjs'))){
   receipt.baseline=true;fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt));return;
 }
 const mint=(w,...args)=>JSON.parse(operator('issue',w.login,...args)).code;
 const redeem=(w,code,status=200,extra={})=>w.api('ai-contacts/pair',{expectedAccount:w.login,code,...extra},status);
 const codeA=mint(a,'--identity','upstream-user-12');
 await redeem(b,codeA,409);await redeem(a,codeA,409,{expectedAccount:b.login});
 await redeem(a,codeA);await redeem(a,codeA,409);
 const duo=['tide-east','tide-west'];
 assert.deepEqual(await roles(a),duo);assert.deepEqual(await roles(b),[]);
 assert.throws(()=>mint(b,'--projects','private-north'));
 const codeB=mint(b,'--projects','owner-lamp','owner-bell');await redeem(b,codeB);
 assert.deepEqual(await roles(b),['owner-bell','owner-lamp']);assert.deepEqual(await roles(c),[]);
 const contact=(await a.api('ai-contacts')).contacts.find(x=>x.id==='tide-east');
 const chat=(await a.api('ai-contacts/start',{expectedAccount:a.login,number:contact.number})).conversation.id;
 const msg=(w,chat,text)=>w.api('conversations/'+chat+'/messages',{text,clientId:randomUUID()});
 assert.equal((await msg(a,chat,'你好')).reply.text,'tide-east 你好');
 const bContact=(await b.api('ai-contacts')).contacts.find(x=>x.id==='owner-lamp');
 const bChat=(await b.api('ai-contacts/start',{expectedAccount:b.login,number:bContact.number})).conversation.id;
 assert.equal((await msg(b,bChat,'你好')).reply.text,'owner-lamp 你好');
 await stop();await start();assert.deepEqual(await roles(a),duo);
 const pending=msg(a,chat,'hold');
 await new Promise(r=>setTimeout(r,650));
 fs.writeFileSync(path.join(run,'restrict'),'');
 for(let i=0;i<50&&!fs.existsSync(path.join(run,'restricted'));i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(fs.existsSync(path.join(run,'restricted')));
 assert.equal((await pending).bothouseStatus,'cancelled');
 assert.deepEqual(await roles(a),['tide-west']);assert.deepEqual(await roles(b),['owner-lamp']);
 const bPending=msg(b,bChat,'hold');await new Promise(r=>setTimeout(r,600));
 await b.api('ai-contacts/unpair',{expectedAccount:b.login});assert.equal((await bPending).bothouseStatus,'cancelled');assert.deepEqual(await roles(b),[]);
 await c.api('ai-contacts/pair',{expectedAccount:c.login,identity:'upstream-user-12',projects:['tide-west']},400);
 receipt.operatorModes={verifiedUpstreamIdentity:duo,explicitLocalProjects:['owner-bell','owner-lamp']};
 receipt.transportUsers=[fs.readFileSync(path.join(run,'seen-tide-east'),'utf8'),fs.readFileSync(path.join(run,'seen-owner-lamp'),'utf8')];
 assert.deepEqual(receipt.transportUsers,['upstream-user-12','arcade:first_beta']);
 receipt.unpairedThird=[];receipt.directReplies=['tide-east 你好','owner-lamp 你好'];receipt.restarted=true;
 receipt.livePolicy={inheritedAfterChange:await roles(a),removedWhenRestricted:true};receipt.wrongAccountAndReplayRejected=true;
 receipt.lateRepliesAfterRoleChangeOrUnpair=0;
 fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
 }finally{await stop();fs.writeFileSync(path.join(run,'done'),'');}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
