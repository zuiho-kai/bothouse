'use strict';
const {directoryBoardReceiver}=require('./bothouse/board-receiver.cjs');
const {createWorkOrders}=require('./bothouse/work-orders.cjs');
const {chatFeedbackReview} = require('./chat-feedback-review.cjs');

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {createHash} = require('node:crypto');
const {fail,number} = require('./store.cjs');
const {current,makeAuth} = require('./auth.cjs');
const {createAiDirect} = require('./ai-direct.cjs');
const {provisionAi}=require('./ai-adapter.cjs');
const {AI_NUMBER,AI_JU_NUMBER,AI_DRAGON_NUMBER,providerForRole}=require('./ai-roles.cjs');
const {createPersonalAi}=require('./personal-ai.cjs');
const {createAiGroup} = require('./ai-group.cjs');
const {createAiFeed} = require('./ai-feed.cjs');

const {createAiProactive} = require('./ai-proactive.cjs');
const {readImageUpload} = require('./image-upload.cjs');
const {readVoiceUpload} = require('./voice-upload.cjs');
const {createAiVoice} = require('./ai-voice.cjs');
const {createImageQuestions}=require('./ai-image-questions.cjs');
const {createAiFriendRequests} = require('./ai-friend-requests.cjs');
const {PORTRAIT_BASE64_LIMIT} = require('../../src/core/group-drawing-portrait.cjs');
const {createAiAppointments} = require('./ai-appointments.cjs');
const {createConversationWeb}=require('./conversation-web-search.cjs');
const {markPrivateWebLookup}=require('./web-search-privacy.cjs');

async function jsonBody(req,limit=65536) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415,'content_type','请发送 JSON');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) fail(413,'body_limit','请求过大');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400,'json','JSON 格式有误'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'json','需要 JSON 对象');
  return value;
}
function humanContact(store,value) {
  const account=number(value);
  if(store.user(account).kind!=='human')fail(403,'ai_direct_only','请从 AI 联系人入口开始私聊');
  return account;
}
function humanMembers(store,values) {
  return Array.isArray(values)&&values.length<=99?values.map(value=>humanContact(store,value)):values;
}
function requireClaudeUi() {
  fail(409,'claude_client_update','请刷新好友页面或使用新版，再核对 Claude（Anthropic）授权');
}
function legacyConversation(conversation) {
  if(!conversation.members.some(member=>member.number===AI_JU_NUMBER))return conversation;
  const hint='请刷新页面或用新版确认 Claude 授权';
  return {...conversation,
    ...(conversation.type==='direct'&&{title:conversation.title+'（'+hint+'）'}),
    members:conversation.members.map(member=>member.number===AI_JU_NUMBER?
      {...member,displayName:member.displayName+'（'+hint+'）'}:member)};
}
const bothousePairing = require('./bothouse/pairing.cjs');
function dispatch(store,a,route,body,params,clientBuild,ai,aiGroup,aiFeed,proactive,aiFriends,appointments,web,personal,bothouse,workOrders) {
  const {method, parts:[root,id,action,msg,sub], parts, claudeUi, friendRolesUi} = route;
  const visibleRole=role=>claudeUi||role.number!==AI_JU_NUMBER;
  const conversationView=conversation=>claudeUi?conversation:legacyConversation(conversation);
  const groupResult=groupAi=>({groupAi:claudeUi?groupAi:{...groupAi,
    available:groupAi.available.filter(visibleRole),joined:groupAi.joined.filter(visibleRole)}});
  const guard=role=>{if(!claudeUi&&typeof role==='string'&&role.toLowerCase()===AI_JU_NUMBER)requireClaudeUi();};
  const key = method + ' ' + parts.join('/');
  switch (key) {
    case 'GET personal-ai': return {identity:personal.mine(a)};
    case 'POST personal-ai': return {identity:personal.save(a,body)};
    case 'GET personal-ai/profile': return {profile:personal.publicProfile(a)};
    case 'POST personal-ai/profile': return {profile:personal.saveProfile(a,body)};
    case 'GET personal-ai/private-profile': return {profile:personal.publicProfile(a,true)};
    case 'POST personal-ai/private-profile': return {profile:personal.saveProfile(a,body,true)};
    case 'GET me': return {user:store.user(a)};
    case 'GET feedback': return params.get('view')==='history'
      ? {account:a,...store.feedbackPage(a,params.get('before'))}
      : {account:a,feedback:store.feedback(a)};
    case 'GET feedback/chat-review':
      if(params.get('account')!==a)fail(409,'feedback_session','账号已切换，请重新打开意见反馈');
      return {account:a,...chatFeedbackReview(store.db,a)};
    case 'GET reports/mine': return {account:a,reports:store.ownReports(a)};
    case 'POST feedback': return {feedback:store.submitFeedback(a,body,clientBuild)};
    case 'GET users': {
      const user=store.user(number(params.get('number'))),availability=personal.friendAvailability(a,user.number);
      return {user:availability?{...user,personalFriendAvailability:availability}:user};
    }
    case 'GET personal-ai/friend-settings': return {settings:personal.friendSettings(a)};
    case 'POST personal-ai/friend-settings': return {settings:personal.saveFriendSettings(a,body)};
    case 'GET friends': return {friends:store.friends(a)};
    case 'GET ai-contacts': return {contacts:ai.contacts().filter(visibleRole)};
    case 'POST ai-contacts/start': guard(body.number);return ai.start(a,body);
    case 'GET friend-requests': {
      const requests=store.requests(a);
      return {...requests,incoming:requests.incoming.filter(row=>row.from.kind!=='ai'||
        row.from.number===AI_NUMBER||friendRolesUi&&visibleRole(row.from))};
    }
    case 'GET ai-friend-preference': return {preference:aiFriends.view(a)};
    case 'POST ai-friend-preference': return {preference:aiFriends.save(a,body)};
    case 'GET ai-friend-preferences': return {account:a,roles:aiFriends.roles(a).filter(visibleRole)};
    case 'POST ai-friend-preferences': {
      guard(body.number);
      aiFriends.saveRole(a,body);
      return {account:a,roles:aiFriends.roles(a).filter(visibleRole)};
    }
    case 'POST friend-requests': {
      const target=store.user(number(body.number));
      if(target.kind==='human')return {request:store.request(a,target.number)};
      if(body.expectedAccount!==a)fail(403,'ai_friend_account','请在当前账号添加 AI 好友');
      const availability=personal.friendAvailability(a,target.number);
      if(availability==='private')fail(403,'personal_ai_private_friend','这位个人 AI 仅主人可添加好友');
      if(!availability&&!providerForRole.has(target.number))fail(403,'ai_direct_only','请从 AI 联系人入口开始私聊');
      const {conversation}=store.acceptAiFriendRequest(a,target.number);
      return {conversation:conversationView(conversation)};
    }
    case 'GET conversations': return {conversations:store.conversations(a).map(conversationView)};
    case 'POST direct': {
      const direct = store.direct(a,number(body.number));
      if (!direct) fail(403,'friends_only','请先添加好友');
      return {conversation:conversationView(store.conversation(a,direct.id))};
    }
    case 'POST groups': return {conversation:store.createGroup(a,body.title,humanMembers(store,body.memberNumbers))};
    case 'GET friend-feed': return {...store.friendFeed(a,params),role:aiFeed.subscription(a),roles:aiFeed.subscriptions(a)};
    case 'POST friend-feed': return {post:store.publishFriendPost(a,body)};
    case 'POST friend-feed/follow': return aiFeed.follow(a,body);
  }
  if (root==='friend-feed'&&parts.length===3&&method==='POST'&&action==='delete')
    return store.deleteFriendPost(a,id,body);
  if (root==='friend-feed'&&parts.length===3&&method==='POST'&&action==='report')
    return {report:store.reportFriendPost(a,id,body.reason)};
  if (root === 'friend-requests' && parts.length === 3 && method === 'POST' && ['accept','decline'].includes(action))
    return store.decide(a,id,action === 'accept');
  if(root==='groups'&&parts.length===3&&action==='personal-ai'){
    if(method==='GET')return personal.room(a,id);
    if(method==='POST')return personal.edit(a,id,body);
  }
  if (root === 'groups' && parts.length === 3 && action === 'ai') {
    if(method==='GET')return groupResult(aiGroup.view(a,id));
    if(method==='POST'){guard(body.number);return groupResult(aiGroup.setMember(a,id,body));}
  }
  if (root === 'groups' && parts.length === 3 && method === 'POST') {
    if (['ai-card','ai-lorebook','ai-consent','ai-context','ai-drawing'].includes(action))guard(body.number);
    if (action === 'ai-card') return groupResult(aiGroup.setCard(a,id,body));
    if (action === 'ai-lorebook') return groupResult(aiGroup.setLorebook(a,id,body));
    if (action === 'ai-consent') return groupResult(aiGroup.setSharing(a,id,body));
    if (action === 'ai-context') return groupResult(aiGroup.setContextSharing(a,id,body));
    if (action === 'ai-drawing') return groupResult(aiGroup.setDrawing(a,id,body));
    if (action === 'members') {
      store.group(a,id);
      return {conversation:conversationView(store.addMembers(a,id,humanMembers(store,body.memberNumbers)))};
    }
    if (action === 'leave') return store.remove(a,id,a,true);
    if (action === 'remove') return store.remove(a,id,number(body.number),false);
  }
  if (root === 'conversations') {
    if (parts.length === 2 && method === 'GET') return {conversation:conversationView(store.conversation(a,id))};
    if (parts.length === 3 && action === 'read' && method === 'POST') return store.markConversationRead(a,id,body);
    if (parts.length === 3 && action === 'history-search' && method === 'GET') {
      const page=store.historySearch(a,id,params);
      return page.messages?{...page,messages:store.withReplyPreviews(a,id,page.messages)}:page;
    }
    if (parts.length === 3 && action === 'ai-consent' && method === 'POST') {
      if(!claudeUi)guard(store.directAiConsent(a,id)?.ai);
      return ai.setConsent(a,id,body);
    }
    if (parts.length === 3 && action === 'web-search' && method === 'POST')
      return web.save(a,id,body);
    if (parts.length === 3 && action === 'ai-proactive') {
      if(!claudeUi)guard(store.directAiConsent(a,id)?.ai);
      return method==='GET'?proactive.view(a,id):proactive.save(a,id,body);
    }
    if (parts.length === 3 && action === 'appointments' && ['GET','POST'].includes(method))
      return method==='GET'?appointments.view(a,id):appointments.save(a,id,body);
    if (parts.length === 3 && action === 'messages') {
      if (method === 'GET') {
        const page=store.historyPage(a,id,params);
        return {...page,messages:store.withReplyPreviews(a,id,page.messages).map(message=>personal.withVoiceOffer(a,message))};
      }
      if (method === 'POST') {
        if(!bothouse&&!claudeUi)guard(store.directAiConsent(a,id)?.ai);
        let directTurn=false,groupTurn,personalTurn,abortProactive,bothouseTurn;
        const message=store.send(a,id,body,row=>{
          if(workOrders.stage(a,row,body,route.preparedTask)){
            guard(row.mention?.number);
            return;
          }
          if(bothouse){bothouseTurn=bothouse.stage(a,row);return;}
          markPrivateWebLookup(store,id,row.id,row.text);
          abortProactive=proactive.cancelPending(id);
          if(appointments.stage(a,row,body.timeZone))return;
          directTurn=ai.stage(a,row,body.aiConsentRevision);
          if(!directTurn)personalTurn=personal.stage(a,row);
          if(!directTurn&&!personalTurn)groupTurn=aiGroup.stage(a,row,claudeUi);
        });
        return {message,directTurn,groupTurn,personalTurn,abortProactive,bothouseTurn};
      }
    }
    if(parts.length===5&&action==='messages'&&sub==='task-retry'&&method==='POST'&&/^[1-9]\d*$/u.test(msg))
      return workOrders.retry(a,id,Number(msg),body);
    if(parts.length===5&&action==='messages'&&sub==='drawing-resend'&&/^[1-9]\d*$/u.test(msg))
      return (store.access(a,id).type==='group'?aiGroup:ai).drawingResend(a,id,msg,body);
    if(parts.length===5&&action==='messages'&&sub==='personal-voice'&&method==='POST'&&/^[1-9]\d*$/u.test(msg))
      return personal.resumeVoice(a,id,msg,body);
    if (parts.length === 5 && action === 'messages' && sub === 'report' && method === 'POST' && /^\d+$/.test(msg))
      return {report:store.report(a,id,msg,body.reason,body.includeMedia)};
  }
  fail(404,'route','没有这个接口');
}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const {sourceDetails,sendPublicSource}=require('./public-source.cjs');
const buildOf = bytes => createHash('sha256').update(bytes).digest('hex');
const {directory:releaseDirectory,appWithBuild,loadClientRelease}=require('./client-release.cjs');
const htmlEscapes={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml=value=>value.replace(/[&<>"']/g,char=>htmlEscapes[char]);
function renderPrivacy(bytes,contact) {
  if(!contact)return bytes;
  const details='<p>公开运营名称：'+escapeHtml(contact.name)+'</p>'+
    '<label for="privacy-contact-value">隐私联系方式</label><textarea id="privacy-contact-value" rows="2" readonly>'+
    escapeHtml(contact.label)+'</textarea><div class="actions">'+
    '<button id="copy-privacy-contact" class="outline" type="button" hidden>复制联系方式</button>'+
    '<a id="open-privacy-contact" class="privacy-link" rel="noreferrer" href="'+escapeHtml(contact.href)+'">'+
    (contact.href.startsWith('mailto:')?'撰写邮件':'打开支持网页')+'</a></div>'+
    '<p id="privacy-copy-status" class="feedback" role="status"></p>';
  return bytes.toString('utf8').replace(/<p id="privacy-contact-unconfigured">[^<]*<\/p>/,()=>details);
}
async function serveClient(client,url,req,res,privacyContact,publicSource,clientRelease) {
  if (!['GET','HEAD'].includes(req.method)) fail(405,'method','请求方法无效');
  let parts;
  try { parts = decodeURIComponent(url.pathname).split('/').filter(Boolean); } catch { fail(400,'path','路径有误'); }
  if (parts.some(p => p.startsWith('.') || /[\\:\x00]/.test(p))) fail(404,'asset','资源不存在');
  if (!parts.length) parts.push('index.html');
  const name=parts.join('/');
  const pinned=parts[0]===releaseDirectory;
  if(pinned||['index.html','app.js','client-start.js'].includes(name)){
    const release=await clientRelease();
    const asset=parts.slice(2).join('/');
    const bytes=pinned
      ? parts[1]===release.build&&release.files.get(asset)
      : name==='index.html'?release.document:release.files.get('client-start.js');
    if(!bytes)fail(404,'asset','资源不存在');
    const file=pinned?asset:name;
    const body=pinned&&asset==='app.js'?appWithBuild(bytes):bytes;
    res.setHeader('Content-Type',mime[path.extname(file)]);
    if(pinned)res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    if(!pinned&&name==='app.js')res.setHeader('X-Friends-Client-Entry','pinned');
    return res.end(req.method==='HEAD'?undefined:body);
  }
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
  if(parts.length===1&&parts[0]==='privacy.html') {
    bytes=renderPrivacy(bytes,privacyContact);
    res.setHeader('Content-Length',Buffer.byteLength(bytes));
  }
  if(parts.length===1&&parts[0]==='source.html')
    bytes=bytes.toString('utf8').replace('<!-- current-source -->',()=>sourceDetails(publicSource))
      .replace('<!-- source-page-address -->',()=>escapeHtml(url.origin+'/source.html'));
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
function createServer(store,{publicOrigin,client = path.join(__dirname,'../client'),aiProvider,claudeProvider,openaiProvider,
  groupAiProviders=[aiProvider,openaiProvider,claudeProvider].filter(Boolean),privacyContact,publicSource,voiceEngine,drawingProvider,feedClock,appointmentClock,webSearchFetch,personalAiFetch,bothouse,filename,taskReceiver=directoryBoardReceiver(bothouse,filename)} = {}) {
  let loadedClient;
  const clientRelease=()=>loadedClient??=loadClientRelease(client);
  const auth = makeAuth(store,Boolean(publicOrigin));
  const workOrders=createWorkOrders(store,taskReceiver);
  const web=createConversationWeb(store,webSearchFetch);
  const voiceReplies = createAiVoice(store,voiceEngine);
  const personal=createPersonalAi(store,personalAiFetch,voiceReplies);
  const existingJu=store.one('SELECT kind,name FROM users WHERE number=?',AI_JU_NUMBER);
  const juAvailable=!existingJu||existingJu.kind==='ai'&&existingJu.name===claudeProvider?.name;
  const directProviders=[[AI_NUMBER,aiProvider],[AI_JU_NUMBER,juAvailable?claudeProvider:undefined],
    [AI_DRAGON_NUMBER,openaiProvider]];
  const ai = createAiDirect(store,directProviders,voiceReplies,web,personal,drawingProvider);
  const groupProviders=groupAiProviders.filter(provider=>juAvailable||provider!==claudeProvider);
  const groupRoles=new Set(groupProviders.flatMap(provider=>(provider.groupRoles??[]).map(role=>role.number)));
  const inviteRoles=new Set(ai.contacts().filter(role=>groupRoles.has(role.number)).map(role=>role.number));
  const aiFriends=createAiFriendRequests(store,inviteRoles);
  const aiGroup=createAiGroup(store,groupProviders,voiceReplies,drawingProvider,aiFriends,web);
  if(!bothouse){
    for(const [id,name] of [[AI_NUMBER,'鲸鱼娘'],[AI_DRAGON_NUMBER,'龙娘'],[AI_JU_NUMBER,'橘娘']]){
      if(!store.one('SELECT 1 FROM users WHERE number=?',id))provisionAi(store,id,name);
    }
    store.acceptPendingAiFriendRequests();
  }
  const vision=createImageQuestions(store,[...groupAiProviders,aiProvider,openaiProvider,juAvailable?claudeProvider:undefined]);
  const proactive = createAiProactive(store,directProviders);
  const appointments = createAiAppointments(store,appointmentClock);
  function voiceRoles(account,chat){
    if(store.access(account,chat).type==='group')
      return [...aiGroup.view(account,chat).joined.filter(role=>role.configured&&role.sharing)
        .map(({number,displayName})=>({number,displayName})),...personal.voiceRoles(account,chat)];
    const grant=store.directAiConsent(account,chat);
    return grant?.enabled?ai.contacts().filter(role=>role.number===grant.ai)
      .map(({number,displayName,kind})=>({number,displayName,kind})):[];
  }
  const aiFeed=createAiFeed(store,[[AI_NUMBER,aiProvider],[AI_JU_NUMBER,juAvailable?claudeProvider:undefined],
    [AI_DRAGON_NUMBER,openaiProvider]],feedClock);
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Permissions-Policy','microphone=(self), camera=(), display-capture=()');
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
      if (url.pathname===publicSource?.route && !url.search && ['GET','HEAD'].includes(req.method))
        return await sendPublicSource(req,res,publicSource);
      if (!url.pathname.startsWith('/api/')) return await serveClient(client,url,req,res,privacyContact,publicSource,clientRelease);
      if (!url.pathname.startsWith('/api/v1/')) fail(404,'route','接口版本无效');
      const parts = url.pathname.slice(8).split('/');
      const key = parts.join('/');
      if(key==='public-privacy-contact'&&req.method==='GET'){
        res.setHeader('Content-Type','application/json; charset=utf-8');
        return res.end(JSON.stringify({url:privacyContact?.href.startsWith('https:')?privacyContact.href:null}));
      }
      if (!['GET','POST'].includes(req.method)) fail(405,'method','请求方法无效');
      const [collection,chat,action,message,asset,variant]=parts;
      if(collection==='conversations'&&parts.length===3&&action==='voices'&&req.method==='POST') {
        const account=current(store,req);
        if(req.headers['x-social-account']!==account)fail(409,'voice_session','账号已切换，请重新打开会话');
        store.humanAttachmentAccess(account,chat,'voice');
        const voice=await readVoiceUpload(req);
        if(current(store,req)!==account)fail(409,'voice_session','账号已切换，请重新打开会话');
        const sent=store.transaction(()=>store.sendVoice(account,chat,voice.clientId,voice));
        res.setHeader('Content-Type','application/json; charset=utf-8');
        return res.end(JSON.stringify({message:sent}));
      }
      if(collection==='conversations'&&action==='messages'&&asset==='voice'&&req.method==='GET'&&
          parts.length===5&&/^[1-9]\d*$/u.test(message)) {
        const account=current(store,req);
        if(req.headers['x-social-account']!==account)fail(409,'voice_session','账号已切换，请重新打开会话');
        const file=store.messageVoice(account,chat,message);
        res.setHeader('Content-Type','audio/wav');
        res.setHeader('Content-Length',file.bytes.byteLength);
        res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        return res.end(file.bytes);
      }
      if(collection==='conversations'&&parts.length===3&&action==='images'&&req.method==='POST') {
        const account=current(store,req);
        if(req.headers['x-social-account']!==account)fail(409,'image_session','账号已切换，请重新打开会话');
        store.imageUploadAccess(account,chat);
        const image=await readImageUpload(req);
        if(current(store,req)!==account)fail(409,'image_session','账号已切换，请重新打开会话');
        const sent=store.transaction(()=>store.sendImage(account,chat,image.clientId,image));
        res.setHeader('Content-Type','application/json; charset=utf-8');
        return res.end(JSON.stringify({message:sent}));
      }
      if(collection==='conversations'&&action==='messages'&&asset==='image'&&req.method==='GET'&&
          (parts.length===5||parts.length===6&&variant==='download')&&/^[1-9]\d*$/u.test(message)) {
        const account=current(store,req);
        if(req.headers['x-social-account']!==undefined&&req.headers['x-social-account']!==account)
          fail(409,'image_session','账号已切换，请重新打开会话');
        const file=store.messageImage(account,chat,message);
        res.setHeader('Content-Type',file.mime);
        res.setHeader('Content-Length',file.bytes.byteLength);
        res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        const disposition=variant==='download'?'attachment':'inline';
        res.setHeader('Content-Disposition',disposition+(file.mime==='image/png'?'; filename="image.png"':'; filename="image.jpg"'));
        return res.end(file.bytes);
      }
      const cardSave=collection==='groups'&&action==='ai-card'&&parts.length===3&&req.method==='POST';
      if(cardSave){
        const account=current(store,req);
        if(store.group(account,chat).owner!==account)fail(403,'group_owner','只有群主可以修改群角色');
      }
      if(req.method==='POST'&&key==='personal-ai'&&!publicOrigin&&
         !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
        fail(403,'personal_ai_https','请用 HTTPS 或本机入口管理个人 AI 密钥');
      const privateCardSave=key==='personal-ai/private-profile'&&req.method==='POST';
      if(privateCardSave)current(store,req);
      const body = req.method === 'POST' ? await jsonBody(req,cardSave||privateCardSave?
        65536+PORTRAIT_BASE64_LIMIT:undefined) : null;
      let result;
      if (req.method === 'POST' && ['register','login'].includes(key)) result = await auth.enter(key === 'register',body,req,res);
      else if (req.method === 'POST' && key === 'logout') result = auth.logout(req,res);
      else {
        const account = current(store,req);
        if(req.method==='POST'&&collection==='conversations'&&action==='messages'&&parts.length===3&&
            req.headers['x-social-account']!==undefined&&req.headers['x-social-account']!==account)
          fail(409,'message_session','账号已切换，请重新打开会话');
        if(req.method==='GET'&&collection==='conversations'&&action==='role-portrait'&&parts.length===3){
          if(req.headers['x-social-account']!==account)fail(409,'portrait_session','账号已切换，请重新打开会话');
          const portrait=await bothouse?.portrait(account,chat);
          if(current(store,req)!==account)fail(409,'portrait_session','账号已切换，请重新打开会话');
          res.setHeader('Content-Type','application/json; charset=utf-8');
          return res.end(JSON.stringify({portrait:portrait??null}));
        }
        if(bothouse){
          let answer;
          if(key==='ai-contacts/pair'){
            if(req.method==='GET') answer={paired:!!bothousePairing.active(store,account)};
            if(req.method==='POST') answer=bothousePairing.redeem(store,account,body);
          }
          if(req.method==='POST' && key==='ai-contacts/unpair'){
            bothousePairing.checkAccount(account,body.expectedAccount);
            answer=bothousePairing.revoke(store,account);
          }
          if(req.method==='GET'&&key==='ai-contacts')answer=await bothouse.list(account);
          if(req.method==='POST'&&key==='ai-contacts/start')answer=await bothouse.start(account,body);
          if(req.method==='POST'&&key==='personal-ai'&&body.action!=='withdraw')
            fail(409,'bothouse_managed','请在 Bothouse 管理角色及模型');
          if(collection==='groups'&&action==='ai'&&parts.length===3){
            if(body&&!bothouse.isRole(body.number)){
              if(body.enabled!==false)fail(409,'bothouse_managed','请选择当前 Bothouse 目录中的角色');
              store.transaction(()=>aiGroup.setMember(account,chat,body));
            }
            answer=await bothouse.group(account,chat,body&&bothouse.isRole(body.number)?body:null);
            answer.groupAi.joined.push(...aiGroup.view(account,chat).joined);
          }
          if(req.method==='POST'&&key==='friend-requests'&&bothouse.isRole(body.number))answer=await bothouse.start(account,body);
          if(req.method==='GET'&&key==='users'&&bothouse.isRole(url.searchParams.get('number'))){
            const user=await bothouse.resolveMember(account,url.searchParams.get('number'));
            if(!user)fail(404,'unknown_role','找不到这个角色');
            answer={user};
          }
          if(answer){
            res.setHeader('Content-Type','application/json; charset=utf-8');
            return res.end(JSON.stringify(answer));
          }
        }
        if(collection==='personal-ai'&&parts[1]==='voice'&&parts.length===2){
          const role=personal.ownerVoiceRole(account);
          result=req.method==='GET'?voiceReplies.ownerView(account,role):
            store.transaction(()=>voiceReplies.chooseOwner(account,role,body));
          if(req.method==='POST')personal.cancelStale();
          res.setHeader('Content-Type','application/json; charset=utf-8');
          return res.end(JSON.stringify(result));
        }
        if(key==='personal-ai/voice/preview'&&req.method==='POST'){
          const role=personal.ownerVoiceRole(account);
          const bytes=await voiceReplies.preview(role?[role]:[],account,body,true);
          if(current(store,req)!==account)
            fail(403,'ai_voice_scope','请在当前账号试听自己的 AI 音色');
          res.setHeader('Content-Type','audio/wav');
          res.setHeader('Content-Length',bytes.length);
          return res.end(bytes);
        }
        if(collection==='conversations'&&action==='ai-voice'&&parts.length===3){
          const eligible=voiceRoles(account,chat);
          result=req.method==='GET'?voiceReplies.view(chat,account,eligible):
            store.transaction(()=>voiceReplies.choose(chat,account,eligible,body));
          if(req.method==='POST')personal.cancelStale();
          res.setHeader('Content-Type','application/json; charset=utf-8');
          return res.end(JSON.stringify(result));
        }
        if(collection==='conversations'&&action==='ai-voice'&&parts.length===4&&message==='preview'&&req.method==='POST'){
          const bytes=await voiceReplies.preview(voiceRoles(account,chat),account,body);
          if(current(store,req)!==account||!voiceRoles(account,chat).some(role=>role.number===body.number))
            fail(403,'ai_voice_scope','请先在本会话同意这位角色的 AI 聊天');
          res.setHeader('Content-Type','audio/wav');
          res.setHeader('Content-Length',bytes.length);
          return res.end(bytes);
        }
        if (req.method==='POST'&&collection==='friend-feed'&&action==='report'&&req.headers['x-social-account']!==account)
          fail(409,'feed_session','账号已切换，请重新打开好友动态再举报');
        if (req.method === 'POST' && parts.at(-1) === 'report' &&
            (req.headers['x-social-account'] !== undefined || body.includeMedia===true) &&
            req.headers['x-social-account'] !== account)
          fail(409,'report_session','账号已切换，请重新打开会话再举报');
        const build = req.method === 'POST' && key === 'feedback' ?
          buildOf(await fs.readFile(path.join(client,'app.js'))) : undefined;
        const claudeUi=req.headers['x-social-claude-ui']==='1';
        if(collection==='conversations'&&action==='messages'&&parts.length===5&&/^[1-9]\d*$/u.test(message)&&
          (asset==='vision'||asset==='vision-permission'&&req.method==='POST')){
          let output;
          if(req.method==='GET')output=vision.roles(account,chat,message,claudeUi);
          else if(asset==='vision-permission')output=store.transaction(()=>vision.permission(account,chat,message,body,claudeUi));
          else{
            const {job,...staged}=store.transaction(()=>vision.stage(account,chat,message,body,claudeUi));
            output=job?{...staged,...await vision.finish(job),
              message:store.message(store.one('SELECT * FROM messages WHERE id=?',staged.message.id))}:staged;
          }
          res.setHeader('Content-Type','application/json; charset=utf-8');
          return res.end(JSON.stringify(output));
        }
        const preparedTask=req.method==='POST'&&collection==='conversations'&&action==='messages'&&parts.length===3
          ? await workOrders.prepare(account,chat,body):undefined;
        if(preparedTask&&current(store,req)!==account)fail(409,'message_session','账号已切换，请重新打开会话');
        const handle = () => dispatch(store,account,{method:req.method,parts,claudeUi,preparedTask,friendRolesUi:req.headers['x-social-ai-friend-roles']==='1'},body,url.searchParams,build,ai,aiGroup,aiFeed,proactive,aiFriends,appointments,web,personal,bothouse,workOrders);
        result = req.method === 'POST' ? store.transaction(handle) : handle();
        if(result.cancelWebChat){
          web.cancel(result.cancelWebChat);
          delete result.cancelWebChat;
        }
        if(result.abortDirectChat){
          ai.abort(result.abortDirectChat);
          proactive.abort(result.abortDirectChat);
          result={conversation:result.conversation};
        }
        if(result.abortProactive){
          proactive.abort(chat);
          delete result.abortProactive;
        }
        if(req.method==='POST'&&collection==='conversations'&&action==='ai-proactive')proactive.wake();

        if(req.method==='POST'&&(parts[0]==='groups'||parts[0]==='conversations'||parts[0]==='personal-ai'))personal.cancelStale();
        if(req.method==='POST'&&parts[0]==='personal-ai')ai.cancelStalePersonal();
        if(req.method==='POST'&&parts[0]==='groups')aiGroup.cancelStale();
        if(result.message){
          const {message,directTurn,groupTurn,personalTurn,bothouseTurn}=result;
          aiGroup.cancelStale();
          if(message.task||workOrders.view(message.id))workOrders.wake();
          const delivered=bothouseTurn?await bothouse.finish(bothouseTurn):null;
          let reply;
          try {
            reply=personalTurn?await personal.finish(personalTurn):directTurn?await ai.finish(message,directTurn):groupTurn?await aiGroup.finish(groupTurn):appointments.replyFor(message.id);
          } finally {
            if(directTurn||groupTurn)proactive.wake();
          }
          const saved=store.message(store.one('SELECT * FROM messages WHERE id=?',message.id));
          const [visible]=store.withReplyPreviews(account,saved.conversationId,[saved]);
          result={message:personal.withVoiceOffer(account,visible),
            ...(reply&&{reply}),...delivered};
        }
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
  server.once('listening',workOrders.start);
  server.once('close',workOrders.stop);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.once('listening',aiFeed.start);
  server.once('close',aiFeed.stop);

  server.once('listening',proactive.start);
  server.once('close',proactive.stop);
  server.once('listening',appointments.start);
  server.once('close',appointments.stop);
  return server;
}
module.exports = {createServer,renderPrivacy};
