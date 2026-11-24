'use strict';

// The bridge's [management] listener serves its own web UI and handles its own login.
// Never pass a URL, a configuration value, or a Bothouse credential through renderer IPC.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {worldResidentControls}=require('./world-resident-controls.cjs');
const run = promisify(execFile);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const outcomes = new Set(['config', 'offline', 'identity', 'dashboard', 'cancelled', 'login', 'friends-offline']);
const localFile = file => typeof file === 'string' && /^[a-z]:[\\/]/i.test(file);

function defaultConfig(home=os.homedir(), dataDir=process.env.BOTHOUSE_DATA_DIR) {
  const preferred = path.join(home, '.bothouse');
  const legacy = path.join(home, '.cc-connect');
  const selected = dataDir ? dataDir.replace(/^~(?=[\\/]|$)/u,home)
    : !fs.existsSync(preferred) && fs.existsSync(legacy) ? legacy : preferred;
  return path.join(selected,'config.toml');
}

// Accept the ordinary scalar form written by Bothouse. Unsupported, missing or
// ambiguous fields fail closed. Ignore apparent table headers inside multiline strings.
function readAddress(text) {
  let multiline, active=false, seen=false;
  const fields = new Map();
  for (const line of text.replace(/^\uFEFF/u,'').split(/\r?\n/u)) {
    if (multiline) {
      if (line.includes(multiline)) multiline=undefined;
      continue;
    }
    if (/^\s*#/u.test(line)) continue;
    const start = line.match(/^\s*[\w.-]+\s*=\s*("""|''')/u);
    if (start) { if (!line.slice(start[0].length).includes(start[1])) multiline=start[1]; continue; }
    if (/^\s*\[/u.test(line)) {
      active = /^\s*\[management\]\s*(?:#.*)?$/u.test(line);
      if(active && seen) fail('config');
      if(active) seen=true;
    } else if (active) {
      const match=line.match(/^\s*(enabled|host|port)\s*=\s*([^#]+?)(?:\s*#.*)?$/u);
      if(match) {
        if(fields.has(match[1])) fail('config');
        fields.set(match[1],match[2].trim());
      }
    }
  }
  const host = fields.get('host')?.match(/^(['"])(127\.0\.0\.1|::1)\1$/u)?.[2];
  const port = Number(fields.get('port'));
  if(fields.get('enabled')!=='true' || !host || !/^\d{1,5}$/u.test(fields.get('port')) || port<1 || port>65535) fail('config');
  return {host,port,origin:'http://'+(host==='::1'?'[::1]':host)+':'+port};
}

async function listener({port,host}) {
  // Only inspect listeners for this one configured port. Return neither the
  // process command line nor other local connections. No executable is launched.
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';$owners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Where-Object { $_.LocalAddress -eq '${host}' });if($owners.Count -ne 1){exit 1};$p=Get-Process -Id $owners[0].OwningProcess;[pscustomobject]@{pid=$p.Id;file=$p.Path;started=$p.StartTime.ToUniversalTime().Ticks.ToString()}|ConvertTo-Json -Compress`;
  const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  let identity;
  try {
    const {stdout}=await run(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16384});
    identity=JSON.parse(stdout.trim());
  } catch { fail('offline'); }
  if(!localFile(identity.file)||! /^(?:bothouse(?:-windows(?:-amd64)?)?|cc-connect)\.exe$/i.test(path.basename(identity.file)) ||
    !Number.isInteger(identity.pid)||identity.pid<=0||!/^\d+$/u.test(identity.started)) fail('identity');
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(identity.file)) hash.update(chunk);
  return {...identity,sha256:hash.digest('hex')};
}

async function dashboard(origin) {
  const options={redirect:'error',signal:AbortSignal.timeout(4000)};
  try{
    const status=await fetch(origin+'/api/v1/status',options);
    await status.body?.cancel();
    if (![401,403].includes(status.status)) fail('dashboard');
    const page=await fetch(origin+'/',options);
    if(!page.ok || !/^text\/html\b/i.test(page.headers.get('content-type')||'')) {await page.body?.cancel();fail('dashboard');}
    const reader=page.body.getReader();
    const chunks=[]; let size=0;
    try{
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;if(size>128*1024)fail('dashboard');chunks.push(value);
      }
    }finally{await reader.cancel();}
    const html=Buffer.concat(chunks).toString('utf8');
    if(!/<title>\s*bothouse\s*<\/title>/i.test(html)||!/<script\b[^>]+src=["'][^"']+\.js["']/i.test(html))fail('dashboard');
  }catch{fail('dashboard');}
}

const belongs=(value,origin)=>{
  try {
    const url=new URL(value);
    return !url.username && !url.password && (url.origin===origin ||
      (['ws:','wss:'].includes(url.protocol) && url.protocol.replace('ws','http')+'//'+url.host===origin));
  }catch{return false;}
};
const sameProcess=(a,b)=>a.pid===b.pid&&a.started===b.started&&a.file===b.file&&a.sha256===b.sha256;

function worldOrigin(value) {
  let url;
  try { url=new URL(value); } catch { fail('config'); }
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||
    !(url.protocol==='https:' || (loopback && url.protocol==='http:')))fail('config');
  return url.origin;
}

async function worldTarget(origin,socialOrigin,friends) {
  let response;
  try {
    response=await friends.fetch(socialOrigin+'/api/v1/me',{
      credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
    });
    if(response.status===401)fail('login');
    if(!response.ok)fail('friends-offline');
    const {user}=await response.json();
    if(typeof user?.number!=='string'||!/^[a-z0-9_]{4,24}$/u.test(user.number))fail('friends-offline');
    const scope=JSON.stringify([socialOrigin,user.number,origin]);
    return {account:user.number,origin,partition:'persist:little-worlds-'+crypto.createHash('sha256').update(scope).digest('hex')};
  } catch(error) {
    if(error.code==='login')throw error;
    fail('friends-offline');
  } finally {
    if(response && !response.bodyUsed)await response.body?.cancel();
  }
}

function mountBothouse({window,WebContentsView,session,dialog,profile,language,inspect=listener,littleWorldsOrigin,socialOrigin}) {
  const bindingFile=path.join(profile,'bothouse-management.json');
  const tr=(cn,en)=>language()==='zh'?cn:en;
  async function managementTarget(action,current) {
    let saved;
    try{saved=JSON.parse(await fs.promises.readFile(bindingFile,'utf8'));}catch(e){if(e.code!=='ENOENT'&&action!=='choose')fail('identity');}
    let file=saved?.config || defaultConfig();
    if(action==='choose'){
      const result=await dialog.showOpenDialog(window,{title:tr('选择本机 Bothouse 配置','Choose the local Bothouse configuration'),defaultPath:file,
        properties:['openFile','dontAddToRecent'],filters:[{name:'Bothouse TOML',extensions:['toml']}]});
      if(result.canceled||!current())fail('cancelled');
      file=result.filePaths[0];
    }
    if(!localFile(file)||path.extname(file).toLowerCase()!=='.toml')fail('config');
    const stat=await fs.promises.stat(file).catch(()=>fail('config'));
    if(!stat.isFile()||stat.size>4*1024*1024)fail('config');
    const address=readAddress(await fs.promises.readFile(file,'utf8'));
    const identity=await inspect(address);
    const matches=saved?.config===file && saved.executable===identity.file && saved.sha256===identity.sha256 && saved.origin===address.origin;
    if(!matches){
      if(saved&&action!=='choose')fail('identity');
      if(!current())fail('cancelled');
      const result=await dialog.showMessageBox(window,{
        type:'question',buttons:[tr('取消','Cancel'),tr('信任并打开','Trust and open')],cancelId:0,defaultId:0,noLink:true,
        message:tr('允许打开这个本机 Bothouse 管理界面？','Open this local Bothouse management dashboard?'),
        detail:[file,identity.file,address.origin,'SHA-256 '+identity.sha256].join('\n')
      });
      if(result.response!==1||!current())fail('cancelled');
    }
    if(!current())fail('cancelled');
    await dashboard(address.origin);
    if(!sameProcess(identity,await inspect(address)))fail('identity');
    if(!current())fail('cancelled');
    if(!matches){
      const temp=bindingFile+'.'+crypto.randomUUID()+'.tmp';
      try{
        await fs.promises.writeFile(temp,JSON.stringify({config:file,executable:identity.file,sha256:identity.sha256,origin:address.origin}),{flag:'wx',mode:0o600});
        if(!current())fail('cancelled');
        await fs.promises.rename(temp,bindingFile);
      }finally{await fs.promises.rm(temp,{force:true}).catch(()=>{});}
    }
    if(!current())fail('cancelled');
    // In-memory storage belongs only to this authenticated executable lifetime and origin.
    const partition='bothouse-ui-'+crypto.createHash('sha256').update([address.origin,identity.sha256,identity.pid,identity.started].join('|')).digest('hex');
    return {origin:address.origin,partition,pid:identity.pid};
  }
  let guest, epoch=0, opening, detachAccountWatch, top=44;
  function fit(){
    if(!guest||window.isDestroyed())return;
    const [width,height]=window.getContentSize();
    const y=Math.min(height,Math.ceil(top*window.webContents.getZoomFactor()));
    guest.view.setBounds({x:0,y,width,height:height-y});
  }
  function close(){
    ++epoch;
    detachAccountWatch?.();detachAccountWatch=undefined;
    if(!guest)return;
    const previous=guest;guest=undefined;
    if(!window.isDestroyed())window.contentView.removeChildView(previous.view);
    if(!previous.view.webContents.isDestroyed())previous.view.webContents.close();
  }
  window.on('resize',fit);
  window.on('closed',close);
  window.webContents.on('render-process-gone',close);
  window.webContents.on('did-start-navigation',(_e,_url,inPlace,main)=>{if(main&&!inPlace)close();});
  return async value=>{
    if(value?.action==='close'){close();return 'closed';}
    if(['residents-open','residents-connect','residents-disconnect'].includes(value?.action)){
      return guest?.residents ? guest.residents(value.action.slice('residents-'.length)) : {state:'closed'};
    }
    if(value?.action==='world-layout'){
      if(guest?.residents && Number.isFinite(value.headerBottom)&&value.headerBottom>=1&&value.headerBottom<=200){
        top=value.headerBottom;fit();
      }
      return;
    }
    if(!['open','choose','world'].includes(value?.action)||!Number.isFinite(value.headerBottom)||value.headerBottom<1||value.headerBottom>200)return 'config';
    if(opening===epoch)return 'busy';
    close();
    const seq=opening=epoch;
    const current=()=>seq===epoch&&!window.isDestroyed();
    try{
      const world=value.action==='world';
      let target;
      if(world){
        const origin=worldOrigin(littleWorldsOrigin);
        const friends=session.fromPartition('persist:arcade-social');
        const hostname=new URL(socialOrigin).hostname;
        const accountChanged=(_event,cookie)=>{
          if(cookie.name!=='arcade_social'||!current())return;
          const domain=cookie.domain?.replace(/^\./u,'');
          if(domain && (hostname===domain || hostname.endsWith('.'+domain))){
            close();
            window.webContents.send('arcade:storeBothouseReturn');
          }
        };
        friends.cookies.on('changed',accountChanged);
        detachAccountWatch=()=>friends.cookies.removeListener('changed',accountChanged);
        target=await worldTarget(origin,socialOrigin,friends);
      } else target=await managementTarget(value.action,current);
      if(!current())fail('cancelled');
      const {partition,origin}=target;
      const isolated=session.fromPartition(partition,{cache:false});
      if(!world || origin.startsWith('http:'))await isolated.setProxy({mode:'direct'});
      if(!current())fail('cancelled');
      isolated.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
      isolated.setPermissionCheckHandler(()=>false);
      isolated.setDevicePermissionHandler(()=>false);
      let rollbackPending=false;
      isolated.webRequest.onBeforeRequest((details,cb)=>{
        let alive=current();
        if(alive&&target.pid)try{process.kill(target.pid,0);}catch{alive=false;}
        // The old view may close during its first opt-in. Allow only the
        // host's conditional rollback in this same game partition.
        const rollback=rollbackPending && !details.webContentsId && details.method==='POST' &&
          details.url===origin+'/api/app-residents';
        cb({cancel:!(alive||rollback) || !belongs(details.url,origin)});
      });
      const view=new WebContentsView({webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:false,
        webSecurity:true,webviewTag:false,navigateOnDragDrop:false}});
      guest={view};top=value.headerBottom;
      if(world){
        guest.residents=worldResidentControls({world:isolated,worldOrigin:origin,socialOrigin,
          friends:session.fromPartition('persist:arcade-social'),account:target.account,current,
          onRollback:value=>{rollbackPending=value;}});
      }
      const wc=view.webContents;
      wc.on('before-input-event',(event,input)=>{
        if(current()&&input.type==='keyDown'&&input.alt&&!input.control&&!input.meta&&input.key==='ArrowLeft'){
          event.preventDefault();window.webContents.send('arcade:storeBothouseReturn');
        }
      });
      wc.setWindowOpenHandler(()=>({action:'deny'}));
      const denyDownload=event=>event.preventDefault();
      isolated.on('will-download',denyDownload);
      wc.once('destroyed',()=>isolated.removeListener('will-download',denyDownload));
      for(const event of ['will-navigate','will-frame-navigate','will-redirect'])wc.on(event,(e,url)=>{
        const destination=typeof url==='string'?url:e.url;
        if(!belongs(destination,origin))e.preventDefault();
      });
      wc.on('render-process-gone',()=>{if(current()){close();window.webContents.send('arcade:storeBothouseUnavailable');}});
      view.setVisible(false);window.contentView.addChildView(view);fit();
      const deadline=world?setTimeout(()=>{if(current()&&!wc.isDestroyed())wc.stop();},15000):undefined;
      try { await wc.loadURL(origin+'/'); } finally { clearTimeout(deadline); }
      if(!current())fail('cancelled');
      // The SPA may finish its lazy route after did-finish-load. Wait for a
      // real login form or dashboard navigation instead of accepting a spinner.
      const rendered=world
        ? await wc.executeJavaScript("document.title.startsWith('Little Worlds') && !!document.querySelector('#welcome-start,canvas')")
        : await wc.executeJavaScript(`new Promise(resolve=>{
        const ready=()=>document.title.toLowerCase().includes('bothouse') &&
          !!document.querySelector('#root input[type=password], #root a[href="/roles"]');
        if(ready()){resolve(true);return;}
        const finish=ok=>{observer.disconnect();clearTimeout(timer);resolve(ok);};
        const observer=new MutationObserver(()=>{if(ready())finish(true);});
        const timer=setTimeout(()=>finish(false),8000);
        observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
      })`);
      if(!current())fail('cancelled');
      if(!rendered)fail(world?'offline':'dashboard');
      view.setVisible(true);wc.focus();
      return 'ready';
    }catch(error){
      if(current())close();
      return outcomes.has(error.code)?error.code:'offline';
    }finally{if(opening===seq)opening=undefined;}
  };
}

module.exports={defaultConfig,readAddress,listener,mountBothouse,worldOrigin};
