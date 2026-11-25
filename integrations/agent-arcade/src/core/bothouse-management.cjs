'use strict';

// The bridge's [management] listener serves its own web UI and handles its own login.
// Never pass a URL, a configuration value, or a Bothouse credential through renderer IPC.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const outcomes = new Set(['config', 'offline', 'identity', 'dashboard', 'cancelled']);
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
      (url.protocol==='ws:' && 'http://'+url.host===origin));
  }catch{return false;}
};
const sameProcess=(a,b)=>a.pid===b.pid&&a.started===b.started&&a.file===b.file&&a.sha256===b.sha256;

function mountBothouse({window,WebContentsView,session,dialog,profile,language,inspect=listener}) {
  const bindingFile=path.join(profile,'bothouse-management.json');
  const tr=(cn,en)=>language()==='zh'?cn:en;
  let guest, epoch=0, running=false, top=44;
  function fit(){
    if(!guest||window.isDestroyed())return;
    const [width,height]=window.getContentSize();
    const y=Math.min(height,Math.ceil(top*window.webContents.getZoomFactor()));
    guest.view.setBounds({x:0,y,width,height:height-y});
  }
  function close(){
    ++epoch;
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
    if(!['open','choose'].includes(value?.action)||!Number.isFinite(value.headerBottom)||value.headerBottom<1||value.headerBottom>200)return 'config';
    if(running)return 'busy';
    running=true;close();
    const seq=epoch;
    const current=()=>seq===epoch&&!window.isDestroyed();
    let newView;
    try{
      let saved;
      try{saved=JSON.parse(await fs.promises.readFile(bindingFile,'utf8'));}catch(e){if(e.code!=='ENOENT'&&value.action!=='choose')fail('identity');}
      let file=saved?.config || defaultConfig();
      if(value.action==='choose'){
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
        if(saved&&value.action!=='choose')fail('identity');
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
      const isolated=session.fromPartition(partition,{cache:false});
      await isolated.setProxy({mode:'direct'});
      if(!current())fail('cancelled');
      isolated.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
      isolated.setPermissionCheckHandler(()=>false);
      isolated.setDevicePermissionHandler(()=>false);
      isolated.webRequest.onBeforeRequest((details,cb)=>{
        let alive=current();
        if(alive)try{process.kill(identity.pid,0);}catch{alive=false;}
        cb({cancel:!alive||!belongs(details.url,address.origin)});
      });
      const view=new WebContentsView({webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:false,
        webSecurity:true,webviewTag:false,navigateOnDragDrop:false}});
      newView=view;guest={view};top=value.headerBottom;
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
        const target=typeof url==='string'?url:e.url;
        if(!belongs(target,address.origin))e.preventDefault();
      });
      wc.on('render-process-gone',()=>{if(current()){close();window.webContents.send('arcade:storeBothouseUnavailable');}});
      view.setVisible(false);window.contentView.addChildView(view);fit();
      await wc.loadURL(address.origin+'/');
      if(!current())fail('cancelled');
      // The SPA may finish its lazy route after did-finish-load. Wait for a
      // real login form or dashboard navigation instead of accepting a spinner.
      const rendered=await wc.executeJavaScript(`new Promise(resolve=>{
        const ready=()=>document.title.toLowerCase().includes('bothouse') &&
          !!document.querySelector('#root input[type=password], #root a[href="/roles"]');
        if(ready()){resolve(true);return;}
        const finish=ok=>{observer.disconnect();clearTimeout(timer);resolve(ok);};
        const observer=new MutationObserver(()=>{if(ready())finish(true);});
        const timer=setTimeout(()=>finish(false),8000);
        observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
      })`);
      if(!rendered)fail('dashboard');
      view.setVisible(true);wc.focus();
      return 'ready';
    }catch(error){
      if(guest?.view===newView && newView)close();
      return outcomes.has(error.code)?error.code:'offline';
    }finally{running=false;}
  };
}

module.exports={defaultConfig,readAddress,listener,mountBothouse};
