'use strict';

const { serviceOrigin } = require('./endpoint.cjs');
const path = require('node:path');

const imageDownloadPath=/^\/api\/v1\/conversations\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/messages\/[1-9]\d{0,15}\/image\/download$/u;
const fileDownloadPath=/^\/api\/v1\/conversations\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/messages\/[1-9]\d{0,15}\/file\/download$/u;
const chatFragment=/^#chat\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

function createSocialView({ WebContentsView, session, configuration, saveImage, pickGroupCard, pickCrop, readSendShortcut, visitFriend, isActive=()=>false,
  spawnSnip=require('node:child_process').spawn, openExternal=url=>require('electron').shell.openExternal(url) }) {
  const origin = serviceOrigin(configuration.origin, configuration.mode);
  const {desktopVersion} = configuration;
  const browserSession = session.fromPartition('persist:arcade-social');
  const isTrusted = value => URL.canParse(value) && new URL(value).origin === origin;
  const onDownload = (event, item, initiator, frame) => {
    if(initiator!==contents||frame!==contents.mainFrame||!isActive()){
      event.preventDefault();
      return;
    }
    const raw=item.getURL(),chain=item.getURLChain();
    // This public archive is an ordinary user-selected save from the source page.
    // Do not give a general download capability to the Friends guest.
    if(frame?.url===origin+'/source.html'&&
        chain.length===1&&chain[0]===raw&&isTrusted(raw)&&item.getMimeType()==='application/zip'&&
        /^\/source\/[a-f0-9]{40}\/[a-f0-9]{64}\.zip$/u.test(raw.slice(origin.length))){
      item.setSaveDialogOptions({filters:[{name:'ZIP',extensions:['zip']}],properties:['dontAddToRecent']});
      return;
    }
    if(chain.length===1 && chain[0]===raw && isTrusted(raw) && item.getMimeType()==='application/octet-stream'){
      const url=new URL(raw),match=fileDownloadPath.exec(url.pathname);
      if(match&&/^\?account=[a-z0-9_]{4,24}$/u.test(url.search)&&!url.hash&&frame.url===origin+'/#chat/'+match[1]){
        const name=item.getFilename();
        if(name && Buffer.byteLength(name)<=240 && path.win32.basename(name)===name &&
            !/[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]|[. ]$/u.test(name) &&
            !/^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[0-9¹²³]) *(?:\.|$)/iu.test(name)){
          item.setSaveDialogOptions({title:'保存聊天文件',defaultPath:name,properties:['dontAddToRecent']});
          return;
        }
      }
    }
    event.preventDefault();
    if(!saveImage)return;
    const mime=item.getMimeType();
    if(chain.length!==1||chain[0]!==raw||!isTrusted(raw)||!['image/jpeg','image/png'].includes(mime))return;
    const url=new URL(raw), match=imageDownloadPath.exec(url.pathname);
    if(!match||url.search||url.hash||url.username||url.password)return;
    const frameUrl=new URL(frame.url);
    if(frameUrl.origin!==origin||frameUrl.pathname!=='/'||frameUrl.hash!=='#chat/'+match[1])return;
    const current=()=>isActive()&&!contents.isDestroyed()&&contents.mainFrame===frame&&frame.url===frameUrl.href;
    url.pathname=url.pathname.slice(0,-'/download'.length);
    void saveImage({browserSession,url:url.href,mime,current}).catch(()=>{});
  };
  browserSession.on('will-download', onDownload);
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const localImage = details.resourceType === 'image' && ['data:', 'blob:'].includes(url.protocol);
    callback({ cancel: !isTrusted(details.url) && !localImage });
  });
  const preloadArgs=visitFriend?['--arcade-friend-visits']:[];
  if(pickCrop && process.platform==='win32')preloadArgs.push('--arcade-chat-crop');
  if(typeof desktopVersion==='string'&&/^[1-9]\d{0,4}(?:\.(?:0|[1-9]\d{0,4})){2}\.0$/u.test(desktopVersion))
    preloadArgs.push('--arcade-feedback-desktop-version='+desktopVersion);
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession, contextIsolation: true, nodeIntegration: false,
      sandbox: true, devTools: false, preload:path.join(__dirname,'privacy-preload.cjs'),
      ...(preloadArgs.length&&{additionalArguments:preloadArgs}),
    },
  });
  const contents = view.webContents;
  if(visitFriend)contents.ipc?.handle('arcade:visitFriend',async(event,input)=>{
    const frame=event.senderFrame, address=frame?.url;
    const current=()=>isActive()&&!contents.isDestroyed()&&event.sender===contents&&frame===contents.mainFrame&&frame.url===address;
    if(!address||!current()||!isTrusted(address))return {state:'changed'};
    const url=new URL(address), valid=n=>typeof n==='string'&&/^[a-z0-9_]{4,24}$/u.test(n);
    if(url.pathname!=='/'||url.search||!chatFragment.test(url.hash)||!valid(input?.account)||!valid(input?.number))return {state:'changed'};
    try{
      const response=await browserSession.fetch(origin+'/api/v1/conversations/'+url.hash.slice(6),{
        credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
        headers:{'X-Social-Account':input.account}});
      if(!response.ok)return {state:response.status>=500?'offline':'changed'};
      const {conversation}=await response.json();
      if(!current()||conversation?.type!=='direct'||input.account===input.number||
        ![input.account,input.number].every(n=>conversation.members?.some(m=>m.number===n&&m.kind==='human')))return {state:'changed'};
      visitFriend({account:input.account,number:input.number});
      return {state:'opened'};
    }catch{return {state:'offline'};}
  });
  let cropVisit;
  const cancelCrop=()=>cropVisit?.abort();
  contents.on('did-start-navigation',(_event,_url,_inPlace,mainFrame)=>{if(mainFrame)cancelCrop();});
  contents.once('destroyed',cancelCrop);
  contents.ipc?.on?.('arcade:cancelChatCrop',event=>{
    if(event.sender===contents && event.senderFrame===contents.mainFrame)cancelCrop();
  });
  if(pickCrop)contents.ipc?.handle('arcade:pickChatCrop',async event=>{
    const frame=event.senderFrame, address=frame?.url;
    if(cropVisit || process.platform!=='win32' || !isActive() || event.sender!==contents ||
        frame!==contents.mainFrame || !isTrusted(address))return null;
    const url=new URL(address);
    if(url.pathname!=='/' || url.search || !chatFragment.test(url.hash))return null;
    const visit=new AbortController();
    cropVisit=visit;
    try {
      const bytes=await pickCrop(visit.signal);
      return !visit.signal.aborted && isActive() && !contents.isDestroyed() &&
        contents.mainFrame===frame && frame.url===address ? bytes : null;
    } finally { cropVisit=undefined; }
  });
  let openingSnip=false;
  contents.ipc?.handle('arcade:startChatSnip',async(event)=>{
    const frame=event.senderFrame;
    if(process.platform!=='win32'||openingSnip||event.sender!==contents||!frame||frame!==contents.mainFrame||
        !isActive()||contents.isDestroyed()||!isTrusted(frame.url))return false;
    const address=new URL(frame.url);
    if(address.pathname!=='/'||address.search||!chatFragment.test(address.hash))return false;
    const local=process.env.LOCALAPPDATA;
    if(!local||!path.isAbsolute(local))return false;
    openingSnip=true;
    try{
      // Invoke the installed Windows package alias. Only the user's later paste enters the page.
      const alias=path.join(local,'Microsoft','WindowsApps','Microsoft.ScreenSketch_8wekyb3d8bbwe','SnippingTool.exe');
      const child=spawnSnip(alias,['/clip'],{shell:false,stdio:'ignore',windowsHide:false});
      return await new Promise(resolve=>{
        child.once('error',()=>resolve(false));
        child.once('spawn',()=>{child.unref();resolve(true);});
      });
    }finally{openingSnip=false;}
  });
  function publishSendShortcut() {
    if(!readSendShortcut||contents.isDestroyed()||!isTrusted(contents.mainFrame?.url)||
        new URL(contents.mainFrame.url).pathname!=='/')return;
    const mode=readSendShortcut()==='ctrl-enter'?'ctrl-enter':'enter';
    void contents.executeJavaScript(
      'window.dispatchEvent(new CustomEvent("arcade-social-send-shortcut",{detail:'+JSON.stringify(mode)+'}))'
    ).catch(()=>{});
  }
  contents.on('did-finish-load',publishSendShortcut);
  let cardVisit;
  function cancelCardVisit(){cardVisit?.abort();}
  contents.on('did-start-navigation',(_event,_url,_inPlace,mainFrame)=>{if(mainFrame)cancelCardVisit();});
  contents.once('destroyed',cancelCardVisit);
  if(pickGroupCard)contents.ipc?.handle('arcade:pickGroupCard',async(event,input)=>{
    if(cardVisit||event.sender!==contents||!input||typeof input.groupId!=='string'||
        typeof input.roleId!=='string'||!/^[a-z0-9_]{4,24}$/.test(input.roleId))return null;
    const frame=event.senderFrame, direct=input.scope==='personal-direct';
    const personal=input.scope==='personal'||direct, visit=new AbortController();
    let address=origin+'/#chat/'+input.groupId;
    if(personal){
      let url;
      try{url=new URL(frame?.url);}catch{return null;}
      if(input.groupId!==''||url.origin!==origin||url.pathname!=='/'||url.search||!/^(ai_)[0-9a-f]{20}$/u.test(input.roleId))return null;
      address=url.href;
    }else if(!chatFragment.test('#chat/'+input.groupId))return null;
    const current=()=>!visit.signal.aborted&&isActive()&&!contents.isDestroyed()&&frame===contents.mainFrame&&frame?.url===address;
    if(!current())return null;
    cardVisit=visit;
    const roleRevision=typeof input.roleRevision==='string'&&/^[a-f0-9-]{36}$/u.test(input.roleRevision)?input.roleRevision:null;
    // The Web page supplies identifiers only. Get the displayed recipient and permissions
    // directly from the authenticated service, both before and after the local review.
    async function read(route){
      const reply=await browserSession.fetch(origin+'/api/v1/'+route,{credentials:'include',redirect:'error',cache:'no-store',
          headers:{'X-Social-Claude-UI':'1'},signal:AbortSignal.any([visit.signal,AbortSignal.timeout(4000)])});
      if(!reply.ok)throw Error('Social selection changed');
      return reply.json();
    }
    async function target(){
      if(personal){
        const [{user},{profile}]=await Promise.all([read('me'),read(direct?'personal-ai/private-profile':'personal-ai/profile')]);
        if(!user||profile?.owner!==user.number||profile.number!==input.roleId||profile.profileRevision!==roleRevision)return null;
        return {account:user.number,groupId:'',groupTitle:direct?'私聊角色设定':'群聊角色设定',personal:true,direct,roleId:profile.number,
          roleName:profile.displayName,profileRevision:profile.profileRevision,
          ...(direct&&{portraitApproved:profile.portraitApproved})};
      }
      const [{user},{conversation}]=await Promise.all([read('me'),read('conversations/'+input.groupId)]);
      const role=conversation?.members?.find(member=>member.kind==='ai'&&member.number===input.roleId);
      if(!user||conversation?.id!==input.groupId||conversation.type!=='group'||user.number!==conversation.ownerNumber||!role)return null;
      return {account:user.number,groupId:conversation.id,groupTitle:conversation.title,roleId:role.number,roleName:role.displayName};
    }
    try{
      const before=await target();
      if(!before||!current())return null;
      const settings=roleRevision&&!personal?await read('groups/'+before.groupId+'/ai'):null;
      const row=settings?.groupAi?.joined?.find(item=>item.number===before.roleId);
      const reviewingBook=input.kind==='lorebook';
      if(!personal&&reviewingBook&&(!row||!Object.hasOwn(row,'lorebook')||row.roleRevision!==roleRevision))return null;
      const maySharePortrait=direct?typeof before.portraitApproved==='boolean':
        typeof row?.portraitApproved==='boolean'&&row.roleRevision===roleRevision;
      if(!current())return null;
      const projection=await pickGroupCard({...before,maySharePortrait:!reviewingBook&&maySharePortrait,
        ...(reviewingBook&&{kind:'lorebook'})},visit.signal);
      if(!projection||!current())return null;
      const after=await target();
      if(!current()||after?.account!==before.account||after.roleName!==before.roleName||after.groupTitle!==before.groupTitle)return null;
      if(!projection.portrait)return projection;
      if(reviewingBook||!maySharePortrait)return null;
      const route=direct?'personal-ai/private-profile':'groups/'+before.groupId+'/ai-card';
      const saved=await browserSession.fetch(origin+'/api/v1/'+route,{
        method:'POST',credentials:'include',redirect:'error',cache:'no-store',
        signal:AbortSignal.any([visit.signal,AbortSignal.timeout(12000)]),
          headers:{'Content-Type':'application/json','X-Social-Claude-UI':'1'},
        body:JSON.stringify({expectedAccount:before.account,number:before.roleId,expectedRevision:roleRevision,
          card:projection.card,portrait:projection.portrait}),
      });
      await saved.body?.cancel();
      return {portraitSaved:saved.ok};
    }catch{return null;}
    finally{cardVisit=undefined;}
  });
  const privacyUrl=origin+'/privacy.html';
  const supportUrl=privacyUrl+'#privacy-contact';
  let openingSupport=false;
  contents.ipc?.handle('arcade:openPrivacySupport',async(event,raw)=>{
    const frame=event.senderFrame;
    const current=()=>isActive()&&!contents.isDestroyed()&&frame===contents.mainFrame&&(frame.url===privacyUrl||frame.url===supportUrl);
    if(openingSupport||event.sender!==contents||!frame||!current()||typeof raw!=='string'||raw.length>750)return false;
    let url;
    try {url=new URL(raw);} catch {return false;}
    if(url.protocol!=='https:'||url.username||url.password)return false;
    openingSupport=true;
    try {
      const reply=await browserSession.fetch(origin+'/api/v1/public-privacy-contact',{
        credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3000),
      });
      if(!reply.ok||!current()||(await reply.json())?.url!==url.href||!current())return false;
      await openExternal(url.href);
      return true;
    }catch{return false;}
    finally{openingSupport=false;}
  });
  const mayRecord = (caller, permission, details) => {
    if(caller!==contents||permission!=='media'||!isActive()||contents.isDestroyed()||
        !details?.isMainFrame||!isTrusted(details.requestingUrl)||!isTrusted(contents.mainFrame?.url))return false;
    const page=new URL(contents.mainFrame.url);
    return page.pathname==='/'&&chatFragment.test(page.hash);
  };
  browserSession.setPermissionCheckHandler((caller,permission,requestingOrigin,details)=>
    details?.mediaType==='audio'&&isTrusted(requestingOrigin)&&mayRecord(caller,permission,details));
  browserSession.setPermissionRequestHandler((caller,permission,callback,details)=>
    callback(details?.mediaTypes?.length===1&&details.mediaTypes[0]==='audio'&&mayRecord(caller,permission,details)));
  for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    contents.on(eventName, (event, target) => {
      const url = typeof target === 'string' ? target : target?.url ?? event.url;
      if (!isTrusted(url)) event.preventDefault();
    });
  }
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.once('destroyed', () => browserSession.removeListener('will-download', onDownload));
  return {
    view,
    async load() {
      // Chromium can finish loading an HTTP error document successfully.
      // Only the top-level navigation of this load decides if the guest is ready.
      let status;
      const capture = (_event, _url, code) => { status = code; };
      contents.on('did-navigate', capture);
      try {
        await contents.loadURL(origin);
        if (status >= 400) throw Error('Friends page returned HTTP ' + status);
      } finally {
        contents.removeListener('did-navigate', capture);
      }
    },
    async openImageFeedback(current) {
      const onAppPage=()=>!contents.isDestroyed()&&isTrusted(contents.mainFrame?.url)&&
        new URL(contents.mainFrame.url).pathname==='/';
      try {
        if (!onAppPage() && current() && isActive()) await this.load();
        if (onAppPage() && current() && isActive()) await contents.executeJavaScript(
          'window.dispatchEvent(new Event("arcade-social-image-feedback"))'
        );
      } catch { /* The user can return to the preview and retry. */ }
    },
    async openWorldAiChat(account,current) {
      if(typeof account!=='string'||!/^[a-z0-9_]{4,24}$/u.test(account))return;
      const onAppPage=()=>!contents.isDestroyed()&&isTrusted(contents.mainFrame?.url)&&
        new URL(contents.mainFrame.url).pathname==='/';
      try {
        if (!onAppPage()&&current()&&isActive())await this.load();
        if (onAppPage()&&current()&&isActive())await contents.executeJavaScript(
          'window.dispatchEvent(new CustomEvent("arcade-world-ai-chat",{detail:'+JSON.stringify(account)+'}))'
        );
      }catch { /* The service or page may have closed while returning. */ }
    },
    activate() {
      publishSendShortcut();
      if(!contents.isDestroyed())
        void contents.executeJavaScript('window.dispatchEvent(new Event("arcade-social-activate"))').catch(()=>{});
    },
    deactivate() {
      cancelCrop();
      cancelCardVisit();
      if(!contents.isDestroyed())
        void contents.executeJavaScript('window.dispatchEvent(new Event("arcade-social-deactivate"))').catch(()=>{});
    },
  };
}

module.exports = { createSocialView };
