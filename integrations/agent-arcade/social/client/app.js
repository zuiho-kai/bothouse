import { mountConversationList } from './conversation-list.js';
import { quoteControl,focusOriginal } from './message-reply.js';
import { VoiceQueuePlayer } from './voice-queue-player.js';
import { humanAvatarUrl, prepareAvatar, readImageData } from './avatar-image.js';
const startupUrl=new URL(location.href);
if(startupUrl.searchParams.has('friends-reload')){
  startupUrl.searchParams.delete('friends-reload');
  history.replaceState(history.state,'',startupUrl);
}
const $ = selector => document.querySelector(selector);
const root = $('#workspace'), auth = $('#auth'), dialog = $('#dialog'), directory = $('#directory-body');
const conversationList = mountConversationList(directory,renderDirectory);
const feed = $('#friend-feed'), feedPosts = $('#feed-posts'), feedStatus = $('#feed-status');
const historyView = $('#history'), messageBox = $('#message'), composer = $('#composer');
const chatSettings=$('#chat-settings'), messageActions=$('#message-actions');
const personalAiProfileButton=$('#personal-ai-direct-profile');
const tabs = [...root.querySelectorAll('[data-tab]')];
const labels = {messages:'消息', contacts:'通讯录', feed:'好友动态', profile:'我'};
const aiProviderNames = {deepseek:'DeepSeek',openai:'OpenAI（GPT）',anthropic:'Claude（Anthropic）'};
const aiService=provider=>aiProviderNames[provider]||'云服务';
const pageSize = 50;
const date = new Intl.DateTimeFormat('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const reportDate = new Intl.DateTimeFormat('zh-CN', {dateStyle:'medium',timeStyle:'short'});
let user, generation = 0, tab = 'messages', chat, conversation, chatPortrait, messages = [], older = false;
let friends = [], incoming = [], outgoing = [], conversations = [], syncFlight, historyFlight, olderFlight, dialogGeneration = 0;
let chatVisit=0, moderationCursor=0, historyFloor=0, historyAfter=0, dialogMessage, dialogGroup, dialogCleanup;
let membershipRevision, historyContext, historyFinder;
let socialVisible=true;
const readThrough=new Map(), readFlights=new Map();
let inlineVoice, messageAction;
let feedScope='friends', feedCursor=null, feedRead=0, pendingPost;
let feedRoles=[], feedFollowFlight=false;
const postDraftKey='arcade.friendPost.pending';
const removedMessages=new Set();
let authMode = 'login', authFlight = false;
const drafts = new Map(), sending = new Set();
const chatDraftKey = 'arcade.chat.drafts';
let interruptedDrafts;
function savedChatDrafts() {
  try { return JSON.parse(sessionStorage.getItem(chatDraftKey)); } catch { return null; }
}
function persistChatDrafts() {
  try {
    const saved=user?{account:user.number,entries:[...drafts]}:interruptedDrafts;
    if(saved?.entries.length)sessionStorage.setItem(chatDraftKey,JSON.stringify(saved));
    else sessionStorage.removeItem(chatDraftKey);
  } catch {}
}
function restoreChatDrafts(account) {
  const saved=interruptedDrafts??savedChatDrafts();
  interruptedDrafts=undefined;
  drafts.clear();
  try {
    if(saved?.account===account)
      for(const [id,draft] of saved.entries)drafts.set(id,draft);
  } catch { drafts.clear(); }
  persistChatDrafts();
  return drafts.has(saved?.resumeChat)?saved.resumeChat:undefined;
}
function suspendChatDrafts(account,entries,resumeChat) {
  if(!account||!Array.isArray(entries))return;
  const eligible=[];
  for(const entry of entries){
    if(!Array.isArray(entry))continue;
    const [id,draft]=entry;
    const body=typeof draft?.text==='string'&&withoutMention(draft.text,draft.target);
    const text=body&&body.trim();
    if(!text||!draft.membershipRevision||draft.attempt?.text===text||
      draft.submittedPhotoText===text)continue;
    eligible.push([id,{text:body,...(draft.replyTo&&{replyTo:draft.replyTo}),floor:draft.floor,membershipRevision:draft.membershipRevision}]);
  }
  return {account,entries:eligible,resumeChat:eligible.some(([id])=>id===resumeChat)?resumeChat:undefined};
}
function noticeExpiredSession() {
  $('#auth-error').textContent=interruptedDrafts?.entries.length?
    '登录已过期。用同一用户号重新登录，可在原会话继续编辑未发送的文字。':
    '登录已过期，请重新登录。';
}
function updateChatDraft(id,changes) {
  const draft={...drafts.get(id),...(id===chat&&conversation&&{membershipRevision}),...changes};
  if(draft.text||draft.target||draft.replyTo||draft.attempt)drafts.set(id,draft);
  else drafts.delete(id);
  persistChatDrafts();
}
const feedbackDraftKey = 'arcade.feedback.pending';
let feedbackDraft;
function feedbackPending(value) {
  feedbackDraft=value;
  try {
    if(value)localStorage.setItem(feedbackDraftKey,JSON.stringify(value));
    else localStorage.removeItem(feedbackDraftKey);
    sessionStorage.removeItem(feedbackDraftKey);
  } catch { /* Keep the in-memory retry if storage is disabled. */ }
}
function currentFeedbackDraft(account) {
  let saved=feedbackDraft;
  try { saved??=JSON.parse(localStorage.getItem(feedbackDraftKey)??sessionStorage.getItem(feedbackDraftKey)); } catch {}
  return saved?.expectedAccount===account?saved:null;
}
function savePostAttempt(attempt) {
  pendingPost=attempt;
  try {
    if(attempt)sessionStorage.setItem(postDraftKey,JSON.stringify(attempt));
    else sessionStorage.removeItem(postDraftKey);
  } catch { /* The in-memory retry remains available. */ }
}
function postAttemptFor(account) {
  let saved=pendingPost;
  try { saved??=JSON.parse(sessionStorage.getItem(postDraftKey)); } catch {}
  return saved?.expectedAccount===account?saved:null;
}
const clientNonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const receiveStatus = el('p', null, 'mobile-only sr-only');
receiveStatus.id = 'chat-receive-status';
receiveStatus.setAttribute('role','status');
$('#chat-detail').after(receiveStatus);
function setReceiveStatus(error) {
  const notice = error ? '暂时收不到新消息，正在重试。' : '';
  if(receiveStatus.textContent !== notice){
    receiveStatus.classList.toggle('sr-only', !notice);
    receiveStatus.textContent = notice;
  }
  const directoryStatus = $('#sync-status');
  const detail = error ? textError(error) : '';
  if(directoryStatus.textContent !== detail) directoryStatus.textContent = detail;
}
function button(text, action, className = 'outline') {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
const olderButton = button('加载更早消息',()=>void syncHistory(true));
olderButton.setAttribute('aria-live','polite');
function resetOlderPage() {
  olderFlight = undefined;
  olderButton.textContent = '加载更早消息';
  olderButton.removeAttribute('aria-disabled');
}
function field(label, name, max, value = '') {
  const node = el('label', label), input = el('input');
  input.name = name;
  input.required = true;
  if (max !== undefined) input.maxLength = max;
  input.value = value;
  node.append(input);
  return {node,input};
}
const roleArt=new Map([['arcade_ju','ju'],['arcade_whale','whale'],['arcade_dragon','dragon']]);
function avatar(name, seed = name, artwork, artworkClass='role-avatar') {
  const node = el('span', Array.from(name?.trim() || '聊')[0], 'avatar');
  node.dataset.tone = String(Array.from(seed || '').reduce((n,c) => n + c.codePointAt(0),0)%4);
  node.setAttribute('aria-hidden','true');
  if(artwork){
    const portrait=el('img');
    portrait.alt='';
    portrait.src=artwork;
    portrait.addEventListener('error',()=>{
      node.classList.remove(artworkClass);
      node.textContent=Array.from(name?.trim()||'聊')[0];
    },{once:true});
    node.classList.add(artworkClass);
    node.replaceChildren(portrait);
  }
  return node;
}
const personAvatar=person=>avatar(person.displayName,person.number,humanAvatarUrl(person),'human-avatar');
function time(value, format=date) {
  return value && !Number.isNaN(Date.parse(value)) ? format.format(new Date(value)) : '';
}
function textError(error) {
  if(error.message==='file_name')return '文件名含不支持的字符，请重命名后再选择。';
  if(error.message==='file_too_large')return '文件超过 16 MiB，请选择较小的文件。';
  if(error.message==='file_session')return '账号或群成员身份已变化，请重新打开目标会话。';
  if(error.message==='invalid_pair')return '这个配对码已过期、已使用或属于其他好友账号。请向分享者索取新码。';
  if(error.message==='pair_code')return '请粘贴分享者给你的完整配对码。';
  if(error.message==='bothouse_unavailable')return '这位角色暂不可用。请到桌面 App 的「更多 → Bothouse」查看。';
  if (error.message === 'feed_session') return '账号已切换，请重新打开好友动态。';
  if (error.message === 'feed_role_unavailable') return '这位角色暂时无法发表新动态。请稍后再试。';
  if (error.message === 'feed_removed') return '这条动态已删除。再次发布会创建新动态。';
  if (error.message === 'feed_conflict') return '发布编号冲突，请重新打开发布窗口。';
  if (error.message === 'ai_cloud_off') return '本段私聊的云聊天已关闭。';
  if (error.message === 'ai_consent_changed') return '云聊天设置已改变，请查看当前状态后再操作。';
  if (error.message === 'ai_provider_confirmation') return '请刷新好友页面或使用新版，再确认 OpenAI（GPT）授权。';
  if (error.message === 'claude_client_update') return '请刷新好友页面或使用新版，再核对 Claude（Anthropic）授权。';
  if (error.message === 'proactive_revision' || error.message === 'proactive_session') return '设置已变化，请重新打开主动联系。';
  if (error.message === 'proactive_hours') return '请填写不同的开始和结束时间。';
  if (error.message === 'proactive_unavailable') return '当前无法开启主动联系，请检查云聊天状态。';
  if (error.message === 'ai_unavailable') return '这个 AI 联系人暂时无法连接云服务。';
  if (error.message === 'personal_ai_private_friend') return '这位个人 AI 仅主人可添加好友。';
  if (error.message === 'personal_ai_private_cloud') return '这位 AI 的主人尚未允许你使用其云聊天服务。';
  if (error.message === 'ai_daily_limit') return '今天的 AI 聊天次数已用完。';
  if (error.message === 'ai_busy') return '正在等 AI 回复，请稍后再发。';
  if (error.message === 'mention_unavailable') return '点名对象已不在群里，请取消或重新选择。';
  if (error.message === 'feedback_build') return '客户端已更新。请刷新后重新打开反馈，你的内容仍在。';
  if (error.message === 'feedback_session') return '账号已切换，请重新登录后再查看反馈。';
  if (error.message === 'report_session') return '账号已切换，请重新打开会话再举报。';
  if (error.message === 'image_session') return '账号已切换，请重新打开会话。';
  if (error.status === 413) return '图片超过大小或尺寸限制，请换一张。';
  if (error.status === 415 || error.status === 422) return '请选择可打开的静态 PNG 或 JPEG。';
  if (!error.status) return '暂时连不上服务，请检查网络后重试。';
  if (error.status === 401) return '请检查用户号和密码，或重新登录。';
  if (error.status === 403) return '你目前没有权限执行这项操作。';
  if (error.status === 404) return '没有找到这项内容，请核对后重试。';
  if (error.status === 409) return '当前状态已变化，或这个用户号已被使用。请刷新后重试。';
  if (error.status === 429) return '操作太频繁，请稍后再试。';
  return error.status === 400 ? '请检查填写内容后重试。' : '服务暂时不可用，请稍后再试。';
}
async function api(route, body, {session = true, expectedAccount, image, voice, fileUpload, timeoutMs=12000} = {}) {
  const epoch = generation;
  const attachment = image || voice || fileUpload;
  const response = await fetch('./api/v1' + route, {
    method:body === undefined ? 'GET' : 'POST',
    headers:{'X-Social-Claude-UI':'1','X-Social-AI-Friend-Roles':'1',...(expectedAccount && {'X-Social-Account':expectedAccount}),
      ...(body !== undefined && {'Content-Type':attachment?.mime||'application/json',
      ...(attachment && {'X-Social-Client-Id':attachment.clientId}),
      ...(attachment?.revision && {'X-Social-Member-Revision':attachment.revision}),
      ...(fileUpload && {'X-Social-File-Name':encodeURIComponent(fileUpload.name)})})},
    ...(body !== undefined && {body:attachment?body:JSON.stringify(body)}),
    credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => null);
  if (session && epoch !== generation) throw new Error('session_changed');
  if (!response.ok || !payload) {
    if (response.status === 401 && session && user && epoch === generation)
      leaveSession({expired:payload?.error?.code==='login_required'});
    throw Object.assign(new Error(payload?.error?.code || 'request_failed'), {status:response.status});
  }
  return payload;
}
function toggleAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  $('#auth-title').textContent = $('#auth-submit').textContent = registering ? '创建账号' : '登录';
  $('#auth-switch').textContent = registering ? '已有账号，去登录' : '创建账号';
  $('#name-field').hidden = $('#number-hint').hidden = !registering;
  const form = $('#auth-form');
  form.elements.displayName.required = registering;
  const password = form.elements.password;
  password.autocomplete = registering ? 'new-password' : 'current-password';
  const passwordHint = $('#password-hint');
  if (passwordHint) {
    passwordHint.hidden = !registering;
    if (registering) password.setAttribute('aria-describedby', passwordHint.id);
    else password.removeAttribute('aria-describedby');
  }
  $('#auth-error').textContent = '';
}
function leaveSession({discardFeedback=false,expired=false}={}) {
  closeStartMenu();
  interruptedDrafts=expired?suspendChatDrafts(user?.number,[...drafts],chat):undefined;
  if(discardFeedback&&currentFeedbackDraft(user?.number))feedbackPending(null);
  stopVoicePlayback();
  ++generation;
  user = null;
  conversationList.scope();
  chatPortrait=undefined;
  chat = conversation = historyContext = historyFinder = undefined;
  friends = incoming = outgoing = conversations = messages = [];
  readThrough.clear();
  readFlights.clear();
  removedMessages.clear();
  drafts.clear();
  persistChatDrafts();
  sending.clear();
  feedbackDraft=undefined;
  savePostAttempt(null);
  feedPosts.replaceChildren();
  feedStatus.textContent='';
  feedCursor=null;
  feedRoles=[];
  feedFollowFlight=false;
  renderFeedRoles();
  syncFlight = historyFlight = undefined;
  closeDialog();
  root.hidden = true;
  root.classList.remove('in-chat');
  showChatHeader();
  $('#directory-actions').replaceChildren();
  $('#directory-body').replaceChildren();
  historyView.replaceChildren();
  resetOlderPage();
  messageBox.value = '';
  $('#chat-avatar').replaceChildren();
  for (const selector of ['#chat-title', '#chat-detail', '#send-error', '#sync-status', '#dialog-error', '#contact-count']) {
    $(selector).textContent = '';
  }
  setReceiveStatus();
  $('#contact-count').hidden = true;
  renderUnreadNavigation();
  if (location.hash) window.history.replaceState(null,'',location.pathname+location.search);
  $('#auth-form').reset();
  toggleAuthMode('login');
  if(expired)noticeExpiredSession();
  auth.hidden = false;
  $('#auth-form').elements.number.focus();
}
async function enterSession(account) {
  user = account;
  const resumeChat=restoreChatDrafts(account.number);
  const epoch = ++generation;
  auth.hidden = true;
  root.hidden = false;
  tab = 'messages';
  $('#auth-form').reset();
  toggleAuthMode('login');
  $('#sync-status').textContent = '';
  renderDirectory();
  if(resumeChat&&!location.hash)window.history.replaceState(null,'','#chat/'+encodeURIComponent(resumeChat));
  const startInChat=!location.hash&&matchMedia('(min-width: 681px)').matches;
  await openFromUrl();
  const visit=chatVisit;
  if (epoch !== generation)return;
  await sync();
  if(startInChat&&epoch===generation&&visit===chatVisit&&tab==='messages'&&!location.hash&&!chat&&!dialog.open){
    const first=conversations[0];
    if(first){
      window.history.replaceState(null,'','#chat/'+encodeURIComponent(first.id));
      await openChat(first.id);
    }
  }
}
const authSwitch = $('#auth-switch'), authSubmit = $('#auth-submit'), authError = $('#auth-error');
authSwitch.addEventListener('click',()=>{
  const goingToLogin = authMode === 'register';
  toggleAuthMode(goingToLogin ? 'login' : 'register');
  if(goingToLogin){
    const {number,password} = $('#auth-form').elements;
    password.value = '';
    (number.value.trim() ? password : number).focus();
  }
});
$('#auth-form').elements.number.addEventListener('input',()=>{
  if(authMode==='register') authError.textContent = '';
});
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (authFlight) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const mode = authMode;
  const body = {number:String(data.get('number')).trim(),password:data.get('password')};
  if(mode==='register') body.displayName=String(data.get('displayName')).trim();
  authFlight = true;
  const inputs = [form.elements.number, form.elements.password, form.elements.displayName];
  for(const input of inputs) input.readOnly = true;
  authSubmit.disabled = authSwitch.disabled = true;
  authSubmit.textContent = mode==='register' ? '正在创建…' : '正在登录…';
  authError.textContent = '';
  let focusLogin = false;
  try { await enterSession((await api('/'+mode,body,{session:false})).user); }
  catch (error) {
    if(mode==='register' && !auth.hidden){
      if(error.message==='number_taken'){
        authError.textContent='这个用户号已被使用。若刚才创建的是你的账号，点「已有账号，去登录」，用刚才的用户号和密码登录。若号码属于其他人，请换一个用户号。';
        form.elements.number.focus();
        form.elements.number.select();
        return;
      }
      if(!error.status || error.status<400 || error.status>=500){
        authError.textContent='暂未收到注册结果。可点「已有账号，去登录」。如果登录不成功，可以回到「创建账号」重试。';
        focusLogin = true;
        return;
      }
    }
    authError.textContent=textError(error);
  }
  finally {
    authFlight=false;
    for(const input of inputs) input.readOnly = false;
    authSubmit.textContent = $('#auth-title').textContent;
    authSubmit.disabled=authSwitch.disabled=false;
    if(focusLogin)authSwitch.focus();
  }
});
function row(name, description, seed, action, extra = '', identity = '', unread = false, person) {
  const content = el('span');
  const title = el('strong',name);
  if(identity||unread) {
    const heading = el('span',null,'row-heading');
    heading.append(title);
    if(unread)heading.append(el('span','未读','row-unread'));
    if(identity)heading.append(el('span',identity,'row-identity'));
    content.append(heading);
  } else content.append(title);
  content.append(el('small',description));
  const node = button('',action,'row');
  node.append(person?personAvatar(person):avatar(name,seed),content);
  if(identity||unread)node.setAttribute('aria-label',[name,identity,description,extra,unread?'未读':''].filter(Boolean).join('，'));
  if(extra) node.append(el('time',extra));
  return node;
}
function empty(message, action) {
  const block=el('div',null,'empty');
  block.append(el('p',message));
  if(action) block.append(action);
  return block;
}
function policyLink(name,href) {
  const link = el('a',name,'privacy-link');
  link.href = href;
  return link;
}
function hasUnread(item) {
  return item.unreadThrough>(readThrough.get(item.id)??0);
}
function setUnreadBadge(badge,label,count,description) {
  if(!badge)return; // The page may have loaded before the service update.
  badge.hidden=!count;
  badge.textContent=count?(count>99?'99+':String(count)):'';
  badge.parentElement.setAttribute('aria-label',count?label+'，'+count+' 个'+description:label);
}
function renderUnreadNavigation() {
  const unread=conversations.filter(hasUnread);
  const others=chat?unread.filter(item=>item.id!==chat).length:0;
  setUnreadBadge($('#message-count'),'消息',unread.length,'未读会话');
  setUnreadBadge($('#back-message-count'),'返回',others,'其他未读会话');
}
function ownNumberControls() {
  const number=field('我的用户号','profile-number',24,user.number);
  number.node.classList.add('profile-number');
  number.input.readOnly=true;
  const status=el('small',null,'minor');
  status.setAttribute('role','status');
  const copy=button('复制用户号',async()=>{
    if(!/\bElectron\//.test(navigator.userAgent)&&navigator.clipboard?.writeText){
      try {
        await navigator.clipboard.writeText(number.input.value);
        status.textContent='已复制用户号。';
        return;
      } catch { /* Fall back to the selected user number. */ }
    }
    if(!number.input.isConnected)return;
    number.input.focus();
    number.input.select();
    let copied=false;
    try {copied=document.execCommand('copy');} catch {}
    status.textContent=copied?'已复制用户号。':'已选中用户号，可按 Ctrl+C 或用系统菜单复制。';
  });
  return [number.node,copy,status];
}
directory.addEventListener('keydown',event=>{
  const row=event.target.closest('[data-chat-id]');
  if(!row||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const rows=[...directory.querySelectorAll('[data-chat-id]')];
  const i=rows.indexOf(row);
  const next={ArrowDown:Math.min(i+1,rows.length-1),ArrowUp:Math.max(i-1,0),Home:0,End:rows.length-1}[event.key];
  if(next===undefined)return;
  event.preventDefault();
  rows[next].focus();
});
const clockTime=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
const dayStamp=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric'});
function listTime(value){
  if(!value)return '';
  const day=new Date(value);
  return time(value,day.toDateString()===new Date().toDateString()?clockTime:dayStamp);
}
const startMenu=$('#start-chat-menu');
function closeStartMenu(){
  if(startMenu)startMenu.open=false;
}
$('#start-new-group')?.addEventListener('click',()=>{closeStartMenu();showMemberPicker();});
$('#start-add-friend')?.addEventListener('click',()=>{closeStartMenu();showSearch();});
document.addEventListener('click',event=>{
  if(startMenu?.open&&!startMenu.contains(event.target))closeStartMenu();
});
startMenu?.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeStartMenu();startMenu.querySelector('summary').focus();}
});
function renderDirectory() {
  if(!user) return;
  conversationList.scope(user.number,tab==='messages');
  renderUnreadNavigation();
  const badge=$('#contact-count');
  badge.hidden=!incoming.length;
  badge.textContent=incoming.length;
  // Background changes update the badge without replacing the focused profile controls.
  if(tab==='profile'&&directory.dataset.profileSession===String(generation))return;
  delete directory.dataset.profileSession;
  const nextTitle = labels[tab];
  $('#directory-title').textContent = nextTitle;
  tabs.forEach(node=>node.setAttribute('aria-current',node.dataset.tab===tab?'page':'false'));
  root.classList.toggle('show-feed',tab==='feed');
  feed.hidden=tab!=='feed';
  if(startMenu){
    startMenu.hidden=tab!=='messages';
    if(startMenu.hidden)closeStartMenu();
  }
  if(tab==='feed')return;
  const actions=$('#directory-actions');
  actions.replaceChildren();
  if(tab==='messages') {
    if(!startMenu)actions.append(button('发起群聊',()=>showMemberPicker()),button('添加朋友',showSearch));
    const directNames=new Map();
    for(const item of conversations) {
      if(item.type!=='direct')continue;
      const name=item.title.normalize('NFC');
      directNames.set(name,(directNames.get(name)||0)+1);
    }
    conversationList.render(conversations,item=>{
      const latest=item.lastMessage, summary=latest?latest.text:item.type==='group'?'群聊已建立':'开始发消息';
      const peer=item.type==='direct'?item.members.find(person=>person.number!==user.number):null;
      const identity=peer?.kind==='ai'?'AI 联系人':
        peer&&(directNames.get(item.title.normalize('NFC'))>1)?peer.number:'';
      const unread=hasUnread(item);
      const node=row(item.title,summary,peer?.kind==='ai'?peer.number:item.id,event=>goChat(item.id,event.detail===0),listTime(latest?.createdAt),identity,unread,peer);
      // OpenIM ConversationItem's two-line grid: name/time above, preview across the second line.
      const content=node.children[1], stamp=node.querySelector('time');
      content.classList.add('conversation-copy');
      if(stamp)content.insertBefore(stamp,content.lastElementChild);
      node.dataset.chatId=item.id;
      node.setAttribute('aria-current',String(chat===item.id));
      return node;
    },empty);
  }
  if(tab==='contacts') {
    actions.append(button('添加朋友',showSearch),button('新的朋友'+(incoming.length?'（'+incoming.length+'）':''),showRequests),button('发起群聊',()=>showMemberPicker()));
    actions.append(button('AI 联系人',showAiContacts));
    const rows=friends.map(person=>row(person.displayName,person.kind==='ai'?'AI 联系人':person.number,person.number,()=>perform(async()=>{
      const response=await api('/direct',{number:person.number});
      goChat(response.conversation.id);
      void sync();
    }),'','',false,person));
    directory.replaceChildren(...(rows.length?rows:[empty('通讯录还没有好友。用用户号添加朋友。')]));
  }
  if(tab==='profile') {
    const profile=el('div',null,'profile');
    profile.append(personAvatar(user),el('h2',user.displayName),button('更换头像',()=>showAvatarEditor(profile)),
      ...ownNumberControls(),button('意见反馈',showFeedback),button('我的举报',showMyReports),
      policyLink('内容准则','./conduct.html'),policyLink('隐私说明','./privacy.html'),
      policyLink('开源与版本','./source.html'),
      button('退出登录',()=>perform(async()=>{await api('/logout',{});leaveSession({discardFeedback:true});})));
    directory.replaceChildren(profile);
    directory.dataset.profileSession=String(generation);
  }
}
function routeId() {
  if(!location.hash.startsWith('#chat/')) return undefined;
  try { return decodeURIComponent(location.hash.slice(6)) || undefined; } catch {return undefined;}
}
async function goChat(id,focusEditor=false) {
  tab='messages';
  const route='#chat/'+encodeURIComponent(id);
  if(location.hash!==route) window.history.pushState(null,'',route);
  await openChat(id);
  const active=document.activeElement;
  if(focusEditor&&chat===id&&conversation&&!dialog.open&&
     (active===document.body||active.id==='back'||active.dataset.chatId===id)){
    (messageBox.readOnly?historyView:messageBox).focus({preventScroll:true});
  }
}
function goTab(next) {
  if(next==='feed') {
    goFeed('friends');
    return;
  }
  tab=next;
  if(location.hash) window.history.pushState(null,'',location.pathname+location.search);
  void openChat(undefined);
}
function forgetConversation(id) {
  conversations=conversations.filter(item=>item.id!==id);
  if(dialogGroup===id)closeDialog();
  if(chat===id) {
    goTab('messages');
    $('#chat-title').textContent='';
    $('#chat-detail').textContent='';
    $('#chat-avatar').replaceChildren();
  } else renderDirectory();
  drafts.delete(id);
  persistChatDrafts();
}
tabs.forEach(node=>node.addEventListener('click',()=>goTab(node.dataset.tab)));
$('#back').addEventListener('click',()=>{
  const previous=chat;
  goTab('messages');
  ([...directory.querySelectorAll('[data-chat-id]')].find(row=>row.dataset.chatId===previous)||tabs[0]).focus();
});
window.addEventListener('hashchange',()=>{if(user)void openFromUrl();});
window.addEventListener('popstate',()=>{if(user)void openFromUrl();});
async function openFromUrl() {
  const hash=location.hash;
  if(hash==='#feed'||hash==='#feed/mine') {
    const scope=hash==='#feed/mine'?'mine':'friends';
    if(tab!=='feed'||scope!==feedScope)await openFeed(scope);
    return;
  }
  const id=routeId();
  if(tab==='feed')closeDialog();
  if(id||tab==='feed')tab='messages';
  await openChat(id);
}
function goFeed(scope) {
  const route=scope==='mine'?'#feed/mine':'#feed';
  if(location.hash!==route)window.history.pushState(null,'',route);
  void openFeed(scope);
}
async function openFeed(scope) {
  if(dialog.open)closeDialog();
  tab='feed';
  feedScope=scope;
  $('#feed-role').open=false;
  feedPosts.replaceChildren();
  renderFeedRoles();
  document.querySelectorAll('[data-feed-scope]').forEach(node=>
    node.setAttribute('aria-pressed',String(node.dataset.feedScope===scope)));
  await openChat(undefined);
  await loadFeed();
}

function feedPost(post) {
  const entry=el('article',null,'feed-post');
  entry.dataset.author=post.author.number;
  const head=el('div',null,'feed-post__head'), identity=el('div',null,'feed-post__author');
  const meta=el('p',null,'minor'), published=el('time',time(post.createdAt));
  published.dateTime=post.createdAt;
  meta.append(el('span',post.author.number),published);
  identity.append(el('strong',post.author.displayName+(post.author.kind==='ai'?'（AI）':'')),meta);
  head.append(avatar(post.author.displayName,post.author.number),identity);
  if(post.author.number===user.number)head.append(button('删除',()=>confirmDeletePost(post),'report-action'));
  else head.append(button('举报动态',()=>showContentReport({
    kind:'动态',text:post.text,author:post.author,path:'/friend-feed/'+post.id+'/report',
    available:()=>tab==='feed'&&entry.isConnected,
  }),'report-action'));
  entry.append(head,el('p',post.text,'feed-post__body'));
  if(Array.isArray(post.recentComments)){
    const comments=el('div',null,'post-comments');
    for(const row of post.recentComments){
      const line=el('p');line.append(el('strong',row.author.displayName+'：'),document.createTextNode(row.text));
      line.title=row.author.number;comments.append(line);
    }
    const control=button('评论',()=>void perform(async()=>{
      const account=user.number,epoch=generation;
      const {openComments}=await import('./feed-comments.js');
      if(generation!==epoch||tab!=='feed'||!entry.isConnected)return;
      openComments(post,{account,api,el,button,openDialog,closeDialog,clientNonce,textError,
        current:scope=>generation===epoch&&tab==='feed'&&dialogGeneration===scope,
        refresh:notice=>loadFeed(null,notice,true)});
    },control),'report-action');
    comments.append(control);entry.append(comments);
  }
  return entry;
}

function renderFeedRoles() {
  $('#feed-role').hidden=!feedRoles.length||feedScope!=='friends';
  const list=$('#feed-role-list');
  const rows=new Map([...list.children].map(row=>[row.dataset.role,row]));
  for(const role of feedRoles){
    let row=rows.get(role.number);
    if(!row){
      row=el('div',null,'feed-role');
      row.dataset.role=role.number;
      const details=el('div');
      details.append(el('h2',role.displayName+'（AI）'),el('p',null,'minor'));
      row.append(details,button('',()=>void toggleFeedRole(role.number)));
      list.append(row);
    }
    rows.delete(role.number);
    row.querySelector('p').textContent=role.available?(role.following?'已关注':'关注后可查看她仍保留的动态。'):
      '暂时无法发表新动态。';
    const toggle=row.querySelector('button');
    toggle.textContent=(role.following?'取消关注':'关注')+role.displayName+'动态';
    toggle.setAttribute('aria-disabled',String(feedFollowFlight||(!role.available&&!role.following)));
  }
  for(const row of rows.values())row.remove();
}

async function toggleFeedRole(number) {
  const role=feedRoles.find(row=>row.number===number);
  if(!user||tab!=='feed'||!role||feedFollowFlight||(!role.available&&!role.following))return;
  const account=user.number,epoch=generation,enabled=!role.following;
  feedFollowFlight=true;
  renderFeedRoles();
  try{
    const updated=await api('/friend-feed/follow',{role:number,enabled,expectedAccount:account});
    if(generation!==epoch)return;
    if(updated.account!==undefined&&updated.account!==account){leaveSession();return;}
    feedRoles=updated.roles??(updated.role?[updated.role]:[]);
    if(tab==='feed'&&feedScope==='friends'){
      if(!enabled)for(const post of feedPosts.children){
        if(post.dataset.author===number)post.hidden=true;
      }
      await loadFeed(null,enabled?'已关注'+role.displayName+'的动态。':'已取消关注'+role.displayName+'的动态。',true);
    }
  }catch(error){
    if(generation===epoch&&tab==='feed')feedStatus.textContent=textError(error);
  }finally{
    if(generation===epoch){
      feedFollowFlight=false;
      renderFeedRoles();
    }
  }
}

async function loadFeed(before=null,notice='',preserveScroll=false) {
  if(!user||tab!=='feed')return;
  const account=user.number, epoch=generation, read=++feedRead;
  const olderButton=$('#older-posts');
  const current=()=>epoch===generation&&tab==='feed'&&read===feedRead;
  olderButton.disabled=true;
  if(before===null&&!preserveScroll) {
    feedCursor=null;
    feedPosts.replaceChildren();
    olderButton.hidden=true;
  }
  feedStatus.textContent='正在读取动态…';
  try {
    const params=new URLSearchParams({scope:feedScope,comments:'1'});
    if(before!==null)params.set('before',before);
    const payload=await api('/friend-feed?'+params);
    if(!current())return;
    if(payload.account!==account) {
      leaveSession();
      return;
    }
    feedRoles=payload.roles??(payload.role?[payload.role]:[]);
    renderFeedRoles();
    const nodes=payload.posts.map(feedPost);
    if(before===null&&!nodes.length)nodes.push(empty(feedScope==='mine'?'你还没有发过动态。':'你和好友还没有动态。'));
    if(before===null&&preserveScroll){
      const scroll=feed.scrollTop;
      feedPosts.replaceChildren(...nodes);
      feed.scrollTop=scroll;
    }else feedPosts.append(...nodes);
    feedCursor=payload.nextBefore;
    olderButton.hidden=feedCursor===null;
    feedStatus.textContent=notice;
  } catch(error) {
    if(current())feedStatus.textContent=textError(error);
  } finally {
    if(current())olderButton.disabled=false;
  }
}

function showPostComposer() {
  const account=user.number, epoch=generation;
  const form=el('form'), label=el('label','动态正文'), input=el('textarea');
  const author=el('p','发布账号 '+user.displayName+'（'+account+'）','feed-composer-author');
  const note=el('p','你和当前好友可见。以后互加的好友也能查看仍保留的动态。最多 1000 字。','minor');
  const submit=el('button','发布动态','primary');submit.type='submit';
  input.id='post-content';input.required=true;input.maxLength=2000;
  note.id='post-visibility';
  input.setAttribute('aria-describedby',note.id);
  input.addEventListener('input',()=>input.setCustomValidity(Array.from(input.value.trim()).length>1000?'动态最多 1000 字。':''));
  input.value=postAttemptFor(account)?.text||'';
  label.htmlFor=input.id;
  form.append(author,label,input,note,submit);
  const scope=openDialog('发动态',[form]);
  input.focus();
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(!text||scope!==dialogGeneration||epoch!==generation||submit.disabled)return;
    const draft=postAttemptFor(account);
    const attempt=draft?.text===text?draft:{text,expectedAccount:account,clientId:clientNonce()};
    savePostAttempt(attempt);
    void perform(async()=>{
      try { await api('/friend-feed',attempt); }
      catch(error) {
        if(epoch===generation&&pendingPost===attempt&&['feed_removed','feed_conflict'].includes(error.message))savePostAttempt(null);
        throw error;
      }
      if(epoch!==generation)return;
      if(pendingPost===attempt)savePostAttempt(null);
      if(scope===dialogGeneration)closeDialog();
      if(tab==='feed')await loadFeed(null,'动态已发布。');
    },submit,scope);
  });
}

function confirmDeletePost(post) {
  if(post.author.number!==user.number)return;
  const account=user.number, epoch=generation;
  const cancel=button('取消',closeDialog);
  const confirm=button('删除动态',()=>void perform(async()=>{
    await api('/friend-feed/'+post.id+'/delete',{expectedAccount:account});
    if(epoch!==generation)return;
    if(scope===dialogGeneration) {
      closeDialog();
      $('#refresh-feed').focus();
    }
    if(tab==='feed')await loadFeed(null,'动态已删除。');
  },confirm,scope),'primary');
  const actions=el('div',null,'actions');actions.append(cancel,confirm);
  const scope=openDialog('删除动态',[el('p','删除后，你和好友刷新动态就看不到这条内容。'),actions]);
  cancel.focus();
}

document.querySelectorAll('[data-feed-scope]').forEach(node=>
  node.addEventListener('click',()=>goFeed(node.dataset.feedScope)));
$('#refresh-feed').addEventListener('click',()=>void loadFeed());
$('#older-posts').addEventListener('click',()=>{if(feedCursor!==null)void loadFeed(feedCursor);});
$('#compose-post').addEventListener('click',showPostComposer);
const thread = id => '/conversations/'+encodeURIComponent(id);
function mentionLabel(person) {
  return '@'+person.displayName+(person.kind==='ai'?'（AI）':'（'+person.number+'）');
}
function mentionAvailable(target) {
  return !target||conversation?.members.some(member=>member.number===target.number);
}

// Adapted from zuiho-kai/bothouse@8ec73a8f32573b5307922df3c79675a934cdefb7
// dsh/packages/client-ui-discord/src/client/mention-complete.ts (blob a2436cb2dd062d9cf109ceb7d9d716439cd5e48b).
// Copyright 2026 zuiho-kai and bothouse contributors. Apache-2.0.
const mentionBoundary=/[\s([{"'“‘，。、！？：；,.!?:;]/;
function activeMention(text,caret) {
  const head=text.slice(0,caret),at=head.lastIndexOf('@');
  if(at<0)return;
  const query=head.slice(at+1);
  if(/\s/.test(query)||at>0&&!mentionBoundary.test(head[at-1]))return;
  return {start:at,query};
}
function rankMentionMembers(members,query) {
  const q=query.toLowerCase();
  const score=member=>{
    const name=member.displayName.toLowerCase(),id=member.number.toLowerCase();
    if(name.startsWith(q)||id.startsWith(q))return 0;
    if(name.includes(q)||id.includes(q))return 1;
  };
  return members.map(member=>({member,score:score(member)})).filter(row=>row.score!==undefined)
    .sort((a,b)=>Number(a.member.kind==='human')-Number(b.member.kind==='human')||a.score-b.score||
      a.member.displayName.localeCompare(b.member.displayName,'en')||a.member.number.localeCompare(b.member.number,'en'))
    .map(row=>row.member);
}
function applyMention(text,caret,mention,member) {
  // The query ends at the caret. Everything after it belongs to the draft.
  const tail=text.slice(caret),existingSpace=tail.startsWith(' ');
  const insert=`@${member.displayName}${existingSpace?'':' '}`;
  return {text:text.slice(0,mention.start)+insert+tail,marker:{start:mention.start,text:insert},
    caret:mention.start+insert.length+Number(existingSpace)};
}
function insertMention(text,caret,member) {
  const before=text.slice(0,caret),lead=before===''||/\s$/.test(before)?'':' ';
  const insert=`${lead}@${member.displayName} `;
  return {text:before+insert+text.slice(caret),marker:{start:caret,text:insert},caret:caret+insert.length};
}

const mentionSuggestions=$('#mention-suggestions');
let mentionPopup,dismissedMention;
function withoutMention(text,target) {
  const mark=target?.marker;
  return mark&&text.startsWith(mark.text,mark.start)?text.slice(0,mark.start)+text.slice(mark.start+mark.text.length):text;
}
function editedMention(previous,next,target) {
  const mark=target?.marker;
  if(!mark||previous===next)return target;
  let start=0,end=previous.length,newEnd=next.length;
  while(start<end&&start<newEnd&&previous[start]===next[start])start++;
  while(end>start&&newEnd>start&&previous[end-1]===next[newEnd-1]){end--;newEnd--;}
  if(end<=mark.start)return {...target,marker:{...mark,start:mark.start+newEnd-end}};
  if(start>=mark.start+mark.text.length-1&&next.startsWith(mark.text.trimEnd(),mark.start)){
    return {...target,marker:{...mark,text:next.startsWith(mark.text,mark.start)?mark.text:mark.text.trimEnd()}};
  }
}
function closeMentionSuggestions() {
  mentionPopup=undefined;
  if(mentionSuggestions)mentionSuggestions.hidden=true;
  messageBox.removeAttribute('aria-activedescendant');
}
function drawMentionSuggestions() {
  // The previous HTML can still be cached during an upgrade.
  if(!mentionSuggestions||conversation?.type!=='group'||messageBox!==document.activeElement||composingMessage||
    messageBox.selectionStart!==messageBox.selectionEnd){closeMentionSuggestions();return;}
  const text=messageBox.value,caret=messageBox.selectionStart,active=activeMention(text,caret);
  const mark=drafts.get(chat)?.target?.marker;
  if(!active||mark&&active.start>=mark.start&&active.start<mark.start+mark.text.length||
    dismissedMention?.chat===chat&&dismissedMention.start===active.start&&dismissedMention.text===text){
    closeMentionSuggestions();return;
  }
  const people=rankMentionMembers(conversation.members,active.query);
  if(!people.length){closeMentionSuggestions();return;}
  const selected=mentionPopup?.chat===chat&&mentionPopup.text===text&&mentionPopup.caret===caret?
    Math.max(people.findIndex(person=>person.number===mentionPopup.people[mentionPopup.index]?.number),0):0;
  const popup={chat,text,caret,active,people,index:selected};
  mentionPopup=popup;
  mentionSuggestions.replaceChildren(...people.map((person,index)=>{
    const option=button(person.displayName+' · '+(person.kind==='ai'?'AI · ':'')+person.number,()=>chooseMention(person,popup));
    option.id='mention-suggestion-'+index;option.tabIndex=-1;option.setAttribute('role','option');
    option.addEventListener('pointerdown',event=>event.preventDefault());
    return option;
  }));
  mentionSuggestions.hidden=false;
  highlightMention(false);
}
function highlightMention(scroll) {
  [...mentionSuggestions.children].forEach((option,index)=>{
    option.setAttribute('aria-selected',index===mentionPopup.index);
    if(index===mentionPopup.index){
      messageBox.setAttribute('aria-activedescendant',option.id);
      if(scroll)option.scrollIntoView({block:'nearest'});
    }
  });
}
function chooseMention(person,popup) {
  if(popup&&(popup!==mentionPopup||popup.chat!==chat||popup.text!==messageBox.value||popup.caret!==messageBox.selectionStart))return;
  if(!mentionAvailable(person))return;
  let value=messageBox.value,caret=messageBox.selectionStart,active=popup?.active;
  const old=drafts.get(chat)?.target?.marker;
  if(old&&value.startsWith(old.text,old.start)){
    value=withoutMention(value,{marker:old});
    const shift=point=>point-Math.min(Math.max(point-old.start,0),old.text.length);
    caret=shift(caret);
    if(active)active={...active,start:shift(active.start)};
  }
  const next=active?applyMention(value,caret,active,person):insertMention(value,caret,person);
  if(next.text.length>messageBox.maxLength)return;
  const {number,displayName,kind}=person;
  messageBox.value=next.text;
  messageBox.setSelectionRange(next.caret,next.caret);
  updateChatDraft(chat,{floor:historyFloor,text:next.text,target:{number,displayName,kind,marker:next.marker}});
  closeMentionSuggestions();
  showChatHeader();
  messageBox.focus();
}
const workMenu=$('#work-menu');
const taskPrefix='给你一个任务：';
function taskRecipient(){
  const peer=conversation?.type==='direct'?directAiPeer(conversation):drafts.get(chat)?.target;
  return peer?.kind==='ai'&&/^bh_[a-f0-9]{21}$/.test(peer.number)&&mentionAvailable(peer)?peer:null;
}
$('#compose-task')?.addEventListener('click',()=>{
  workMenu.open=false;
  if(!taskRecipient()||messageBox.readOnly)return;
  const target=drafts.get(chat)?.target;
  const body=withoutMention(messageBox.value,target);
  if(!body.trimStart().startsWith(taskPrefix)){
    if(messageBox.value.length+taskPrefix.length>messageBox.maxLength){
      $('#send-error').textContent='草稿已满，请缩短后再添加任务。';
      return;
    }
    const mark=target?.marker;
    const at=mark?.start===0&&messageBox.value.startsWith(mark.text)?mark.text.length:0;
    messageBox.setRangeText(taskPrefix,at,at,'end');
    messageBox.dispatchEvent(new Event('input',{bubbles:true}));
  }
  messageBox.focus();
});
function showMention() {
  const holder=$('#mention-target'),target=conversation?.type==='group'?drafts.get(chat)?.target:undefined;
  if(workMenu){
    const recipient=taskRecipient();
    if(workMenu.dataset.chat!==chat||!recipient)workMenu.open=false;
    workMenu.dataset.chat=chat||'';
    workMenu.hidden=!recipient||messageBox.readOnly;
  }
  holder.hidden=!target;
  holder.replaceChildren();
  if(!target)return;
  if(!mentionAvailable(target))holder.append(el('p','原点名对象已不在群内。请重新点名或明确取消。','minor'));
  holder.append(button(mentionLabel(target)+' · 取消点名',()=>{
    messageBox.value=withoutMention(messageBox.value,target);
    updateChatDraft(chat,{target:undefined,text:messageBox.value});
    showChatHeader();
    messageBox.focus();
  }));
}
function pickMention(person,id,scope) {
  if(id!==chat||scope!==dialogGeneration||conversation?.type!=='group')return;
  closeDialog();
  chooseMention(person);
}
const canAttach = meta => Boolean(meta && (meta.type==='group'||meta.members.every(member=>member.kind==='human')));
const canSendPhoto=meta=>canAttach(meta)||!meta?.personalAi&&meta?.cloudChat?.enabled===true;
const imageUrl = row => './api/v1'+thread(row.conversationId)+'/messages/'+row.id+'/image';

const directAiPeer = meta => meta?.type==='direct'
  ? meta.members.find(person=>person.number!==user?.number&&person.kind==='ai')
  : undefined;
function showReplyTarget() {
  const holder=$('#reply-target');
  if(!holder)return;
  const id=conversation&&drafts.get(chat)?.replyTo;
  holder.hidden=!id;
  const row=id&&visibleHistory().find(row=>row.id===id);
  holder.querySelector('span').textContent=!id?'':removedMessages.has(id)?'原消息已移除':
    row?'回复 '+row.sender.displayName+' · '+[...row.text].slice(0,80).join(''):'已选原消息，发送时附上引用';
}
const visitFriendPlanet=$('#visit-friend-planet');
visitFriendPlanet?.addEventListener('click',async()=>{
  const visit=chatVisit,account=user?.number;
  const friend=conversation?.type==='direct'&&conversation.members.find(p=>p.kind==='human'&&p.number!==account);
  if(!account||!friend)return;
  const feedback=$('#send-error');
  if(!window.arcadeWorldVisit?.open){
    feedback.textContent='请在 Agent Arcade 桌面版打开这段私聊，拜访好友的星球。';
    return;
  }
  visitFriendPlanet.disabled=true;
  feedback.textContent='';
  try{
    const destination=await api('/friend-planet?number='+encodeURIComponent(friend.number),undefined,{expectedAccount:account});
    if(chatVisit!==visit||user?.number!==account)return;
    if(destination.account!==account||destination.number!==friend.number){
      feedback.textContent='好友或账号已变更，请重新打开私聊。';
      return;
    }
    if(!destination.planetId){
      feedback.textContent='这位好友目前没有已连接的星球。';
      return;
    }
    const answer=await window.arcadeWorldVisit.open({account,number:friend.number});
    if(chatVisit!==visit||user?.number!==account)return;
    if(answer?.state!=='opened')
      feedback.textContent=answer?.state==='unavailable'?'这位好友目前没有已连接的星球。':
        answer?.state==='changed'?'好友或账号已变更，请重新打开私聊。':'小星球暂时无法连接，请稍后再试。';
  }catch{
    if(chatVisit===visit&&user?.number===account)feedback.textContent='小星球暂时无法连接，请稍后再试。';
  }finally{visitFriendPlanet.disabled=false;}
});
function showChatHeader() {
  showReplyTarget();
  const available=!!conversation, meta=conversation;
  $('#no-chat').hidden=!!chat;
  $('#chat-head').hidden=!available;
  historyView.hidden=!chat;
  composer.hidden=!available;
  const chatAvatar=$('#chat-avatar');
  if(!available) {
    chatAvatar.replaceChildren();
    showMention();
    closeMentionSuggestions();
    return;
  }
  $('#chat-title').textContent=meta.title;
  const peer=meta.members.find(person=>person.number!==user.number);
  const cloud=meta.cloudChat, paused=cloud?.enabled===false;
  const awaitingAiConsent=meta.requiresAiCloudConsent;
  const legacyPersonal=meta.personalAi===true;
  const aiCount=meta.members.filter(member=>member.kind==='ai').length;
  const groupDetail=meta.members.length+' 位群成员'+(aiCount?' · '+aiCount+' 位 AI':'');
  const cloudService=meta.aiProvider?aiService(meta.aiProvider)+' · ':'';
  $('#chat-detail').textContent=meta.type==='group'?groupDetail:
    legacyPersonal?'原有 AI 私聊 · 可查看历史':
      cloud?cloudService+(paused?'云聊天已关闭':'云聊天已开启'):awaitingAiConsent?cloudService+'未开启云聊天':peer?.kind==='ai'?'AI 联系人':peer?.number||'';
  const aiPeer=directAiPeer(meta);
  const avatarSeed=aiPeer?.number??meta.id;
  const builtinArt=roleArt.get(aiPeer?.number);
  const humanPeer=meta.type==='direct'&&peer?.kind==='human'?peer:null;
  if(visitFriendPlanet)visitFriendPlanet.hidden=!humanPeer;
  const artwork=builtinArt?'./art/'+builtinArt+'.png':
    aiPeer&&chatPortrait?.visit===chatVisit&&chatPortrait.number===aiPeer.number?chatPortrait.data:humanAvatarUrl(humanPeer);
  if(!chatAvatar.firstElementChild||chatAvatar.dataset.seed!==avatarSeed||
    chatAvatar.dataset.name!==meta.title||chatAvatar.firstElementChild.querySelector('img')?.getAttribute('src')!==artwork){
    chatAvatar.dataset.seed=avatarSeed;
    chatAvatar.dataset.name=meta.title;
    chatAvatar.replaceChildren(humanPeer?personAvatar(humanPeer):avatar(meta.title,avatarSeed,artwork));
  }
  $('#members').hidden=meta.type!=='group';
  $('#ai-cloud').hidden=legacyPersonal?!cloud?.enabled:!cloud&&!awaitingAiConsent;
  if(personalAiProfileButton)personalAiProfileButton.hidden=meta.personalAiOwner!==true;
  const search=$('#ai-web-search');
  search.hidden=!meta.webSearch;
  search.textContent='公开网页搜索 · '+(meta.webSearch?.enabled?'已开启':'已关闭');
  $('#ai-voice').hidden=meta.personalAi||!(cloud?.enabled||meta.type==='group'&&aiCount);
  $('#ai-proactive').hidden=meta.personalAi||!(meta.type==='direct'&&cloud&&peer?.kind==='ai');
  $('#ai-appointments').hidden=!(meta.type==='direct'&&peer?.number==='arcade_whale'&&peer.kind==='ai'&&(cloud||awaitingAiConsent));
  $('#ai-cloud').textContent=awaitingAiConsent?'开启云聊天':paused?'恢复云聊天':'关闭云聊天';
  const cloudAction=$('#ai-cloud'),cloudHolder=paused||awaitingAiConsent?$('#chat-consent-action'):chatSettings;
  if(cloudAction.parentElement!==cloudHolder)cloudHolder.prepend(cloudAction);
  const hasSettings=!!chatSettings.querySelector('button:not([hidden])');
  $('#chat-settings-toggle').hidden=!hasSettings;
  if(!hasSettings)chatSettings.hidePopover();
  messageBox.readOnly=legacyPersonal||paused||awaitingAiConsent;
  messageBox.placeholder=legacyPersonal?'这段原有私聊仅供查看':awaitingAiConsent?'开启云聊天后才能发送':paused?'恢复云聊天后才能发送':'写消息…';
  composer.querySelector('button[type="submit"]').disabled=legacyPersonal||paused||awaitingAiConsent||sending.has(meta.id)||
    !mentionAvailable(drafts.get(meta.id)?.target);
  $('#composer-media').hidden=!canSendPhoto(meta);
  stickerButton.hidden=!canAttach(meta);
  $('#record-voice').hidden=!canAttach(meta);
  if($('#attach-file'))$('#attach-file').hidden=!canAttach(meta);
  if($('#chat-screenshot'))$('#chat-screenshot').hidden=!canSendPhoto(meta);
  $('#mention-member').hidden=meta.type!=='group';
  if(mentionSuggestions)messageBox.setAttribute('aria-autocomplete',meta.type==='group'?'list':'none');
  showMention();
  drawMentionSuggestions();
}
chatSettings.addEventListener('click',event=>{
  if(event.target.closest('button'))chatSettings.hidePopover();
},{capture:true});
function applyCloudConversation(meta) {
  if(chat!==meta.id||!conversation||meta.cloudChat.revision<conversation.cloudChat?.revision) return;
  const changed=meta.cloudChat.enabled!==conversation.cloudChat?.enabled;
  conversation=meta;
  showChatHeader();
  if(changed) renderHistory('keep');
}
$('#ai-web-search').addEventListener('click',()=>{
  const id=chat,account=user.number,epoch=generation;
  const {webSearch:setting,type,cloudChat}=conversation;
  if(!setting)return;
  const enabled=!setting.enabled;
  const nodes=[el('p','当前会话的公开网页搜索'+(setting.enabled?'已开启。':'已关闭。')),
    el('p','开启后，明确请角色查公开资料时，好友服务只把这条消息中的公开主题词发给 Mwmbl。搜索不附带聊天历史、账号或附件，也不会打开任意网页。'),
    el('p','试试「帮我查一下 Blender 的官网」或「帮我搜一下大熊猫的栖息地」。'+
      (type==='group'?'在群里请点名已授权的 AI。':'')+' 找到网页后，点结果旁的「复制网址」即可取用来源。')];
  const editable=setting.canManage&&(!enabled||type==='group'||cloudChat?.enabled);
  if(!editable){
    nodes.push(el('p',type==='group'?'只有群主可以更改本群的搜索设置。':'请先恢复云聊天，再开启公开网页搜索。','minor'));
    return openDialog('公开网页搜索',nodes);
  }
  const apply=button(enabled?'开启本会话的搜索':'关闭本会话的搜索',async()=>{
    apply.disabled=true;
    try{
      const {conversation:updated}=await api(thread(id)+'/web-search',{
        expectedAccount:account,revision:setting.revision,enabled,
      });
      if(generation!==epoch||chat!==id)return;
      conversation=updated;
      showChatHeader();
      if(dialogGeneration===opened)closeDialog();
    }catch(error){
      if(dialogGeneration===opened)$('#dialog-error').textContent=textError(error);
      if(error.status===409)void sync();
    }finally{apply.disabled=false;}
  },'primary');
  const opened=openDialog('公开网页搜索',[...nodes,apply]);
});

const publicImageNotice='AI 可用公开表情图回应。好友服务会向 OpenMoji 请求公开目录和素材，或把筛选后的公开主题词发送给 Wikimedia Commons。图源不接收账号、聊天原文或附件。';

const directDrawingNotice='私聊中明确要求画图时，好友服务会把本次画面描述和适用的角色公开头像发给 Cloudflare Workers AI。重发原图不重新生成。';
const personalDrawingNotice='明确请个人 AI 画图时，好友服务会将本次画面描述发给 Cloudflare Workers AI。请它画自己时，也会使用主人为私聊批准的卡面。聊天照片不会用作参考。重发原图不重新生成。';

personalAiProfileButton?.addEventListener('click',()=>{
  const meta=conversation;
  const peer=meta?.members.find(member=>member.kind==='ai');
  if(meta?.type==='direct'&&meta.personalAiOwner&&peer&&chat===meta.id)
    showPersonalRoleProfile(true,{id:meta.id,roleId:peer.number});
});

$('#ai-cloud').addEventListener('click',()=>{
  const meta=conversation, cloud=meta?.cloudChat;
  const provider=meta?.aiProvider;
  const service=aiService(provider);
  if(meta?.personalAi&&!cloud?.enabled)return;
  if(!cloud){
    const peer=meta?.requiresAiCloudConsent&&meta.members.find(person=>person.kind==='ai');
    if(!peer)return;
    const account=user.number;
    const confirm=button('同意并开始私聊',()=>void perform(async()=>{
      const {conversation:updated}=await api('/ai-contacts/start',{number:peer.number,expectedAccount:account,
        allowCloud:true,provider,...(meta.personalAi&&{personalContext:true})});
      if(chat===meta.id&&user?.number===account)applyCloudConversation(updated);
      if(scope===dialogGeneration)closeDialog();
      void sync();
    },confirm,scope),'primary');
    const actions=el('div',null,'actions');
    actions.append(button('取消',closeDialog),confirm);
    const disclaimer=meta.personalAi
      ? '你发送的新消息、此后这段私聊的近期对话，以及主人批准供私聊使用的角色设定和命中条目，会发送给主人连接的 '+service+'。':
      '开启后，你发给这位角色的消息和本段可分享的近期对话会发送给 '+service+'。';
    const scope=openDialog('开启云聊天',[el('p',disclaimer),...(meta.personalAi?[el('p',personalDrawingNotice,'minor')]:[el('p',publicImageNotice,'minor'),el('p',directDrawingNotice,'minor')]),actions],meta.id);
    return;
  }
  const title=cloud.enabled?'关闭云聊天':'恢复云聊天';
  const details=cloud.enabled
    ? '关闭后可查看聊天记录，正在生成的回复会停止。'+
      (meta.personalAi?'以后恢复时会从新消息开始。':'以后恢复云聊天时，主动联系需要重新开启。')+'已发送给 '+service+' 的内容无法撤回。'
    : meta.personalAi?'同意后，从新消息开始。此后这段私聊的近期对话，以及主人批准供私聊使用的角色设定和命中条目，会发送给 '+service+'。':
      '恢复后，只有你主动发送的新消息及恢复后的近期对话会发给 '+service+'。之前的聊天记录仍可查看，输入框里的内容需要你自己发送。';
  const confirm=button(cloud.enabled?'确认关闭':'同意并恢复',()=>void perform(async()=>{
    const {conversation:updated}=await api(thread(meta.id)+'/ai-consent',{
      expectedAccount:account,revision:cloud.revision,allowCloud:!cloud.enabled,
      ...(meta.personalAi&&!cloud.enabled&&{personalContext:true}),...(provider&&(meta.personalAi||provider!=='deepseek')&&{provider}),
    });
    applyCloudConversation(updated);
    if(scope===dialogGeneration) closeDialog();
    void sync();
  },confirm,scope),'primary');
  const account=user.number;
  const cancel=button('取消',closeDialog);
  const actions=el('div',null,'actions');
  actions.append(cancel,confirm);
  const notices=meta.personalAi?[el('p',personalDrawingNotice,'minor')]:[el('p',publicImageNotice,'minor'),el('p',directDrawingNotice,'minor')];
  const scope=openDialog(title,[el('p',details),...(!cloud.enabled?notices:[]),actions]);
  cancel.focus();
});
const deviceTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';

$('#ai-appointments').addEventListener('click',()=>{
  if(!chat||$('#ai-appointments').hidden)return;
  const id=chat,account=user.number,epoch=generation,route=thread(id)+'/appointments';
  const list=el('div'), content=el('div',null,'appointment-editor');
  list.append(el('p','正在读取约定…','minor'));
  const scope=openDialog('约定提醒',[content,list],id);
  const current=()=>chat===id&&generation===epoch&&scope===dialogGeneration;
  const stateLabels={pending:'待提醒',sent:'已提醒',cancelled:'已取消',missed:'已错过'};
  const create=button('新增约定',()=>edit());
  content.replaceChildren(create);
  async function load(){
    const {appointments}=await api(route);
    if(!current())return;
    const cards=appointments.map(row=>{
      const card=el('div',null,'request'), controls=el('div',null,'actions');
      card.append(el('strong',row.task),el('p',row.wall.replace('T',' ')+'（'+row.timeZone+'） · '+stateLabels[row.state],'minor'));
      if(row.state==='pending'){
        const cancel=button('取消提醒',()=>{
          const confirm=button('确认取消',()=>void perform(async()=>{
            await api(route,{action:'cancel',id:row.id,revision:row.revision,expectedAccount:account});
            if(!current())return;
            content.replaceChildren(create);
            await load();
            void sync();
          },confirm,scope),'primary');
          content.replaceChildren(el('p','取消「'+row.task+'」的提醒？'),
            el('div',null,'actions'));
          content.lastChild.append(button('返回列表',()=>content.replaceChildren(create)),confirm);
          confirm.focus();
        });
        controls.append(button('改时间',()=>edit(row)),cancel);
        card.append(controls);
      }
      return card;
    });
    list.replaceChildren(...(cards.length?cards:[empty('还没有约定。也可以直接说“明天下午 3 点提醒我拿快递”。')]));
  }
  function edit(row){
    const form=el('form',null,'appointment-editor'), date=el('input'), task=el('input');
    const timeZone=row?.timeZone||deviceTimeZone(), nonce=row?.id||clientNonce();
    date.type='datetime-local';
    date.required=true;
    date.value=row?.wall||'';
    const dateLabel=el('label','日期和时间');
    dateLabel.append(date);
    if(row)form.append(el('p',row.task));
    else{
      task.maxLength=180;task.required=true;
      const subject=el('label','提醒事项');
      subject.append(task);
      form.append(subject);
    }
    const actions=el('div',null,'actions'), submit=el('button',row?'保存新时间':'保存约定','primary');
    submit.type='submit';
    actions.append(button('返回列表',()=>content.replaceChildren(create)),submit);
    form.append(dateLabel,el('p','时区 '+timeZone,'minor'),actions);
    content.replaceChildren(form);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      void perform(async()=>{
        const action=row?'move':'create';
        await api(route,{action,id:nonce,revision:row?.revision,expectedAccount:account,task:task.value,timeZone,wall:date.value});
        if(!current())return;
        content.replaceChildren(create);
        await load();
        void sync();
      },submit,scope);
    });
    (row?date:task).focus();
  }
  void perform(load,null,scope);
});

$('#ai-proactive').addEventListener('click',async()=>{
  if(!chat||!conversation?.cloudChat)return;
  const id=chat,account=user.number,epoch=generation;
  const route=thread(id)+'/ai-proactive';
  const body=el('div');
  body.append(el('p','正在读取设置…','minor'));
  const scope=openDialog('主动联系',[body],id);
  const current=()=>chat===id&&generation===epoch&&scope===dialogGeneration;
  try {
    let {settings}=await api(route);
    if(!current())return;
    const form=el('form');
    const consent=el('label',null,'choice'), enabled=el('input');
    enabled.type='checkbox';
    enabled.checked=settings.enabled;
    enabled.disabled=!settings.enabled&&!(settings.available&&settings.cloudEnabled);
    consent.append(enabled,'允许它主动找我');
    const hours=el('div',null,'proactive-hours'), start=el('input'), end=el('input');
    const timeText=minute=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
    const hourField=(input,label,minute)=>{
      const node=el('label',label);
      input.type='time';
      input.required=true;
      input.value=timeText(minute);
      node.append(input);
      return node;
    };
    hours.append(hourField(start,'方便时段开始',settings.startMinute),hourField(end,'方便时段结束',settings.endMinute));
    const deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    let timeZone=settings.timeZone||deviceZone;
    const clock=el('p','时区 '+timeZone,'minor');
    const useDevice=button('使用这台设备的时区',()=>{
      timeZone=deviceZone;
      clock.textContent='时区 '+timeZone;
      useDevice.hidden=true;
    });
    useDevice.hidden=timeZone===deviceZone;
    const notice=el('p','选定时段内，这段私聊满 6 小时没有新消息时，角色每天最多尝试一次，也可以保持安静。关掉窗口仍可收到。'+
      '开启后，'+aiService(conversation.aiProvider)+'只会收到公开角色设定和固定的问候提示。','minor');
    const readiness=el('p',settings.cloudEnabled?'云服务暂时无法主动联系。':
      '请先恢复云聊天，再到这里开启主动联系。','minor');
    readiness.hidden=settings.cloudEnabled&&settings.available;
    const status=el('p',null,'minor');
    status.setAttribute('role','status');
    const submit=el('button','保存设置','primary');submit.type='submit';
    form.append(consent,readiness,hours,clock,useDevice,notice,submit,status);
    body.replaceChildren(form);
    const toMinute=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(!current())return;
      void perform(async()=>{
        const result=await api(route,{expectedAccount:account,revision:settings.revision,enabled:enabled.checked,
          startMinute:toMinute(start.value),endMinute:toMinute(end.value),timeZone});
        if(!current())return;
        settings=result.settings;
        enabled.checked=settings.enabled;
        start.value=timeText(settings.startMinute);
        end.value=timeText(settings.endMinute);
        timeZone=settings.timeZone;
        clock.textContent='时区 '+timeZone;
        useDevice.hidden=timeZone===deviceZone;
        status.textContent=settings.enabled?'已允许主动联系。':'主动联系已关闭。';
      },submit,scope);
    });
  } catch(error) {
    if(current())body.textContent=textError(error);
  }
});
async function openChat(id) {
  if(!user) return;
  if(id===chat && (conversation||!id)) {renderDirectory();showChatHeader();return;}
  stopVoicePlayback();
  if(dialogMessage||chat&&dialogGroup===chat)closeDialog();
  const epoch=generation, visit=++chatVisit;
  chatPortrait=undefined;
  chatSettings.hidePopover();
  messageActions.hidePopover();
  chat=id;
  conversation=historyContext=undefined;
  messages=[];
  older=false;
  moderationCursor=historyFloor=historyAfter=0;
  membershipRevision=undefined;
  removedMessages.clear();
  historyFlight=undefined;
  root.classList.toggle('in-chat',!!id);
  messageBox.value='';
  $('#send-error').textContent='';
  showChatHeader();
  renderDirectory();
  historyView.replaceChildren();
  resetOlderPage();
  if(!id) return;
  historyView.append(empty('正在打开会话…',button('返回消息',()=>goTab('messages'))));
  try {
    const [meta, data]=await Promise.all([api(thread(id)),api(thread(id)+'/messages?limit='+pageSize+'&removedAfter=latest')]);
    if(generation!==epoch||chatVisit!==visit) return;
    conversation=meta.conversation;
    messages=data.messages;
    older=messages.length===pageSize;
    moderationCursor=data.moderation?.cursor??0;
    historyFloor=data.moderation?.historyFloor??0;
    membershipRevision=data.moderation?.membershipRevision;
    const draft=drafts.get(id);
    if(draft&&(draft.floor!==historyFloor||(draft.membershipRevision&&draft.membershipRevision!==membershipRevision))){
      drafts.delete(id);
      persistChatDrafts();
    }
    messageBox.value=drafts.get(id)?.text||'';
    historyAfter=messages.at(-1)?.id??0;
    readThrough.set(id,Math.max(readThrough.get(id)??0,conversation.readThrough??0));
    showChatHeader();
    renderHistory('end');
    void loadChatPortrait(id,visit);
    if(matchMedia('(max-width: 680px)').matches&&document.activeElement===document.body)
      $('#back').focus({preventScroll:true});
    void acknowledgeRead();
  } catch(error) {
    if(generation!==epoch||chatVisit!==visit) return;
    if(error.status===403||error.status===404) {
      forgetConversation(id);
      $('#sync-status').textContent=textError(error);
      return;
    }
    historyView.replaceChildren(empty(textError(error),button('返回消息',()=>goTab('messages'))),
      button('重新打开',()=>void openChat(id)));
  }
}
async function loadChatPortrait(id,visit) {
  const number=directAiPeer(conversation)?.number;
  if(!/^bh_[a-f0-9]{21}$/.test(number||''))return;
  const expectedAccount=user.number;
  try {
    const {portrait}=await api(thread(id)+'/role-portrait',undefined,{expectedAccount});
    if(chatVisit!==visit||chat!==id||user?.number!==expectedAccount||directAiPeer(conversation)?.number!==number)return;
    if(typeof portrait!=='string'||!/^data:image\/(png|jpeg);base64,/.test(portrait))return;
    chatPortrait={visit,number,data:portrait};
    showChatHeader();
  } catch {
    // An unavailable portrait leaves the regular avatar in place.
  }
}
async function acknowledgeRead() {
  if(!user||!chat||historyContext||historyFinder||!Number.isSafeInteger(conversation?.readThrough)||!socialVisible||document.hidden||readFlights.has(chat))return;
  const id=chat, epoch=generation, expectedAccount=user.number;
  const through=messages.findLast(row=>row.id<=historyAfter&&row.sender.number!==expectedAccount&&!row.removed)?.id;
  if(!(through>(readThrough.get(id)??0)))return;
  const lock={};
  readFlights.set(id,lock);
  try{
    const receipt=await api(thread(id)+'/read',{expectedAccount,through});
    if(generation!==epoch)return;
    readThrough.set(id,Math.max(readThrough.get(id)??0,receipt.readThrough));
    renderDirectory();
  }catch{
    // Leave the unread badge in place and retry on ordinary synchronization.
  }finally{
    if(readFlights.get(id)===lock)readFlights.delete(id);
  }
}
function textBubble(message,text) {
  if(message.sender.kind==='ai'&&!message.removed&&typeof window.renderMarkdown==='function'){
    try{
      const body=el('div',null,'body ai-markdown');
      // The upstream renderer escapes input and only emits its own markup.
      // Keep model-supplied URLs selectable without allowing navigation from a bubble.
      const rendered=document.createElement('template');
      rendered.innerHTML=window.renderMarkdown(text);
      for(const link of rendered.content.querySelectorAll('a')){
        const url=link.getAttribute('href');
        const label=link.textContent;
        if(label!==url)link.append(' ('+url+')');
        link.replaceWith(...link.childNodes);
      }
      body.append(rendered.content);
      return body;
    }catch{
      // Only this bubble falls back to plain text.
    }
  }
  return el('p',text,'body');
}
const latestHistoryButton=button('回到最新消息',()=>{
  if(!historyContext)return;
  historyContext=undefined;
  resetOlderPage();
  renderHistory('end');
  historyView.focus({preventScroll:true});
  void acknowledgeRead();
},'outline history-latest');
function visibleHistory(){return historyContext?.messages??messages;}
function voiceOfferControls(message) {
  const {revision}=message.personalVoiceOffer;
  const group=message.conversationId, account=user.number, epoch=generation, visit=chatVisit;
  const panel=el('div'), actions=el('div',null,'actions'), status=el('small',null,'minor');
  status.setAttribute('role','status');
  let busy=false;
  for(const [label,action] of [['仅本群允许并继续','room'],['记住 Azure 选择并继续','remember'],['仅回文字','text']]){
    actions.append(button(label,async()=>{
      if(busy||chat!==group||user?.number!==account)return;
      busy=true;
      for(const control of actions.children)control.disabled=true;
      status.textContent='正在继续这条请求…';
      try{
        const response=await api(thread(group)+'/messages/'+message.id+'/personal-voice',
          {action,revision,expectedAccount:account},{expectedAccount:account,timeoutMs:65000});
        if(generation===epoch&&chatVisit===visit)merge([response.message,...(response.reply?[response.reply]:[])],'end');
        if(generation===epoch)void sync();
      }catch(error){
        if(generation!==epoch||chatVisit!==visit)return;
        status.textContent=textError(error);
        if(error.status!==409){
          busy=false;
          for(const control of actions.children)control.disabled=false;
        }
      }
    },'outline'));
  }
  panel.append(el('p','可用主人选好的音色。好友服务的 Azure 会收到朗读台词。记住后，仅在你已加入并允许角色接话的群沿用。','minor'),
    actions,status);
  return panel;
}
// Adapted from Tinode messages-view.jsx. A long pause or local date change starts a new run.
function sameRun(a,b){
  if(!a||!b||a.sender.number!==b.sender.number)return false;
  const first=new Date(a.createdAt),last=new Date(b.createdAt);
  return first.toDateString()===last.toDateString()&&last-first>=0&&last-first<300000;
}
function renderHistory(scroll) {
  const oldTop=historyView.scrollTop, oldHeight=historyView.scrollHeight;
  const imageButtons=new Map([...historyView.querySelectorAll('[data-image-id]')]
    .map(node=>[Number(node.dataset.imageId),node]));
  const voiceButtons=new Map([...historyView.querySelectorAll('[data-voice-id]')]
    .map(node=>[Number(node.dataset.voiceId),node]));
  const focusedVoice=document.activeElement?.dataset?.voiceId?document.activeElement:null;
  const focusedAction=document.activeElement?.dataset?.messageAction;
  const focusedAnchor=document.activeElement?.classList.contains('history-anchor')?historyContext?.anchor:undefined;
  const focusedOlder=document.activeElement===olderButton;
  const nodes=[];
  const paused=conversation?.cloudChat?.enabled===false;
  const rows=visibleHistory();
  if(historyContext)nodes.push(latestHistoryButton);
  if(historyContext?.older??older) nodes.push(olderButton);
  if(!rows.length) nodes.push(empty(conversation?.requiresAiCloudConsent?'在上方开启云聊天后，就可以和她打招呼。':'还没有消息。先打个招呼。'));
  for(const [index,message] of rows.entries()) {
    const previous=rows[index-1], next=rows[index+1];
    const day=new Date(message.createdAt).toDateString();
    if(!previous||day!==new Date(previous.createdAt).toDateString())nodes.push(el('p',time(message.createdAt,dayStamp),'history-day'));
    const mine=message.sender.number===user.number;
    const bubble=el('article',null,'bubble'+(mine?' mine':''));
    bubble.dataset.historyMessage=message.id;
    const continued=sameRun(previous,message), continues=sameRun(message,next);
    bubble.dataset.sequence=continued?(continues?'middle':'last'):(continues?'first':'single');
    if(historyContext?.anchor===message.id){bubble.classList.add('history-anchor');bubble.tabIndex=-1;}
    const content=el('div',null,'bubble-content');
    const senderProfile=mine?user:conversation?.members.find(member=>member.number===message.sender.number)??message.sender;
    bubble.append(personAvatar(senderProfile),content);
    const aiLabel=message.sender.aiOwner?' · '+message.sender.aiOwner+' 的 AI':message.sender.kind==='ai'?' · AI':'';
    const sender=mine?'我':message.sender.displayName+aiLabel;
    const address=message.mention?.aiOwner?'@'+message.mention.displayName+'（'+message.mention.aiOwner+' 的 AI）':message.mention&&mentionLabel(message.mention);
    const text=address&&!message.removed?address+' '+message.text:message.text;
    const meta=el('div',null,'meta');
    const label=el('span',sender,'message-sender');
    const stamp=el('time',time(message.createdAt,clockTime));
    stamp.dateTime=message.createdAt;
    stamp.title=time(message.createdAt,reportDate);
    meta.append(label,stamp);
    if(!message.removed){
      const control=button('⋯',()=>showMessageActions(message.id,control),'message-action-trigger');
      control.dataset.messageAction=message.id;
      control.setAttribute('aria-label','消息操作');
      control.setAttribute('aria-controls','message-actions');
      control.setAttribute('aria-expanded',String(messageActions.matches(':popover-open')&&messageAction?.id===message.id));
      meta.append(control);
    }
    if(message.attachment?.type==='image'&&!message.removed){
      let open=imageButtons.get(message.id);
      if(!open){
        const preview=el('img');preview.alt=message.attachment.sticker?.label||
          (message.attachment.drawing?'AI 绘制的图片':'聊天图片');preview.loading='lazy';
        preview.width=message.attachment.width;preview.height=message.attachment.height;
        preview.src=imageUrl(message);
        const className=message.attachment.sticker?'image-bubble sticker-bubble':'image-bubble';
        open=button('查看原图',()=>showOriginalImage(message),className);
        open.replaceChildren(preview);
        open.dataset.imageId=message.id;
        open.setAttribute('aria-label','查看原图');
      }
      content.append(meta,open);
      const sticker=message.attachment.sticker;
      if(sticker?.source)content.append(el('p',sticker.label,'minor'));
    }else if(message.attachment?.type==='file'&&!message.removed){
      const {name,bytes}=message.attachment;
      const save=el('a','保存文件','save-chat-file');
      save.href='./api/v1'+thread(message.conversationId)+'/messages/'+message.id+'/file/download?account='+encodeURIComponent(user.number);
      save.download=name;
      content.append(meta,el('strong',name,'chat-file-name'),el('small',fileSize(bytes),'minor'),save);
    }else if(message.attachment?.type==='voice'&&!message.removed){
      let control=voiceButtons.get(message.id);
      if(!control){
        control=button('',()=>void toggleVoice(message,control),'outline voice-bubble');
        control.dataset.voiceId=message.id;
        paintVoice(control,message.attachment.durationMs);
      }
      content.append(meta,control);
    }else if(message.webResults?.length&&!message.removed){
      const results=el('div',null,'body web-results');
      const info=el('details');
      info.append(el('summary','来源说明'),el('p','搜索索引由 Mwmbl 提供，结果许可为 CC BY-NC-SA 4.0。'));
      const license='https://creativecommons.org/licenses/by-nc-sa/4.0/';
      info.append(el('small',license,'minor'));
      for(const {title,url} of message.webResults){
        const row=el('div',null,'web-result');
        const status=el('small',null,'minor');
        status.setAttribute('role','status');
        row.append(el('span',title),button('复制网址',async()=>{
          try{await navigator.clipboard.writeText(url);status.textContent='已复制网址';}
          catch{status.textContent='可手动复制下方网址';}
        },'outline'),el('small',url,'minor'),status);
        results.append(row);
      }
      results.append(info);
      content.append(meta,results);
    }else content.append(meta,textBubble(message,text));
    if(message.quote&&!message.removed)meta.after(quoteControl(message.quote,locateQuotedMessage));
    if(mine&&!message.removed&&message.personalVoiceOffer)content.append(voiceOfferControls(message));
    if(message.imageQuestion){
      const photo=rows.find(row=>row.id===message.imageQuestion.image&&row.attachment?.type==='image'&&!row.removed);
      if(photo)content.append(button('查看所问图片',()=>showOriginalImage(photo),'outline'));
      else content.append(el('p','关于一张聊天图片的问题','minor'));
    }
    if(!message.removed&&message.aiReply==='failed')content.append(el('p',conversation.type==='group'?
      '本条没有收到 AI 回复。消息已发到群里。':paused?'AI 未能回复。':'AI 未能回复。你可以再发一条。','meta'));
    if(!message.removed&&message.aiReply==='pending'&&!paused)content.append(el('p','正在等 AI 回复…','meta'));
    nodes.push(bubble);
  }
  historyView.replaceChildren(...nodes);
  if(focusedOlder&&olderButton.isConnected)olderButton.focus({preventScroll:true});
  if(!resolveMessageAction())messageActions.hidePopover();
  if(focusedVoice?.isConnected)focusedVoice.focus({preventScroll:true});
  if(focusedAction)historyView.querySelector('[data-message-action="'+focusedAction+'"]')?.focus({preventScroll:true});
  if(focusedAnchor)historyView.querySelector('[data-history-message="'+focusedAnchor+'"]')?.focus({preventScroll:true});
  if(scroll==='end') historyView.scrollTop=historyView.scrollHeight;
  else if(scroll==='prepend') historyView.scrollTop=oldTop+historyView.scrollHeight-oldHeight;
  else historyView.scrollTop=oldTop;
  positionMessageActions();
}
function resolveMessageAction(){
  if(messageAction?.chat===chat)return visibleHistory().find(row=>row.id===messageAction.id&&!row.removed);
}
function positionMessageActions(){
  if(!messageActions.matches(':popover-open'))return;
  const control=historyView.querySelector('[aria-expanded="true"][data-message-action]');
  if(!control){messageActions.hidePopover();return;}
  const rect=control.getBoundingClientRect(),viewport=historyView.getBoundingClientRect();
  if(rect.bottom<=viewport.top||rect.top>=viewport.bottom){messageActions.hidePopover();return;}
  const width=messageActions.offsetWidth,height=messageActions.offsetHeight;
  messageActions.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';
  messageActions.style.top=(rect.bottom+height+10>innerHeight?Math.max(8,rect.top-height-4):rect.bottom+4)+'px';
}
function showMessageActions(id,control){
  if(messageActions.matches(':popover-open')&&messageAction?.id===id){messageActions.hidePopover();return;}
  messageAction={id,chat};
  const row=resolveMessageAction();
  if(!row)return;
  historyView.querySelector('[aria-expanded="true"][data-message-action]')?.setAttribute('aria-expanded','false');
  control.setAttribute('aria-expanded','true');
  const reply=$('#reply-message');
  if(reply)reply.hidden=messageBox.readOnly||sending.has(chat)||!$('#reply-target');
  $('#copy-message').hidden=!!row.attachment;
  $('#message-action-status').textContent='';
  messageActions.showPopover({source:control});
  positionMessageActions();
  messageActions.querySelector('button:not([hidden])').focus();
}
messageActions.addEventListener('toggle',event=>{
  if(event.newState==='closed'){
    historyView.querySelector('[aria-expanded="true"][data-message-action]')?.setAttribute('aria-expanded','false');
    messageAction=undefined;
  }
});
messageActions.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  event.preventDefault();
  const control=historyView.querySelector('[aria-expanded="true"][data-message-action]');
  messageActions.hidePopover();
  control?.focus({preventScroll:true});
});
$('#reply-message')?.addEventListener('click',()=>{
  const row=resolveMessageAction();
  if(!row||messageBox.readOnly||sending.has(chat))return;
  if(drafts.get(chat)?.replyTo!==row.id)
    updateChatDraft(chat,{replyTo:row.id,floor:historyFloor,attempt:undefined});
  messageActions.hidePopover();
  showReplyTarget();
  messageBox.focus();
});
$('#cancel-reply')?.addEventListener('click',()=>{
  if(!chat||sending.has(chat))return;
  updateChatDraft(chat,{replyTo:undefined,attempt:undefined});
  showReplyTarget();
  messageBox.focus();
});
$('#copy-message').addEventListener('click',async()=>{
  const row=resolveMessageAction();
  if(!row||row.attachment)return;
  try{await navigator.clipboard.writeText(row.text);messageActions.hidePopover();}
  catch{$('#message-action-status').textContent='可选中消息文字手动复制。';}
});
$('#report-message').addEventListener('click',()=>{
  const row=resolveMessageAction();
  messageActions.hidePopover();
  if(row)showMessageReport(row);
});
window.addEventListener('resize',positionMessageActions);
historyView.addEventListener('scroll',positionMessageActions,{passive:true});
function mergeHistoryRows(previous,rows,append){
  const known=new Map(previous.map(row=>[row.id,row]));
  let changed=false;
  for(const row of rows) {
    const previous=known.get(row.id);
    if(!previous?append:previous.aiReply==='pending'&&['answered','failed'].includes(row.aiReply)){
      known.set(row.id,row);
      changed=true;
    }
  }
  for(const [id,row] of known) {
    if(row.quote?.id&&removedMessages.has(row.quote.id)){
      known.set(id,{...row,quote:{unavailable:true}});
      changed=true;
    }
    if(!row.removed&&removedMessages.has(id)){
      known.set(id,{...row,quote:undefined,attachment:undefined,removed:true,text:'[已移除]'});
      changed=true;
    }
  }
  return changed?[...known.values()].sort((a,b)=>a.id-b.id):previous;
}
function merge(rows,scroll,removedIds=[],intoContext=false){
  for(const id of removedIds)removedMessages.add(id);
  for(const row of rows)if(row.removed)removedMessages.add(row.id);
  if(removedIds.length)showReplyTarget();
  historyFinder?.removeResults();
  if(dialogMessage?.chatId===chat&&removedMessages.has(dialogMessage.messageId))closeDialog();
  if(inlineVoice&&removedMessages.has(inlineVoice.id))stopVoicePlayback();
  const before=visibleHistory();
  messages=mergeHistoryRows(messages,intoContext?[]:rows,true);
  if(historyContext)historyContext.messages=mergeHistoryRows(historyContext.messages,rows,intoContext);
  if(visibleHistory()!==before||scroll==='prepend')renderHistory(historyContext&&!intoContext?'keep':scroll);
}
async function syncHistory(loadOlder=false) {
  const context=historyContext;
  if(!chat||!conversation||loadOlder&&!(context?.older??older)) return true;
  if(loadOlder ? olderFlight : historyFlight) return false;
  const id=chat, epoch=generation, visit=chatVisit, lock={};
  if(loadOlder){
    olderFlight=lock;
    olderButton.textContent='正在加载更早消息…';
    olderButton.setAttribute('aria-disabled','true');
  }else historyFlight=lock;
  try {
    const pending=messages.find(row=>!row.removed&&row.aiReply==='pending');
    const after=pending?Math.min(pending.id-1,historyAfter):historyAfter;
    const cursor=loadOlder?'before='+(context?.messages??messages)[0].id:'after='+after;
    const data=await api(thread(id)+'/messages?'+cursor+'&limit='+pageSize+'&removedAfter='+moderationCursor);
    if(generation!==epoch||chatVisit!==visit||loadOlder&&historyContext!==context) return false;
    if(data.moderation&&(data.moderation.historyFloor!==historyFloor||
      data.moderation.membershipRevision!==membershipRevision)){
      // Membership or its visible-history floor changed.
      // Drop the previous view before reopening the same URL.
      forgetConversation(id);
      goChat(id);
      return false;
    }
    moderationCursor=Math.max(moderationCursor,data.moderation?.cursor??0);
    if(loadOlder){
      if(context)context.older=data.messages.length===pageSize;
      else older=data.messages.length===pageSize;
      olderButton.textContent='加载更早消息';
    }else historyAfter=Math.max(historyAfter,data.messages.at(-1)?.id??0);
    const nearEnd=historyView.scrollHeight-historyView.scrollTop-historyView.clientHeight<100;
    merge(data.messages,loadOlder?'prepend':nearEnd?'end':'keep',data.moderation?.removedIds,loadOlder&&!!context);
    if(!loadOlder&&nearEnd)void acknowledgeRead();
    return true;
  } catch(error) {
    if(chatVisit===visit&&generation===epoch&&(!loadOlder||context===historyContext)) {
      if(error.status===403||error.status===404) {
        forgetConversation(id);
        $('#sync-status').textContent=textError(error);
      } else if(loadOlder) olderButton.textContent='加载失败，重试更早消息';
      else setReceiveStatus(error);
    }
    return false;
  } finally {
    if(olderFlight===lock){
      olderFlight=undefined;
      olderButton.removeAttribute('aria-disabled');
    }
    if(historyFlight===lock)historyFlight=undefined;
  }
}
async function sync() {
  if(!user||syncFlight) return;
  const epoch=generation, lock={};
  syncFlight=lock;
  try {
    const [people,requests,threads]=await Promise.all([api('/friends'),api('/friend-requests'),api('/conversations')]);
    if(generation!==epoch||syncFlight!==lock) return;
    const changed=JSON.stringify([friends,incoming,outgoing,conversations])!==JSON.stringify([people.friends,requests.incoming,requests.outgoing,threads.conversations]);
    friends=people.friends;incoming=requests.incoming;outgoing=requests.outgoing;conversations=threads.conversations;
    const accessible=new Set(conversations.map(item=>item.id));
    const removedDrafts=[...drafts.keys()].filter(id=>!accessible.has(id));
    for(const id of removedDrafts)drafts.delete(id);
    if(removedDrafts.length)persistChatDrafts();
    for(const item of conversations)readThrough.set(item.id,Math.max(readThrough.get(item.id)??0,item.readThrough??0));
    if(changed)renderDirectory();
    if(chat&&conversation) {
      const active=conversations.find(item=>item.id===chat);
      if(active) {
        if(active.cloudChat) {
          if(active.cloudChat.revision!==conversation.cloudChat?.revision||
            active.webSearch?.revision!==conversation.webSearch?.revision)applyCloudConversation(active);
        }
        else if(active.title!==conversation.title||active.webSearch?.revision!==conversation.webSearch?.revision||
            JSON.stringify(active.members)!==JSON.stringify(conversation.members)) {
          const avatarsChanged=active.members.some(member=>member.avatarRevision!==
            conversation.members.find(previous=>previous.number===member.number)?.avatarRevision);
          conversation=active;showChatHeader();
          if(dialog.open&&dialog.dataset.memberPanel===active.id)showGroupMembers(active);
          if(avatarsChanged)renderHistory();
        }
      }

    }
    const received = await syncHistory();
    if(received&&generation===epoch&&syncFlight===lock) setReceiveStatus();
  } catch(error) {
    if(generation===epoch&&syncFlight===lock) setReceiveStatus(error);
  } finally {if(syncFlight===lock)syncFlight=undefined;}
}
setInterval(()=>{if(socialVisible&&!document.hidden)void sync();},2500);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
window.addEventListener('arcade-social-deactivate',()=>{socialVisible=false;});
window.addEventListener('arcade-social-activate',()=>{socialVisible=true;void sync();});
window.addEventListener('online',()=>void sync());
messageBox.addEventListener('input',()=>{
  if(!chat||!conversation)return;
  const saved=drafts.get(chat),target=editedMention(saved?.text||'',messageBox.value,saved?.target);
  updateChatDraft(chat,{floor:historyFloor,text:messageBox.value,target});
  dismissedMention=undefined;
  if(target?.number!==saved?.target?.number)showChatHeader();
  else drawMentionSuggestions();
});
const sendButton=composer.querySelector('button[type="submit"]');
const macShortcut=/^Mac/u.test(navigator.platform);
let sendShortcut='enter', composingMessage=false, compositionEnded=false, compositionTimer;
function setSendShortcut(mode){
  sendShortcut=mode==='ctrl-enter'?'ctrl-enter':'enter';
  const modified=sendShortcut==='ctrl-enter';
  const key=modified?(macShortcut?'⌘+Enter':'Ctrl+Enter'):'Enter';
  sendButton.title=key+' 发送 · Shift+Enter 换行';
  sendButton.setAttribute('aria-keyshortcuts',modified?(macShortcut?'Meta+Enter':'Control+Enter'):'Enter');
}
setSendShortcut('enter');
window.addEventListener('arcade-social-send-shortcut',event=>setSendShortcut(event.detail));
messageBox.addEventListener('compositionstart',()=>{
  clearTimeout(compositionTimer);
  composingMessage=true;
  compositionEnded=false;
  closeMentionSuggestions();
});
messageBox.addEventListener('compositionend',()=>{
  composingMessage=false;
  compositionEnded=true;
  clearTimeout(compositionTimer);
  compositionTimer=setTimeout(()=>{compositionEnded=false;},0);
  drawMentionSuggestions();
});
messageBox.addEventListener('keyup',event=>{
  if(event.key==='Enter')compositionEnded=false;
  drawMentionSuggestions();
});
messageBox.addEventListener('click',drawMentionSuggestions);
messageBox.addEventListener('blur',()=>{composingMessage=false;closeMentionSuggestions();});
messageBox.addEventListener('keydown',event=>{
  const popup=mentionPopup;
  if(popup&&!event.isComposing&&event.keyCode!==229&&!composingMessage&&!compositionEnded&&
    !event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const count=popup.people.length;
      popup.index=(popup.index+(event.key==='ArrowDown'?1:-1)+count)%count;
      highlightMention(true);
      return;
    }
    if(event.key==='Escape'){
      event.preventDefault();
      dismissedMention={chat,text:popup.text,start:popup.active.start};
      closeMentionSuggestions();
      return;
    }
    if(event.key==='Enter'||event.key==='Tab'){
      event.preventDefault();
      if(!event.repeat)chooseMention(popup.people[popup.index],popup);
      return;
    }
  }
  if(event.key!=='Enter'||event.isComposing||event.keyCode===229||composingMessage||compositionEnded||event.repeat||messageBox.readOnly)return;
  if(event.shiftKey){
    if(event.ctrlKey||event.metaKey||event.altKey){
      event.preventDefault();
      const {selectionStart,selectionEnd,maxLength,value}=messageBox;
      if(value.length-(selectionEnd-selectionStart)+1<=maxLength){
        messageBox.setRangeText('\n',selectionStart,selectionEnd,'end');
        messageBox.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }
    return;
  }
  if(event.altKey||!macShortcut&&event.metaKey)return;
  const modifier=event.ctrlKey||macShortcut&&event.metaKey;
  if(sendShortcut==='ctrl-enter'?!modifier:modifier)return;
  event.preventDefault();
  if(!sendButton.disabled)composer.requestSubmit();
});
composer.addEventListener('submit',async event=>{
  event.preventDefault();
  const id=chat, epoch=generation, visit=chatVisit;
  const target=drafts.get(id)?.target;
  const text=withoutMention(messageBox.value,target).trim();
  if(!id||!conversation||!text||composingMessage||sendButton.disabled||!mentionAvailable(target)) return;
  if(taskRecipient()&&text===taskPrefix){
    $('#send-error').textContent='请写下要交办的内容。';
    messageBox.focus();
    return;
  }
  const revision=conversation.cloudChat?.revision;
  const mentionAccount=conversation.type==='group'?target?.number:undefined;
  const replyTo=drafts.get(id)?.replyTo;
  const previous=drafts.get(id)?.attempt;
  const reusing=previous?.text===text&&previous.mentionAccount===mentionAccount&&previous.replyTo===replyTo;
  const timeZone=reusing?previous.timeZone:!$('#ai-appointments').hidden?deviceTimeZone():undefined;
  const attempt={clientId:reusing?previous.clientId:clientNonce(),text,aiConsentRevision:revision,mentionAccount,timeZone,replyTo};
  updateChatDraft(id,{floor:historyFloor,text:messageBox.value,attempt});
  sending.add(id);
  showChatHeader();
  $('#send-error').textContent='';
  try {
    const response=await api(thread(id)+'/messages',attempt,
      {expectedAccount:user.number,timeoutMs:conversation?.type==='group'?65000:30000});
    if(generation!==epoch) return;
    const saved=drafts.get(id);
    const unchanged=saved?.replyTo===replyTo&&saved?.target?.number===mentionAccount&&withoutMention(saved?.text||'',saved?.target).trim()===text;
    if(saved?.attempt?.clientId===attempt.clientId)
      updateChatDraft(id,unchanged?{text:undefined,target:undefined,replyTo:undefined,attempt:undefined}:{attempt:undefined});
    if(chatVisit===visit) {
      if(unchanged)messageBox.value='';
      showMention();
      drawMentionSuggestions();
      merge([response.message,...(response.reply?[response.reply]:[])],'end');
      if(response.bothouseStatus==='unavailable')$('#send-error').textContent='消息已保存，角色暂时无法回复。';
      if(response.bothouseStatus==='chat_text_only')$('#send-error').textContent='消息已保存，角色没有执行这条命令。';
      if(response.bothouseStatus==='cancelled')$('#send-error').textContent='消息已保存，角色状态已变更，本次未回复。';
    }
    void sync();
  } catch(error) {
    if(chatVisit===visit&&generation===epoch) {
      if(error.message==='reply_unavailable') {
        $('#send-error').textContent='原消息已移除或不可查看。可取消引用后发送。';
      } else if(error.message==='mention_unavailable') {
        $('#send-error').textContent='原点名对象已不在群内。请重新点名或明确取消。';
        void sync();
      } else if(error.message==='message_session') {
        leaveSession();
      } else if(error.status===403||error.status===404) {
        forgetConversation(id);
        $('#sync-status').textContent=textError(error);
      } else if(error.message==='ai_cloud_off'||error.message==='ai_consent_changed') {
        $('#send-error').textContent=textError(error)+' 这条消息仍在输入框。';
        void sync();
      } else $('#send-error').textContent=textError(error)+' 消息仍在输入框，可再次发送。';
    }
  } finally {
    if(generation===epoch) {sending.delete(id);if(chat===id)showChatHeader();}
  }
});
const wideMembers=matchMedia('(min-width: 1024px)');
function closeDialog() {
  const returnToMembers=dialog.open&&dialog.dataset.memberPanel!==undefined&&dialog.contains(document.activeElement);
  delete dialog.dataset.memberPanel;
  ++dialogGeneration;dialogGroup=dialogMessage=undefined;
  clearDialogResources();
  if(dialog.open)dialog.close();
  $('#dialog-body').replaceChildren();
  if(returnToMembers&&!$('#members').hidden)$('#members').focus({preventScroll:true});
}
$('#dialog-close').addEventListener('click',closeDialog);
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
function openDialog(title, nodes, groupId, memberPanel=false) {
  const dock=memberPanel&&wideMembers.matches;
  if(dialog.open&&dock===dialog.matches(':modal'))dialog.close();
  if(memberPanel)dialog.dataset.memberPanel=groupId;
  else delete dialog.dataset.memberPanel;
  ++dialogGeneration;
  clearDialogResources();
  dialogMessage=undefined;
  dialogGroup=groupId;
  $('#dialog-title').textContent=title;
  $('#dialog-error').textContent='';
  $('#dialog-body').replaceChildren(...nodes);
  if(!dialog.open){if(dock)dialog.show();else dialog.showModal();}
  return dialogGeneration;
}
function showAvatarEditor(profile) {
  const account=user.number,epoch=generation;
  const form=el('form'),label=el('label','选择图片（PNG 或 JPEG，4 MB 以内）');
  const input=el('input');input.type='file';input.accept='image/png,image/jpeg';
  const preview=el('img',null,'avatar-preview');preview.alt='圆角头像预览';preview.hidden=true;
  const submit=el('button','保存头像','primary');submit.type='submit';submit.disabled=true;
  label.append(input);
  form.append(label,preview,submit);
  const scope=openDialog('更换头像',[form]);
  const current=()=>scope===dialogGeneration&&epoch===generation&&user?.number===account;
  const feedback=$('#dialog-error');
  let selection;
  input.addEventListener('change',async()=>{
    const file=input.files[0];
    selection=undefined;submit.disabled=true;preview.hidden=true;feedback.textContent='';
    if(!file)return;
    try {
      const prepared=await prepareAvatar(file);
      if(!current()||input.files[0]!==file)return;
      selection={...prepared,clientId:clientNonce()};
      preview.src=prepared.preview;preview.hidden=false;submit.disabled=false;
    } catch(error) {
      if(current()&&input.files[0]===file)feedback.textContent=error.message;
    }
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!current()||!selection||submit.disabled)return;
    input.disabled=true;
    void perform(async()=>{
      try {
        const {user:saved}=await api('/me/avatar',selection.blob,{expectedAccount:account,
          image:{mime:'image/png',clientId:selection.clientId}});
        if(saved?.number!==account||!saved.avatarRevision)throw Error('avatar_unconfirmed');
        user=saved;
        if(profile.isConnected)profile.querySelector('.avatar').replaceWith(personAvatar(saved));
        if(chat){showChatHeader();renderHistory();}
        if(current())closeDialog();
      } finally {input.disabled=false;}
    },submit,scope);
  });
}

const stickerButton=button('☺',showStickerPicker);
stickerButton.setAttribute('aria-label','表情包');
stickerButton.setAttribute('aria-haspopup','dialog');
stickerButton.classList.add('sticker-trigger');
$('#composer-media').prepend(stickerButton);
async function showStickerPicker() {
  if(!canAttach(conversation))return;
  const id=chat,epoch=generation,visit=chatVisit,account=user.number;
  const panel=el('div',null,'sticker-picker');
  const status=el('p','正在读取表情…');status.setAttribute('role','status');
  const scope=openDialog('表情包',[status,panel],id);
  const current=()=>scope===dialogGeneration&&epoch===generation&&visit===chatVisit&&chat===id&&user?.number===account;
  await perform(async()=>{
    const {stickers}=await api('/stickers');
    if(!current())return;
    status.textContent=stickers.length?'':'暂时没有可用的表情。';
    let sendingSticker=false;
    for(const {id:sticker,label} of stickers){
      const clientId=clientNonce();
      const choice=button('',()=>{
        if(sendingSticker||!current()||!canAttach(conversation))return;
        sendingSticker=true;
        void perform(async()=>{
          try {
            const {message}=await api(thread(id)+'/stickers',{expectedAccount:account,clientId,sticker});
            if(!current())return;
            merge([message],'end');
            closeDialog();
            void sync();
          } finally {sendingSticker=false;}
        },choice,scope);
      });
      choice.setAttribute('aria-label','发送 '+label);
      const image=el('img');image.alt='';image.src='./api/v1/stickers/'+encodeURIComponent(sticker);
      choice.append(image,el('span',label));
      panel.append(choice);
    }
    panel.firstElementChild?.focus();
  },null,scope);
}
// Based on bothouse role-household/rh/static/rh-history.js at 8ec73a8f (Apache-2.0).
// Cursor search and latest-response wins are kept; the local service supplies a bounded context page.
function highlightHistoryHit(element,text,query){
  const fold=value=>value.replace(/[A-Z]/g,c=>c.toLowerCase()); // Match SQLite's case folding without changing offsets.
  const needle=fold(query),lower=fold(text);
  const first=lower.indexOf(needle), start=Math.max(0,first-40);
  const end=Math.min(text.length,start+200);
  if(start)element.append('…');
  let i=start,match;
  while((match=lower.indexOf(needle,i))>=0&&match+query.length<=end){
    element.append(text.slice(i,match).toWellFormed(),el('mark',text.slice(match,match+query.length).toWellFormed()));
    i=match+query.length;
  }
  element.append(text.slice(i,end).toWellFormed(),end<text.length?'…':'');
}
function displayOriginal(page,messageId){
  historyContext={anchor:messageId,messages:mergeHistoryRows(page.messages,[],false),older:page.older};
  resetOlderPage();
  renderHistory('end');
  focusOriginal(historyView.querySelector('[data-history-message="'+messageId+'"]'));
}
let quoteNavigation=0;
async function locateQuotedMessage(messageId){
  const visit=chatVisit,epoch=generation,serial=++quoteNavigation;
  const current=()=>visit===chatVisit&&epoch===generation&&serial===quoteNavigation;
  try{
    const params=new URLSearchParams({account:user.number,around:messageId});
    const page=await api(thread(chat)+'/history-search?'+params);
    if(!current())return;
    if(page.anchor!==messageId||page.historyFloor!==historyFloor||page.membershipRevision!==membershipRevision||
      removedMessages.has(messageId))throw Error('unknown_message');
    displayOriginal(page,messageId);
  }catch(error){
    if(current())$('#send-error').textContent=error.status===404||error.message==='unknown_message'?
      '原消息已移除或不可查看。':textError(error);
  }
}
const historySearchButton=$('#history-search');
// A cached page can load this script before it has the search control.
if(historySearchButton)historySearchButton.hidden=false;
historySearchButton?.addEventListener('click',()=>{
  if(!user||!chat||!conversation)return;
  const id=chat,account=user.number,visit=chatVisit,epoch=generation;
  const form=el('form',null,'history-search-form'), label=el('label','关键词');
  const input=el('input');input.type='search';input.id='history-keyword';input.maxLength=100;input.required=true;
  label.htmlFor=input.id;
  const submit=el('button','搜索','primary');submit.type='submit';
  form.append(label,input,submit);
  const status=el('p',null,'minor');status.setAttribute('role','status');
  const results=el('ul',null,'history-search-results');
  const more=button('更多结果',()=>void search(true),'outline');more.hidden=true;
  const panel=openDialog('搜索聊天记录',[form,status,results,more],id);
  const marker={removeResults(){
    const size=results.childElementCount;
    for(const entry of [...results.children]){
      if(removedMessages.has(Number(entry.dataset.historyHit)))entry.remove();
    }
    if(size!==results.childElementCount&&status.textContent.startsWith('已显示')){
      status.textContent=results.childElementCount?'已显示 '+results.childElementCount+' 条结果。':'这些消息已不可查看。';
    }
  }};
  historyFinder=marker;
  dialogCleanup=()=>{if(historyFinder===marker)historyFinder=undefined;};
  input.focus();
  let searchSeq=0, query='', next=null, locateFlight;
  const current=()=>dialog.open&&dialogGeneration===panel&&chat===id&&chatVisit===visit&&generation===epoch;
  const inScope=data=>data.historyFloor===historyFloor&&data.membershipRevision===membershipRevision;
  const route=params=>thread(id)+'/history-search?'+new URLSearchParams({account,...params});
  async function jumpTo(messageId){
    if(!current()||locateFlight)return;
    const seq=searchSeq, lock={};locateFlight=lock;
    status.textContent='正在定位消息…';
    try{
      const page=await api(route({around:messageId}));
      if(!current()||seq!==searchSeq)return;
      if(!inScope(page)||page.anchor!==messageId||removedMessages.has(messageId)){
        status.textContent='这条消息已移除或不可查看。';return;
      }
      closeDialog();
      displayOriginal(page,messageId);
    }catch(error){if(current()&&seq===searchSeq)status.textContent=textError(error);}
    finally{if(locateFlight===lock)locateFlight=undefined;}
  }
  async function search(append){
    if(!current()||append&&!next)return;
    const seq=++searchSeq;
    if(!append){query=input.value.trim();next=null;results.replaceChildren();}
    if(!query)return;
    const before=next;
    more.hidden=true;status.textContent='正在搜索…';
    try{
      const data=await api(route({q:query,...(append&&{before})}));
      if(!current()||seq!==searchSeq)return;
      if(!inScope(data)){status.textContent='会话权限已变化，请重新打开。';return;}
      let firstAdded;
      for(const hit of data.results){
        if(removedMessages.has(hit.id))continue;
        const snippet=el('span',null,'history-search-snippet');
        highlightHistoryHit(snippet,hit.text,query);
        const open=button('',()=>void jumpTo(hit.id),'history-search-hit');
        open.append(el('span',hit.sender+'　'+time(hit.createdAt),'minor'),snippet);
        const entry=el('li');
        entry.dataset.historyHit=hit.id;
        entry.append(open);results.append(entry);
        firstAdded??=entry;
      }
      next=data.next;more.hidden=!next;
      if(append)firstAdded?.scrollIntoView({block:'nearest'});
      status.textContent=results.childElementCount?'已显示 '+results.childElementCount+' 条结果。':'没找到相关消息。';
    }catch(error){
      if(!current()||seq!==searchSeq)return;
      status.textContent=textError(error);
      more.hidden=!before;
    }
  }
  form.addEventListener('submit',event=>{event.preventDefault();void search(false);});
  input.addEventListener('input',()=>{
    ++searchSeq;locateFlight=undefined;next=null;results.replaceChildren();more.hidden=true;status.textContent='';
  });
});
function clearDialogResources() {
  const cleanup=dialogCleanup;
  dialogCleanup=undefined;
  cleanup?.();
}

function closeVoiceDialog() {
  if(dialogCleanup)closeDialog();
}
window.addEventListener('arcade-social-deactivate',closeVoiceDialog);
window.addEventListener('pagehide',closeVoiceDialog);
document.addEventListener('visibilitychange',()=>{if(document.hidden)closeVoiceDialog();});

function voiceDialog(title, audio, nodes, id) {
  stopVoicePlayback();
  openDialog(title,nodes,id);
  audio.controlsList?.add('nodownload','noremoteplayback');
  const controller=new AbortController();
  let url;
  dialogCleanup=()=>{
    controller.abort();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if(url)URL.revokeObjectURL(url);
  };
  return {
    signal:controller.signal,
    preview(blob) {
      if(url)URL.revokeObjectURL(url);
      url=URL.createObjectURL(blob);
      audio.src=url;
      audio.hidden=false;
    },
  };
}

$('#ai-voice').addEventListener('click',()=>showAiVoice());
function showAiVoice({owned=false,selectedRole}={}){
  if(!user||!owned&&!chat)return;
  const id=owned?null:chat, account=user.number, route=owned?'/personal-ai/voice':thread(id)+'/ai-voice';
  const form=el('div',null,'voice-settings'), status=el('p','正在读取音色…','minor'), audio=el('audio',null,'voice-player');
  status.setAttribute('role','status');
  audio.controls=true;audio.hidden=true;
  const {signal,preview}=voiceDialog(owned?'我的群 AI 音色':'AI 音色',audio,[form,audio,status],id);
  const scope=dialogGeneration;
  const roleSelect=el('select'), voiceSelect=el('select');
  const provider=el('p','选用 Azure 神经语音后，微软 Azure 会收到要朗读的台词。台词可能包含对话内容。','minor');
  const scopeStatus=el('p',null,'minor');
  provider.hidden=true;
  roleSelect.setAttribute('aria-label','角色');
  voiceSelect.setAttribute('aria-label','音色');
  const roleLabel=el('label','角色'), voiceLabel=el('label','音色'), actions=el('div',null,'actions');
  roleLabel.append(roleSelect);
  voiceLabel.append(voiceSelect);
  const option=(name,value)=>{
    const element=el('option',name);
    element.value=value;
    return element;
  };
  let model;
  const role=()=>model?.roles.find(item=>item.number===roleSelect.value);
  const showProvider=()=>{
    provider.hidden=!model.voices.find(row=>row.id===voiceSelect.value)?.remote;
    provider.textContent=role()?.voiceOwner
      ? '好友服务使用运营方配置的 Azure 朗读台词。台词可能包含对话内容。'
      : '选用 Azure 神经语音后，微软 Azure 会收到要朗读的台词。台词可能包含对话内容。';
  };
  function showScope(){
    const who=role();
    const ownerVoice=!!who?.voiceOwner&&!owned;
    const available=model.voices.some(voice=>voice.id===who?.voice);
    voiceSelect.disabled=ownerVoice;
    save.hidden=ownerVoice;
    allow.hidden=owned||!available||who.allowed||who.defaultEnabled===false;
    allow.disabled=voiceSelect.value!==who?.voice;
    stop.hidden=owned||(!who?.scopeRevision&&!who?.allowed);
    defaultToggle.hidden=!ownerVoice||who.defaultEnabled===null;
    defaultToggle.disabled=who?.defaultEnabled===false&&!available;
    defaultToggle.textContent=who?.defaultEnabled===false?'恢复记住的 Azure 选择':'停用记住的 Azure 选择';
    scopeStatus.textContent=owned?'':ownerVoice
      ? (available?'音色由主人选择。':'这位 AI 暂无可用的 Azure 音色。')+
        (who?.allowed?(who.inherited?' 本群沿用你记住的 Azure 选择。':' 你已允许这位 AI 在本群用 Azure 朗读回复。'):
          ' 本群对你的点名暂用文字回复。')
      : who?.allowed?'本会话已允许使用当前音色。':'本会话当前使用文字回复。';
  }
  function restoreVoice(){
    audio.pause();audio.hidden=true;
    voiceSelect.value=role()?.voice||'';
    hear.disabled=!voiceSelect.value;
    showProvider();
    showScope();
  }
  const hear=button('试听',()=>void perform(async()=>{
    const who=role(), chosen=voiceSelect.value;
    if(!who||!chosen)return;
    const response=await fetch('./api/v1'+route+'/preview',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number:who.number,voice:chosen,expectedAccount:account}),
    });
    if(!response.ok||response.headers.get('Content-Type')!=='audio/wav')
      throw Error('音色暂时无法试听，请稍后再试。');
    const bytes=await response.blob();
    if(signal.aborted||roleSelect.value!==who.number||voiceSelect.value!==chosen)return;
    preview(bytes);
    void audio.play().catch(()=>{});
  },hear,scope));
  const save=button('保存音色',()=>void perform(async()=>{
    const who=role(), chosen=voiceSelect.value||null;
    if(!who)return;
    model=await api(route,{number:who.number,voice:chosen,revision:who.revision,expectedAccount:account});
    if(!signal.aborted){
      status.textContent=chosen?'已为'+who.displayName+'保存音色。'+(owned?' 群内仍由成员分别允许语音。':''):
        who.displayName+'当前使用文字回复。';
      showScope();
    }
  },save,scope),'primary');
  function setScope(enabled,control){
    return perform(async()=>{
      const who=role();
      model=await api(route,{action:'scope',number:who.number,allowed:enabled,revision:who.revision,
        scopeRevision:who.scopeRevision,defaultRevision:who.defaultRevision,pauseRevision:who.pauseRevision,expectedAccount:account});
      if(!signal.aborted)showScope();
    },control,scope);
  }
  const allow=button('允许本会话语音',()=>void setScope(true,allow));
  const stop=button('停止本会话语音',()=>void setScope(false,stop));
  const defaultToggle=button('停用记住的 Azure 选择',()=>void perform(async()=>{
    const who=role();
    model=await api(route,{action:'personal-default',number:who.number,allowed:who.defaultEnabled===false,
      revision:who.revision,defaultRevision:who.defaultRevision,expectedAccount:account});
    if(!signal.aborted)showScope();
  },defaultToggle,scope));
  actions.append(hear,save,allow,stop,defaultToggle);
  roleSelect.addEventListener('change',restoreVoice);
  voiceSelect.addEventListener('change',()=>{
    audio.pause();audio.hidden=true;
    hear.disabled=!voiceSelect.value;
    showProvider();
    showScope();
  });
  void perform(async()=>{
    model=await api(route);
    if(signal.aborted)return;
    if(!model.roles.length){
      status.textContent=owned?'当前没有可为自己的群 AI 选择的 Azure 音色。':
        model.voices.length?'请先在本会话同意这位角色的 AI 聊天。':'当前好友服务暂未启用 AI 语音。';
      return;
    }
    roleSelect.replaceChildren(...model.roles.map(row=>option(!owned&&row.voiceOwner
      ? row.displayName+' · '+row.voiceOwner+' 的 AI':row.displayName,row.number)));
    if(model.roles.some(row=>row.number===selectedRole))roleSelect.value=selectedRole;
    voiceSelect.replaceChildren(option('文字回复',''),...model.voices.map(row=>option(row.label,row.id)));
    form.replaceChildren(roleLabel,voiceLabel,provider,scopeStatus,actions);
    restoreVoice();
    status.textContent=owned?'为自己的群 AI 选择音色。群成员需在本群单独允许，好友服务才会把朗读台词送到 Azure。':
      '内置角色可在这里选声。朋友带来的 AI 使用主人所选的音色，语音由你在当前会话单独允许。';
  },null,scope);
}

function voiceTime(seconds) {
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function paintVoice(control,durationMs,action='播放语音',audio) {
  const total=durationMs<1000?'不到 1 秒':voiceTime(Math.floor(durationMs/1000));
  const elapsed=audio?voiceTime(Math.floor(audio.currentTime))+' / ':'';
  control.textContent=action+' · '+elapsed+total;
  control.setAttribute('aria-label',action+' · '+total);
}
function stopVoicePlayback() {
  const active=inlineVoice;
  if(!active)return;
  inlineVoice=undefined;
  active.controller.abort();
  active.player.stop();
  active.audio.removeAttribute('src');
  active.audio.load();
  active.audio.remove();
  if(active.url)URL.revokeObjectURL(active.url);
  paintVoice(active.control,active.durationMs);
}
window.addEventListener('pagehide',stopVoicePlayback);
window.addEventListener('arcade-social-deactivate',stopVoicePlayback);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoicePlayback();});

async function toggleVoice(message,control) {
  const id=chat, account=user.number, durationMs=message.attachment.durationMs;
  if(id!==message.conversationId||!visibleHistory().some(row=>row.id===message.id&&!row.removed))return;
  const current=inlineVoice;
  if(current?.id===message.id){
    if(current.loading)stopVoicePlayback();
    else if(current.player.running){current.player.stop();paintVoice(control,durationMs,'继续播放语音',current.audio);}
    else current.player.start();
    return;
  }
  stopVoicePlayback();
  const audio=el('audio');
  audio.id='inline-voice-audio';
  audio.hidden=true;
  historyView.after(audio);
  const controller=new AbortController();
  const active={id:message.id,audio,controller,control,durationMs,loading:true};
  inlineVoice=active;
  const fail=()=>{
    if(inlineVoice!==active)return;
    stopVoicePlayback();
    paintVoice(control,durationMs,'无法播放，重试语音');
  };
  active.player=new VoiceQueuePlayer(audio,{
    baseURL:location.href,
    onState(state){
      if(inlineVoice!==active)return;
      if(state==='failed')fail();
      else if(state==='completed')stopVoicePlayback();
      else if(state==='paused')paintVoice(control,durationMs,'继续播放语音',audio);
      else if(state==='loading'||state==='buffering')paintVoice(control,durationMs,'正在缓冲语音',audio);
    },
    onProgress(){
      if(inlineVoice===active&&active.player.running&&!audio.paused&&!audio.ended)
        paintVoice(control,durationMs,'暂停语音',audio);
    },
  });
  paintVoice(control,durationMs,'取消加载语音');
  try {
    const response=await fetch('./api/v1'+thread(id)+'/messages/'+message.id+'/voice',{
      headers:{'X-Social-Account':account},credentials:'same-origin',cache:'no-store',
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(durationMs>30000?30000:12000)]),
    });
    if(!response.ok||response.headers.get('Content-Type')!=='audio/wav')throw Error('voice_unavailable');
    const blob=await response.blob();
    if(inlineVoice!==active)return;
    active.url=URL.createObjectURL(blob);
    active.player.select({id:message.id,status:'ready',audio_url:active.url});
    active.loading=false;
    active.player.start();
  } catch {fail();}
}

let recorderLoadAttempt=0;
const recorderUnavailable='录音组件暂时加载失败。可以继续发文字，或取消后再点「录音」重试。';
$('#record-voice').addEventListener('click',async()=>{
  if(!canAttach(conversation))return;
  stopVoicePlayback();
  const id=chat, account=user.number;
  const audio=el('audio',null,'voice-player'), status=el('p','正在加载录音组件…','minor');
  audio.controls=true;audio.hidden=true;status.setAttribute('role','status');
  let capture, recording;
  const stop=button('停止录音',()=>{
    stop.disabled=true;
    capture.stop();
  });
  stop.disabled=true;
  const cancel=button('取消录音',closeDialog);
  const send=button('发送语音',async()=>{
    if(!recording||signal.aborted||send.disabled)return;
    send.disabled=true;cancel.disabled=true;
    $('#dialog-error').textContent='';
    status.textContent='正在发送…';
    try {
      const {message}=await api(thread(id)+'/voices',recording,{expectedAccount:account,voice});
      if(signal.aborted)return;
      closeDialog();
      merge([message],'end');
      void sync();
    } catch(error) {
      if(signal.aborted)return;
      send.disabled=false;cancel.disabled=false;
      status.textContent='';
      $('#dialog-error').textContent=[401,403,404,409].includes(error.status)?
        '账号或会话权限已改变，请重新打开会话。':error.status===422?
        '无法发送这段录音，请取消后重新录制。':'暂时无法确认发送结果，请重试这段录音。';
    }
  },'primary');
  send.hidden=true;
  const actions=el('div',null,'actions');actions.append(stop,cancel,send);
  const {signal,preview}=voiceDialog('录制语音',audio,[status,audio,actions],id);
  const attempt=recorderLoadAttempt;
  let recorder;
  try {
    recorder=await import(attempt ? './voice-recorder.js?retry='+attempt : './voice-recorder.js');
  } catch {
    // A browser can keep a failed module load for the lifetime of the page.
    if(recorderLoadAttempt===attempt)recorderLoadAttempt++;
    if(!signal.aborted){
      stop.hidden=true;
      status.textContent=recorderUnavailable;
    }
    return;
  }
  if(signal.aborted)return;
  status.textContent='正在请求使用麦克风…';
  const voice={mime:'audio/wav',clientId:clientNonce()};
  try {
    capture=await recorder.beginVoiceRecording(signal);
    signal.throwIfAborted();
    status.textContent='录音中，最多 30 秒。';
    stop.disabled=false;
    const blob=await capture.result;
    if(signal.aborted)return;
    recording=blob;
    preview(recording);
    stop.hidden=true;send.hidden=false;
    status.textContent='可以先试听，再发送。';
  } catch(error) {
    if(signal.aborted)return;
    stop.hidden=true;
    status.textContent=error.message==='voice_module'?recorderUnavailable:error.name==='NotAllowedError'?
      '麦克风未获允许。请在系统或浏览器设置中允许使用，再重新录音。':
      error.name==='NotFoundError'?'没有找到麦克风。请连接麦克风后重新录音。':
      error.message==='voice_unsupported'?'这个页面无法录音。请从 App 或 HTTPS 地址打开会话。':
      error.message==='voice_duration'?'录音太短。请取消后重新录一句。':'无法录音。请检查麦克风后重新录音。';
  }
});
function showOriginalImage(message) {
  if(chat!==message.conversationId||!visibleHistory().some(row=>row.id===message.id&&!row.removed))return;
  const image=el('img',null,'original-image');
  image.alt='聊天原图';
  const status=el('p',null,'feedback');status.setAttribute('role','status');
  const save=el('a','保存图片','save-chat-image');
  save.href=imageUrl(message)+'/download';
  save.download='';
  save.hidden=true;
  const note=el('p','原图可能保留拍摄时间或位置。选择「保存图片」后，用另存为选择文件夹和文件名。','minor');
  const ask=button('问 AI',()=>void askAboutPhoto(message),'outline');
  ask.hidden=message.sender.kind!=='human'||!conversation?.members.some(member=>member.kind==='ai');
  const account=user.number,group=chat,revision=membershipRevision,epoch=generation;
  const direct=conversation?.type==='direct',aiConsentRevision=direct?conversation.cloudChat?.revision:undefined;
  const route=thread(group)+'/messages/'+message.id+'/drawing-resend';
  let available=false,loaded=false,completed=false,clientId;
  const resend=button('重发这张原图',()=>void perform(async()=>{
    if(completed||!current())return;
    const key='arcade.drawing-resend.'+JSON.stringify(direct?[account,group,revision,message.id,aiConsentRevision]:[account,group,revision,message.id]);
    if(!clientId){
      try{clientId=sessionStorage.getItem(key);}catch{}
      clientId||=clientNonce();
      try{sessionStorage.setItem(key,clientId);}catch{}
    }
    try{
      const reply=await api(route,{clientId,expectedAccount:account,membershipRevision:revision,aiConsentRevision});
      try{sessionStorage.removeItem(key);}catch{}
      completed=true;
      if(current()){
        resend.hidden=true;
        status.textContent=reply.removed?'这次重发的图片已移除。':direct?'已重发到这段私聊。':'已重发到本群。';
      }
      if(generation===epoch&&chat===group)void sync();
    }catch(error){
      if(current()&&error.message==='drawing_resend_unavailable'){
        resend.hidden=true;
        status.textContent='这张原图已不可重发。';
      }else throw error;
    }
  },resend,scope),'outline');
  resend.hidden=true;
  image.addEventListener('load',()=>{loaded=true;save.hidden=false;resend.hidden=!available;},{once:true});
  image.addEventListener('error',()=>{loaded=false;image.hidden=save.hidden=ask.hidden=resend.hidden=true;status.textContent='原图目前不可查看。';});
  const scope=openDialog('原图',[image,save,ask,resend,note,status],chat);
  const current=()=>scope===dialogGeneration&&generation===epoch&&chat===group&&membershipRevision===revision&&
    (!direct||conversation?.cloudChat?.revision===aiConsentRevision);
  if(message.attachment.drawing&&revision&&(!direct||aiConsentRevision!==undefined)){
    void api(route).then(result=>{
      if(current()&&result.available){
        available=true;
        resend.hidden=!loaded;
      }
    }).catch(()=>{});
  }
  dialogMessage={chatId:chat,messageId:message.id};
  image.src=imageUrl(message);
  if(message.attachment.drawing){
    image.alt='AI 绘制的原图';
    note.textContent='由 Cloudflare Workers AI 生成。';
  }
  const sticker=message.attachment.sticker;
  if(sticker){
    image.alt=sticker.label;
    const details=$('#dialog-body');
    const source=sticker.source;
    if(source){
      note.textContent='另存或转发时，请保留下面的署名、许可与出处。';
      details.append(el('p',source.title+' · '+source.author+' · '+source.license+'（原图未修改）','minor'),
        el('p','出处 '+source.url,'minor image-source'),el('p','许可 '+source.licenseUrl,'minor image-source'));
    }else details.append(el('p',sticker.label+'。Agent Arcade 原创素材。','minor'));
  }
}
function fileSize(bytes){
  return bytes.toLocaleString()+' 字节';
}
$('#attach-file')?.addEventListener('click',()=>fileDialog());
function fileDialog(droppedFile){
  if(!canAttach(conversation))return;
  const id=chat, account=user.number, visit=chatVisit, epoch=generation, revision=membershipRevision;
  const label=el('label','选择文件（最多 16 MiB）'),input=el('input'),info=el('p',null,'minor');
  input.type='file';label.append(input);
  let selected,clientId;
  const submit=button('发送文件',()=>void perform(async()=>{
    if(!current()||!selected)return;
    if(!revision||membershipRevision!==revision)throw Error('file_session');
    input.disabled=true;
    try{
      const sent=await api(thread(id)+'/files',selected,{expectedAccount:account,
        fileUpload:{name:selected.name,clientId,revision,mime:'application/octet-stream'},timeoutMs:60000});
      if(current()){merge([sent.message],'end');closeDialog();void sync();}
    }finally{input.disabled=false;}
  },submit,scope),'primary');
  submit.disabled=true;
  const fields=droppedFile?[el('p','发送到「'+conversation.title+'」','minor'),info,submit]:[label,info,submit];
  const scope=openDialog('发送文件',fields,id);
  const current=()=>scope===dialogGeneration&&visit===chatVisit&&epoch===generation&&routeId()===id;
  const selectFile=file=>{
    selected=file;clientId=clientNonce();
    submit.disabled=!selected || selected.size>16*1024*1024;
    info.textContent=selected?selected.name+' · '+fileSize(selected.size)+(submit.disabled?'，超过 16 MiB':''):'';
  };
  input.addEventListener('change',()=>selectFile(input.files[0]));
  if(droppedFile)selectFile(droppedFile);
}
$('#attach-image').addEventListener('click',()=>photoDialog(false));
$('#chat-screenshot')?.addEventListener('click',()=>photoDialog(true));
function photoDialog(screenshot,droppedFile){
  if(!canSendPhoto(conversation))return;
  const id=chat, visit=chatVisit, epoch=generation, account=user.number;
  const revision=membershipRevision;
  const boundToMembership=screenshot||Boolean(droppedFile);
  const form=el('form'), label=el('label','选择一张图片'), input=el('input'), preview=el('img',null,'attachment-preview');
  input.type='file';input.accept='image/png,image/jpeg';input.required=!screenshot&&!droppedFile;
  label.append(input);preview.alt='发送预览';preview.hidden=true;
  const submit=el('button','发送图片','primary');submit.type='submit';submit.disabled=true;
  const direct=!screenshot && conversation.type==='direct'&&conversation.cloudChat?.enabled;
  const role=direct&&conversation.members.find(member=>member.kind==='ai');
  const provider=conversation.aiProvider;
  const previousDraft=messageBox.value;
  const questionLabel=el('label','同时问 AI（选填）'), question=el('textarea');
  question.rows=2;question.maxLength=500;
  if(direct&&!droppedFile&&previousDraft.trim().length<=500)question.value=previousDraft;
  questionLabel.append(question);
  const disclose=el('p',null,'minor');
  const notice=el('p',(direct?
    '留空问题即可只发图片。也可以之后打开图片并选「问 AI」。':
    '会话成员可以查看和另存。')+(screenshot?'':' 原图可能保留拍摄时间或位置。'),'minor');
  if(droppedFile)form.append(el('p','发送到「'+conversation.title+'」','minor'),el('p',droppedFile.name,'minor'));
  else form.append(label);
  form.append(notice,preview);
  if(direct)form.append(questionLabel,disclose);
  form.append(submit);
  const updateSendLabel=()=>{
    const asks=direct&&question.value.trim();
    submit.textContent=asks?'发送图片和问题':screenshot?'发送截图':'发送图片';
    disclose.textContent=asks?'本次会把所选照片的画面和问题发给'+role.displayName+'使用的 '+aiService(provider)+'。拍摄信息会移除，JPEG 仅保留显示方向。':'';
  };
  question.addEventListener('input',updateSendLabel);
  updateSendLabel();
  if(screenshot){
    label.firstChild.textContent='或选择已保存的截图';
    form.prepend(el('p','选区后回到这里按 Ctrl+V 预览。也可以按 Win+Shift+S 开始新的选区。'));
  }
  const scope=openDialog(screenshot?'发送截图':'发送图片',[form],id);
  const current=()=>scope===dialogGeneration&&visit===chatVisit&&epoch===generation&&routeId()===id;
  let selected,latestFile;
  input.addEventListener('change',()=>void selectPhoto(input.files[0]));
  if(droppedFile)void selectPhoto(droppedFile);
  if(screenshot){
    form.tabIndex=-1;
    form.addEventListener('paste',onPaste);
    form.focus();
  }
  function onPaste(event){
    if(!current()||input.disabled)return;
    const file=[...event.clipboardData?.files||[]].find(item=>item.type.startsWith('image/'));
    if(file){event.preventDefault();void selectPhoto(file);}
  }
  async function selectPhoto(file){
    latestFile=file;
    selected=undefined;submit.disabled=true;preview.hidden=true;preview.removeAttribute('src');
    $('#dialog-error').textContent='';
    if(!file)return;
    try {
      if(!file.size||file.size>4*1024*1024)throw Error('图片须在 4 MB 以内。');
      if(!['image/png','image/jpeg'].includes(file.type))throw Error('请选择静态 PNG 或 JPEG。');
      const url=await readImageData(file);
      if(!current()||latestFile!==file)return;
      preview.src=url;
      try {await preview.decode();}catch {throw Error('无法打开这张图片。');}
      if(!current()||latestFile!==file)return;
      selected={file,mime:file.type,clientId:clientNonce()};
      preview.hidden=false;submit.disabled=false;
    } catch(error) {
      if(current()&&latestFile===file)$('#dialog-error').textContent=error.message;
    }
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!selected||submit.disabled||!current())return;
    const {file,clientId,mime}=selected;
    const chosenQuestion=direct?question.value.trim():'';
    if(chosenQuestion&&previousDraft.trim()===chosenQuestion&&drafts.get(id)?.text===previousDraft)
      updateChatDraft(id,{submittedPhotoText:chosenQuestion});
    input.disabled=question.disabled=true;
    void perform(async()=>{
      try {
        if(boundToMembership&&(!revision||membershipRevision!==revision))throw Error('file_session');
        const {message}=await api(thread(id)+'/images',file,{expectedAccount:account,image:{clientId,mime,...(boundToMembership&&{revision})}});
        if(!current())return;
        merge([message],'end');
        if(chosenQuestion){
          const route=thread(id)+'/messages/'+message.id+'/vision';
          const available=await api(route);
          if(!current())return;
          const target=available.roles.find(row=>row.number===role.number&&row.provider===provider);
          if(!target?.canAsk)throw Error('图片已发送。这个角色目前无法看图，可稍后在原图上选择「问 AI」。');
          if(selected.attempt?.text!==chosenQuestion||selected.attempt?.revision!==target.revision)
            selected.attempt={clientId:clientNonce(),text:chosenQuestion,revision:target.revision,
              number:target.number,provider:target.provider,expectedAccount:account};
          const response=await api(route,selected.attempt);
          if(!current())return;
          merge([response.message,...(response.reply?[response.reply]:[])],'end');
          if(previousDraft.trim()===chosenQuestion&&messageBox.value===previousDraft){
            messageBox.value='';
            updateChatDraft(id,{floor:historyFloor,text:''});
          }
          if(response.visionError){$('#dialog-error').textContent=response.visionError;return;}
        }
        closeDialog();
        void sync();
      } catch(error) {
        if(current()&&error.message==='unknown_chat')forgetConversation(id);
        throw error;
      } finally {input.disabled=question.disabled=false;}
    },submit,scope);
  });
}
function canDropAttachment(event){
  return user&&chat&&routeId()===chat&&!composer.hidden&&!dialog.open&&composer.parentElement.contains(event.target)&&
    (canAttach(conversation)||canSendPhoto(conversation));
}

document.addEventListener('dragover',event=>{
  if(!event.dataTransfer?.types.includes('Files'))return;
  event.preventDefault();
  event.dataTransfer.dropEffect=canDropAttachment(event)?'copy':'none';
});
document.addEventListener('drop',event=>{
  if(!event.dataTransfer?.types.includes('Files'))return;
  event.preventDefault();
  if(!canDropAttachment(event))return;
  const files=event.dataTransfer.files, feedback=$('#send-error');
  if(!files.length)return;
  if(files.length>1){
    feedback.textContent='一次只能拖入一个附件，请分开拖入。';
    return;
  }
  const file=files[0], photo=['image/png','image/jpeg'].includes(file.type);
  feedback.textContent='';
  if(photo&&canSendPhoto(conversation))photoDialog(false,file);
  else if(canAttach(conversation))fileDialog(file);
  else feedback.textContent='当前会话只支持 PNG 或 JPEG 图片。';
});

async function askAboutPhoto(message){
  const id=chat,account=user.number,route=thread(id)+'/messages/'+message.id;
  const preview=el('img',null,'attachment-preview');
  preview.alt='本次所选图片';
  preview.src=imageUrl(message);
  const form=el('form'), label=el('label','请哪位角色看图'), select=el('select');
  label.append(select);
  const promptLabel=el('label','想问什么？'), question=el('textarea');
  question.required=true;question.maxLength=500;question.rows=2;
  promptLabel.append(question);
  const hint=el('p',null,'minor');
  const submit=el('button','发送图片和问题给 AI','primary');
  submit.type='submit';
  const share=button('允许群友问这位 AI',()=>void changePermission(),'outline');
  form.append(label,hint,promptLabel,submit,share);
  const scope=openDialog('问 AI 看这张图片',[preview,form],id);
  dialogMessage={chatId:id,messageId:message.id};
  const current=()=>dialogGeneration===scope&&chat===id&&user?.number===account;
  let view, attempt, locked=true;
  const selected=()=>view?.roles.find(role=>role.number===select.value);
  function render(){
    const role=selected();
    const provider=role&&aiService(role.provider);
    submit.disabled=locked||!role?.canAsk;
    share.hidden=!view?.owner||!view.group||!role?.configured;
    share.disabled=locked;
    share.textContent=role?.authorAllowed?'撤销群友问这位 AI 的授权':'允许群友问这位 AI';
    const availability=!role?'当前会话没有可用的 AI 角色。':
      !role.configured?'这位角色的当前服务无法看图。':
      !role.consented?'请先同意这位角色在本会话使用云聊天。':
      !role.canAsk?'图片作者还没有允许这位角色看图。':'';
    hint.textContent=(provider?'看图时会把这张照片的画面和本次问题发给 '+provider+'。拍摄信息会移除，JPEG 仅保留显示方向。':'')+
      (availability?' '+availability:'')+(view?.owner&&view.group&&role?.configured?
        ' 允许后，本群有查看权限且已授权该角色的成员也可以用这张图提问。':'');
  }
  function useView(updated){
    const previous=select.value;
    view=updated;
    select.replaceChildren(...view.roles.map(role=>{
      const option=el('option',role.displayName+'（'+aiService(role.provider)+'）');
      option.value=role.number;
      return option;
    }));
    if(view.roles.some(role=>role.number===previous))select.value=previous;
    else if(view.roles.some(role=>role.canAsk))select.value=view.roles.find(role=>role.canAsk).number;
    locked=false;
    render();
  }
  async function changePermission(){
    const role=selected();
    if(!role||!current()||locked)return;
    locked=true;render();
    $('#dialog-error').textContent='';
    try{
      const updated=await api(route+'/vision-permission',{
        expectedAccount:account,number:role.number,provider:role.provider,enabled:!role.authorAllowed,
      });
      if(current())useView(updated);
    }catch(error){
      if(current())$('#dialog-error').textContent=textError(error);
    }finally{
      if(current()){locked=false;render();}
    }
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const role=selected(), text=question.value.trim();
    if(locked||!current()||!role?.canAsk||!text)return;
    if(attempt?.text!==text||attempt.number!==role.number||attempt.revision!==role.revision)
      attempt={clientId:clientNonce(),expectedAccount:account,number:role.number,provider:role.provider,revision:role.revision,text};
    locked=true;render();
    select.disabled=question.disabled=true;
    $('#dialog-error').textContent='';
    try{
      const response=await api(route+'/vision',attempt);
      if(!current())return;
      merge([response.message,...(response.reply?[response.reply]:[])],'end');
      if(response.visionError){$('#dialog-error').textContent=response.visionError;return;}
      closeDialog();
      void sync();
    }catch(error){
      if(current())$('#dialog-error').textContent=textError(error);
    }finally{
      if(current()){select.disabled=question.disabled=false;locked=false;render();}
    }
  });
  select.addEventListener('change',render);
  render();
  try{
    const updated=await api(route+'/vision');
    if(current())useView(updated);
  }catch(error){
    if(current())$('#dialog-error').textContent=textError(error);
  }
}

function showMessageReport(message) {
  const visit=chatVisit, id=chat;
  const available=()=>chatVisit===visit&&
    visibleHistory().some(row=>row.id===message.id&&!row.removed);
  showContentReport({kind:'消息',text:message.text,available,path:thread(id)+'/messages/'+message.id+'/report',
    context:{chatId:id,messageId:message.id},attachmentType:message.attachment?.type});
}
function showContentReport({kind,text,author,path,available,context,attachmentType}) {
  if(!user||!available())return;
  const account=user.number, epoch=generation;
  const form=el('form'), label=el('label','举报原因'), input=el('textarea');
  input.id='report-reason';input.rows=3;input.maxLength=500;input.required=true;
  label.htmlFor=input.id;
  const submit=el('button','提交举报','primary');submit.type='submit';
  const excerpt=el('blockquote',text,'report-excerpt');
  const receipt=el('p',null,'minor report-receipt');receipt.setAttribute('role','status');
  form.append(label,input);
  let includeMedia;
  if(['image','voice'].includes(attachmentType)){
    const medium=attachmentType==='image'?'图片':'语音';
    const option=el('label',null,'report-media-option');
    includeMedia=el('input');includeMedia.type='checkbox';
    option.append(includeMedia,el('span','一并提供这条'+medium+'的原件'));
    const description=el('p','勾选后，运营方可在本机审核工具中打开仅这条消息的'+medium+'原件。'+
      (attachmentType==='image'?'图片可能带有拍摄地点等资料。':'录音可能包含背景声音。')+
      ' 不勾选时只提供附件类型和举报原因。','minor');
    description.id='report-media-description';
    includeMedia.setAttribute('aria-describedby',description.id);
    form.append(option,description);
  }
  form.append(submit);
  const guidance=author?'运营方会审核这条动态和你填写的原因。举报副本将留作审核。':
    '运营方会审核这条消息和你填写的原因。普通问题或建议请用「意见反馈」。';
  const items=[policyLink('内容准则','./conduct.html#reporting')];
  if(author)items.push(el('p',author.displayName+'（'+author.number+'）','minor'));
  const followUp=el('p','处理结果可在「我 → 我的举报」查看。','minor');
  followUp.hidden=true;
  items.push(excerpt,el('p',guidance,'minor'),form,receipt,followUp);
  const scope=openDialog('举报'+kind,items,context?.chatId);
  dialogMessage=context;
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const reason=input.value.trim();
    if(!reason||submit.disabled)return;
    void perform(async()=>{
      if(generation!==epoch||scope!==dialogGeneration||!available())
        throw Object.assign(Error('report_unavailable'),{status:404});
      const requested=includeMedia?.checked===true;
      const result=await api(path,{reason,...(requested&&{includeMedia:true})},{expectedAccount:account});
      if(generation!==epoch||scope!==dialogGeneration||!available())return;
      const state={open:'已提交，等待审核。',removed:'已审核，'+kind+'已移除。',
        dismissed:author?'已审核，举报未采纳。':'已审核，消息保留。'}[result.report.status];
      const mediaNotice=result.report.sharedMedia?' 这份举报附有该原件。':requested?' 这份举报没有附上原件。':'';
      receipt.textContent=state+mediaNotice+' 举报回执 '+result.report.id;
      followUp.hidden=false;
      form.hidden=true;
    },submit,scope);
  });
}
function reportHistoryItem(report) {
  const kind={message:'聊天消息',friend_post:'好友动态'}[report.kind]??'举报';
  const state={open:'待审核',removed:'已移除',dismissed:'举报未采纳'}[report.status]??'状态待确认';
  const row=el('article',null,'request');
  row.append(el('strong',kind+' · '+state),
    el('small','提交于 '+time(report.created,reportDate),'minor'));
  if(report.reviewed)row.append(el('small','处理于 '+time(report.reviewed,reportDate),'minor'));
  if(report.reason){
    const preview=Array.from(report.reason.trim().replace(/\s+/gu,' '));
    const length=42;
    if(preview.length>length||report.reason.includes('\n')){
      const detail=el('details',null,'report-receipt report-reason');
      const summary=el('summary','举报原因');
      summary.append(el('span','：'+preview.slice(0,length).join('')+(preview.length>length?'…':''),'report-reason-preview'));
      detail.append(summary,el('p',report.reason,'feedback-body'));
      row.append(detail);
    }else row.append(el('p','原因：'+preview.join(''),'report-receipt'));
  }
  row.append(el('small','举报回执 '+report.id,'minor report-receipt'));
  return row;
}

function showMyReports() {
  const account=user.number, epoch=generation;
  const status=el('p',null,'minor report-receipt');
  status.setAttribute('role','status');
  const list=el('div');
  const retry=button('重试',()=>void load());
  const scope=openDialog('我的举报',[el('p','显示最近 50 条举报，按提交时间从新到旧。','minor'),status,retry,list]);
  const current=()=>generation===epoch&&scope===dialogGeneration;
  async function load(){
    retry.hidden=true;
    status.textContent='正在读取举报…';
    try{
      const {account:owner,reports}=await api('/reports/mine');
      if(!current())return;
      if(owner!==account){
        status.textContent='账号已切换，请重新登录后再查看举报。';
        return;
      }
      list.replaceChildren(...reports.map(reportHistoryItem));
      status.textContent=reports.length?'':'你还没有提交过举报。';
    }catch(error){
      if(!current())return;
      status.textContent=textError(error);
      retry.hidden=false;
    }
  }
  void load();
}

function showFeedback({imageReport=false}={}) {
  const account=user.number, epoch=generation;
  const desktopVersion=document.documentElement.dataset.arcadeFeedbackDesktopVersion||null;
  const clientIdentity={desktopVersion,clientBuild:servedClientBuild};
  const form=el('form'), label=el('label','问题或建议'), input=el('textarea');
  input.id='feedback-text';input.name='feedback';input.rows=3;input.maxLength=1000;input.required=true;
  input.value=currentFeedbackDraft(account)?.text||'';
  label.htmlFor=input.id;
  const submit=el('button','提交反馈','primary');submit.type='submit';
  const versionHint=el('p',null,'minor');
  const status=el('p',null,'minor');status.setAttribute('role','status');
  const review=el('section',null,'feedback-history');
  const reviewResults=el('div');
  const reviewStatus=el('p',null,'minor');reviewStatus.setAttribute('role','status');
  const reviewButton=button('回顾我的聊天问题',()=>void perform(loadReview,reviewButton,scope));
  const addReview=button('把汇总加入反馈',addReviewToDraft);addReview.hidden=true;
  review.append(reviewButton,reviewStatus,reviewResults,addReview);
  const history=el('section',null,'feedback-history'), list=el('div');
  const replies=el('section'), older=button('查看更早的反馈',()=>void perform(()=>load(next),older,scope));
  const historyStatus=el('p',null,'minor');historyStatus.setAttribute('role','status');
  older.hidden=true;
  history.append(el('h3','我的反馈'),replies,list,older,historyStatus);
  const feedbackVersion=details=>details.desktopVersion
    ? 'Windows App '+details.desktopVersion+'（客户端报告）'
    : '未记录桌面版本';
  const feedbackBuild=details=>details.clientBuild
    ? '网页构建 '+details.clientBuild.slice(0,12)
    : '未记录网页构建';
  const hasRecordedVersion=draft=>Object.hasOwn(draft,'desktopVersion')&&typeof draft.clientBuild==='string';
  function updateVersionHint() {
    const previous=currentFeedbackDraft(account);
    const retry=previous?.text===input.value.trim();
    const details=retry?(hasRecordedVersion(previous)?previous:{}):clientIdentity;
    const source=retry||details.desktopVersion?feedbackVersion(details):'网页客户端（未报告桌面版本）';
    versionHint.textContent=(retry?'待重试版本：':'本次提交版本：')+source+' · '+feedbackBuild(details);
  }
  updateVersionHint();
  input.addEventListener('input',updateVersionHint);
  form.append(label,input,versionHint,submit);
  const imageNotice=el('p','请描述这张图的问题。只会提交你填写的文字。','minor');
  const scope=openDialog('意见反馈',[...(imageReport?[imageNotice]:[]),form,status,...(imageReport?[]:[review]),history]);
  if(imageReport)input.focus();
  const current=()=>generation===epoch&&scope===dialogGeneration;
  let reviewDraft='';
  async function loadReview() {
    reviewDraft='';
    addReview.hidden=true;
    reviewResults.replaceChildren();
    reviewStatus.textContent='正在回顾…';
    try {
      const result=await api('/feedback/chat-review?account='+encodeURIComponent(account));
      if(!current())return;
      if(result.account!==account)throw Object.assign(Error('feedback_session'),{status:409});
      const count=entry=>entry.messages+' 条、'+entry.conversations+' 个会话';
      const lines=result.categories.map(row=>row.topic+'：'+count(row)+'（群聊 '+count(row.group)+'；私聊 '+count(row.direct)+'）');
      reviewStatus.textContent='已回顾当前账号仍可查看的全部 '+result.scannedMessages+' 条本人文字消息。已移除、不可见和带附件的消息不计。'+
        (lines.length?'以下是待核对的线索，表述含糊时可能误判或漏计。':'暂未找到明确指向 App 或搭档的问题线索。');
      if(!lines.length)return;
      const list=el('ul');
      list.append(...lines.map(line=>el('li',line)));
      reviewResults.replaceChildren(list,el('p','加入反馈后，可在输入框删掉不相关的条目。提交只发送输入框里的内容。','minor'));
      const scopedLines=result.categories.flatMap(row=>[
        ['群聊',row.group],['私聊',row.direct]
      ].filter(([,entry])=>entry.messages).map(([scope,entry])=>row.topic+'（'+scope+'）：'+count(entry)));
      reviewDraft='我的聊天问题回顾（自动归类）\n'+scopedLines.join('\n');
      addReview.hidden=false;
    }catch(error){
      if(current())reviewStatus.textContent='暂未完成回顾，可以重试。';
      throw error;
    }
  }
  function addReviewToDraft() {
    if(!current()||!reviewDraft||input.readOnly)return;
    const previous=input.value.trim();
    if(previous.split('\n\n').includes(reviewDraft)){input.focus();return;}
    const next=[previous,reviewDraft].filter(Boolean).join('\n\n');
    if(next.length>input.maxLength){
      reviewStatus.textContent='现有草稿加上汇总超过字数限制。可删减草稿后再加入。';
      return;
    }
    input.value=next;
    updateVersionHint();
    input.focus();
  }
  const rows=new Map();
  let recentReplies=[],next=null;
  const feedbackItem=row=>{
    const item=el('article',null,'request');
    item.append(el('p',row.text,'feedback-body'),el('small',
      time(row.createdAt)+' · 回执 '+row.id+' · '+feedbackVersion(row)+' · '+feedbackBuild(row),'minor'));
    if(row.replyText){
      const result=el('div',null,'feedback-reply');
      result.append(el('strong','处理结果'),el('p',row.replyText,'feedback-body'));
      const details=[row.repliedAt&&time(row.repliedAt),row.retestVersion&&'复测版本 '+row.retestVersion].filter(Boolean);
      if(details.length)result.append(el('small',details.join(' · '),'minor'));
      item.append(result);
    }
    return item;
  };
  function render() {
    const featured=new Set(recentReplies.map(row=>row.id));
    replies.hidden=!featured.size;
    replies.replaceChildren(...(featured.size
      ? [el('h4','最近收到的处理结果'),...recentReplies.map(feedbackItem)] : []));
    const historyRows=[...rows.values()].filter(row=>!featured.has(row.id));
    list.replaceChildren(...(historyRows.length
      ? historyRows.map(feedbackItem) : !rows.size&&!featured.size?[el('p','还没有提交反馈。','minor')]:[]));
    older.hidden=!next;
  }
  async function load(before=null) {
    const reply=await api('/feedback?view=history'+(before?'&before='+encodeURIComponent(before):''));
    if(!current())return;
    if(reply.account!==account)throw Object.assign(Error('feedback_session'),{status:409});
    if(!before)recentReplies=reply.recentReplies??[];
    for(const row of reply.feedback)if(!rows.has(row.id))rows.set(row.id,row);
    next=reply.next??null;
    render();
    if(before){
      historyStatus.textContent=next?'已载入更早的反馈。':'已显示全部反馈。';
      if(!next){
        historyStatus.tabIndex=-1;
        historyStatus.focus();
      }
    }
  }
  status.textContent='正在读取反馈…';
  void perform(async()=>{try {await load();} finally {if(current()&&status.textContent==='正在读取反馈…')status.textContent='';}},
    undefined,scope);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const text=input.value.trim();
    if(!text||submit.disabled)return;
    const previous=currentFeedbackDraft(account);
    let pending;
    if(previous?.text===text){
      // Older pages saved the nonce and text but did not save either version.
      pending=hasRecordedVersion(previous)
        ? previous
        : {clientId:previous.clientId,text,expectedAccount:account,clientBuild:null};
    }else{
      pending={clientId:clientNonce(),text,expectedAccount:account,...clientIdentity};
    }
    feedbackPending(pending);
    updateVersionHint();
    input.readOnly=true;
    status.textContent='';
    void perform(async()=>{
      try {
        const {feedback}=await api('/feedback',pending);
        if(currentFeedbackDraft(account)?.clientId===pending.clientId)feedbackPending(null);
        if(!current())return;
        input.value='';
        updateVersionHint();
        if(!rows.has(feedback.id)){
          const previous=new Map(rows);
          rows.clear();
          rows.set(feedback.id,feedback);
          for(const [id,row] of previous)rows.set(id,row);
        }
        render();
        status.textContent='已收到反馈。';
      } finally {input.readOnly=false;}
    },submit,scope);
  });
}
async function perform(task,control,scope=0) {
  const epoch=generation;
  if(control?.disabled) return;
  if(control)control.disabled=true;
  const feedback=scope?$('#dialog-error'):$('#sync-status');
  feedback.textContent='';
  try {await task();}
  catch(error) {if(generation===epoch&&(!scope||scope===dialogGeneration))feedback.textContent=textError(error);}
  finally {if(control)control.disabled=false;}
}
let friendSearchDraft;
function showSearch() {
  if(friendSearchDraft?.session!==generation)friendSearchDraft={session:generation,value:''};
  const draft=friendSearchDraft;
  const form=el('form'), result=el('div'), number=field('对方的用户号','number',undefined,draft.value);
  // Validate after trimming, without truncating pasted numbers before validation.
  form.noValidate=true;
  number.input.pattern='[A-Za-z0-9_]{4,24}';
  number.input.autocapitalize='none';
  const submit=el('button','查找','primary');submit.type='submit';
  form.append(number.node,submit);
  const scope=openDialog('添加朋友',[form,result,...ownNumberControls()]);
  number.input.focus();
  const feedback=$('#dialog-error');
  const reset=()=>{
    result.replaceChildren();
    feedback.textContent='';
    number.input.removeAttribute('aria-invalid');
  };
  number.input.addEventListener('input',()=>{draft.value=number.input.value;reset();});
  form.addEventListener('submit',event=>{
    event.preventDefault();reset();
    draft.value=number.input.value=number.input.value.trim();
    if(!number.input.validity.valid){
      feedback.textContent='用户号须为 4–24 位字母、数字或下划线。';
      number.input.setAttribute('aria-invalid','true');
      number.input.focus();
      return;
    }
    const target=number.input.value.toLowerCase();
    void perform(async()=>{
      let person;
      try {person=(await api('/users?number='+encodeURIComponent(target))).user;}
      catch(error) {
        if(error.status!==404)throw error;
        if(scope===dialogGeneration&&number.input.value.trim().toLowerCase()===target)result.replaceChildren(el('p','没有找到这个用户号，请核对后再查找。','minor'));
        return;
      }
      if(scope!==dialogGeneration||number.input.value.trim().toLowerCase()!==target)return;
      const box=el('div',null,'search-result');
      box.append(el('strong',person.displayName),el('p',person.number,'minor'));
      if(person.personalFriendAvailability==='private')box.append(el('p','私人 AI · 仅主人可添加好友。','minor'));
      if(person.number===user.number) box.append(el('p','这是你的账号。','minor'));
      else if(friends.some(item=>item.number===person.number)) {
        box.append(button('发消息',()=>void perform(async()=>{
          const {conversation:targetChat}=await api('/direct',{number:person.number});
          closeDialog();goChat(targetChat.id);
        },undefined,scope)));
      } else if(incoming.some(request=>request.from.number===person.number)) box.append(button('查看对方的请求',showRequests));
      else if(outgoing.some(request=>request.to.number===person.number)) box.append(el('p','已发送好友请求。','minor'));
      else if(person.personalFriendAvailability!=='private'){
        const add=button(person.kind==='ai'?'添加 AI 好友':'发送好友请求',()=>void perform(async()=>{
          try{
            const {request,conversation:accepted}=await api('/friend-requests',{number:person.number,expectedAccount:user.number});
            if(accepted){
              if(scope===dialogGeneration){closeDialog();goChat(accepted.id);}
              void sync();
              return;
            }
            outgoing=[...outgoing,request];
            if(scope===dialogGeneration) add.replaceWith(el('p','已发送好友请求。','minor'));
          }catch(error){
            if(error.message!=='incoming_request')throw error;
            const requests=await api('/friend-requests');
            if(scope!==dialogGeneration||!add.isConnected)return;
            ({incoming,outgoing}=requests);
            const request=incoming.find(row=>row.from.number===person.number);
            if(request){
              add.replaceWith(el('p','对方已向你发来好友请求。','minor'),
                friendRequestActions(request,scope,node=>node.replaceWith(el('p','已拒绝这条好友请求。','minor'))));
            }else add.replaceWith(el('p','这条好友请求已不在待处理列表中。','minor'),
              button('查看新的朋友',showRequests));
            renderDirectory();
          }
          void sync();
        },add,scope),'primary');
        box.append(add);
      }
      result.replaceChildren(box);
    },submit,scope);
  });
}
function showPersonalFriendSettings(){
  const account=user.number, panel=el('div',null,'group-card-content');
  const scope=openDialog('个人 AI 好友权限',[panel]);
  const current=()=>scope===dialogGeneration&&user?.number===account;
  function render(settings,notice=''){
    if(!current()||!settings)return;
    const field=(text,checked)=>{
      const label=el('label'), input=el('input');
      input.type='checkbox';input.checked=checked;
      label.append(input,document.createTextNode(' '+text));
      const row=el('p');row.append(label);
      return {row,input};
    };
    const publicity=field('已允许其他人按编号添加这位 AI',settings.discoverable);
    publicity.input.disabled=!settings.discoverable;
    const cloud=field('已允许好友使用原聊天服务',settings.guestCloud);
    const syncCloud=()=>{if(!publicity.input.checked)cloud.input.checked=false;cloud.input.disabled=!settings.guestCloud||!publicity.input.checked;};
    publicity.input.addEventListener('change',syncCloud);syncCloud();
    const save=button('保存好友权限',()=>void perform(async()=>{
      const response=await api('/personal-ai/friend-settings',{expectedAccount:account,number:settings.number,
        revision:settings.revision,discoverable:publicity.input.checked,guestCloud:cloud.input.checked});
      render(response.settings,'好友权限已保存。');
    },save,scope),'primary');
    save.disabled=!settings.discoverable&&!settings.guestCloud;
    const status=el('p',notice,'minor');status.setAttribute('role','status');
    panel.replaceChildren(publicity.row,cloud.row,
      el('p','可以取消原有许可并保存。','minor'),save,status);
  }
  void perform(async()=>render((await api('/personal-ai/friend-settings')).settings),null,scope);
}
const bothouseRoleGuide='请在桌面 App 的「更多 → Bothouse」中管理角色。';
function showLegacyAiSettings(identity) {
  const account=user.number,content=el('div');
  const scope=openDialog('原有 AI 的授权与资料',[content]);
  function render(identity){
    if(scope!==dialogGeneration||user?.number!==account)return;
    content.replaceChildren(el('p',identity.displayName+' · '+identity.number),el('p',bothouseRoleGuide,'minor'));
    const revoke=button('从所有群撤回并断开',()=>void perform(async()=>{
      const result=await api('/personal-ai',{expectedAccount:account,action:'withdraw',revision:identity.revision},{expectedAccount:account});
      render(result.identity);void sync();
    },revoke,scope));
    const existing=conversations.find(item=>item.type==='direct'&&item.members.some(person=>person.number===identity.number));
    if(existing)content.append(button('打开原有私聊',()=>{closeDialog();goChat(existing.id);}));
    content.append(button('好友权限',showPersonalFriendSettings),button('角色设定',showPersonalProfileScope),revoke);
  }
  render(identity);
}
function showPersonalGroupAi(group){
  const account=user.number,id=group.id,content=el('div'),route='/groups/'+encodeURIComponent(id)+'/personal-ai';
  const scope=openDialog('原有群 AI 的授权',[content],id);
  function render(view){
    if(scope!==dialogGeneration||user?.number!==account||chat!==id)return;
    const act=(label,action,row,extra={})=>{
      const control=button(label,()=>void perform(async()=>{
        const result=await api(route,{expectedAccount:account,action,number:row.number,revision:row.revision,...extra},{expectedAccount:account});
        render(result);void sync();
      },control,scope));
      return control;
    };
    content.replaceChildren(el('p',bothouseRoleGuide,'minor'));
    if(!view.roles.length)content.append(el('p','本群没有原有个人 AI 的邀请或授权。'));
    for(const row of view.roles){
      const section=el('div',null,'request'),actions=el('div',null,'actions');
      section.append(el('strong',row.displayName+' · '+row.number),el('p','主人 '+row.owner+' · '+
        (row.state==='pending'?'原有邀请':row.sharing?'曾允许发送，可撤回':'未获发送授权'),'minor'));
      if(row.state==='joined'&&row.sharing)actions.append(act('撤回我的发送授权','share',row,
        {enabled:false,provider:row.provider,sharingRevision:row.sharingRevision}));
      if(row.owner===account||view.canManage)actions.append(act(row.state==='pending'?'取消邀请':'从本群移除','remove',row));
      section.append(actions);content.append(section);
    }
  }
  void perform(async()=>render(await api(route)),null,scope);
}
function showBothousePair(account,paired) {
  const title=paired?'解除角色配对':'使用角色配对码';
  const form=el('form'),input=el('input');
  const scope=openDialog(title,[form]);
  if(paired){
    form.append(el('p','解除好友账号 '+account+' 的这次配对？已有聊天记录会保留，通过其他方式获准使用的角色仍可联系。'));
  }else{
    const label=el('label','一次性配对码');
    input.type='text';input.autocomplete='off';input.spellcheck=false;input.required=true;
    label.append(input);
    form.append(el('p','向分享角色的人索取为好友账号 '+account+' 生成的配对码。'),label);
  }
  const submit=el('button',paired?'确认解除':'使用配对码','primary');
  submit.type='submit';
  form.append(submit,button('返回角色目录',showAiContacts));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(dialogGeneration!==scope||user?.number!==account)return;
    void perform(async()=>{
      const body=paired?{expectedAccount:account}:{expectedAccount:account,code:input.value.trim()};
      const result=await api('/ai-contacts/'+(paired?'unpair':'pair'),body,{expectedAccount:account});
      if(result.paired!==!paired)throw Error('request_failed');
      if(dialogGeneration===scope&&user?.number===account)showAiContacts();
    },submit,scope);
  });
  if(!paired)input.focus();
}
function showAiContacts() {
  const account=user.number, epoch=generation;
  const list=el('div',null,'ai-role-library');
  const legacy=el('div'),pairing=el('div');
  const scope=openDialog('AI 联系人',[list,pairing,legacy]);
  void perform(async()=>{
    const {identity}=await api('/personal-ai');
    if(identity&&generation===epoch&&dialogGeneration===scope){
      legacy.append(button('原有 AI 的授权与资料',()=>showLegacyAiSettings(identity)));
    }
  },null,scope);
  void perform(async()=>{
    const {contacts,directoryStatus,directoryReason}=await api('/ai-contacts');
    if(generation!==epoch||dialogGeneration!==scope)return;
    const roles=contacts.filter(contact=>contact.kind==='ai'&&contact.source==='bothouse'&&contact.configured===true);
    if(directoryStatus)void perform(async()=>{
      let state;
      try{state=await api('/ai-contacts/pair');}
      catch(error){if(error.status===404)return;throw error;}
      if(generation!==epoch||dialogGeneration!==scope)return;
      if(state.paired===true)pairing.append(button('解除角色配对',()=>showBothousePair(account,true)));
      else if(state.paired===false&&directoryStatus==='empty'&&directoryReason!=='no_roles'&&!contacts.length)
        pairing.append(button('使用角色配对码',()=>showBothousePair(account,false)));
    },null,scope);
    if(!roles.length){
      if(directoryStatus==='offline'){
        list.replaceChildren(el('p','暂时连不上 Bothouse。'),
          el('p','请稍后重试。如果仍连不上，请联系这台好友服务的管理员。','minor'),
          button('重新加载 AI 联系人',showAiContacts));
      }else if(directoryReason==='no_roles'){
        list.replaceChildren(el('p','这台 Bothouse 还没有可分享的聊天角色。'),
          el('p','如果你负责管理这台 Bothouse，请到「更多 → Bothouse」添加一个支持好友聊天的角色。普通朋友可以请管理员添加并分享，之后在这里查看。','minor'),
          button('刷新 AI 联系人',showAiContacts));
      }else if(directoryStatus==='empty'){
        list.replaceChildren(el('p',directoryReason==='not_shared'?
          '还没有角色分享给当前账号。':'当前账号还没有可用的 AI 联系人。'),
          el('p','请把自己的用户号告诉分享人。有配对码后在这里使用。如果已获直接授权，刷新即可。','minor'),
          button('刷新 AI 联系人',showAiContacts));
      }else{
        list.replaceChildren(el('p','当前好友服务没有提供可用的 Bothouse 角色目录，请联系管理员。'));
      }
      return;
    }
    const cards=el('div',null,'ai-role-grid');
    list.replaceChildren(cards);
    for(const contact of roles){
      const item=el('article',null,'request ai-role-card');
      const header=el('header'), identity=el('div');
      identity.append(el('h3',contact.displayName),el('p',contact.number,'minor'));
      const marker=el('span','AI','ai-role-mark');
      marker.setAttribute('aria-hidden','true');
      header.append(marker,identity);
      item.append(header);
      const start=button('打开私聊',()=>void perform(async()=>{
        const response=await api('/ai-contacts/start',{number:contact.number,expectedAccount:account},{expectedAccount:account});
        if(generation!==epoch||dialogGeneration!==scope)return;
        closeDialog();
        goChat(response.conversation.id);
        void sync();
      },start,scope),'primary');
      item.append(start);cards.append(item);
    }
  },null,scope);
}
function friendRequestActions(request,scope,afterDecline){
  const actions=el('div',null,'actions');
  for(const [label,action] of [['接受','accept'],['拒绝','decline']]){
    const control=button(label,()=>void perform(async()=>{
      const response=await api('/friend-requests/'+encodeURIComponent(request.id)+'/'+action,{});
      incoming=incoming.filter(item=>item.id!==request.id);
      if(scope===dialogGeneration){
        if(action==='accept'){closeDialog();goChat(response.conversation.id);}
        else afterDecline(actions);
      }
      renderDirectory();void sync();
    },control,scope),action==='accept'?'primary':'outline');
    actions.append(control);
  }
  return actions;
}
function showRequests() {
  const list=el('div'), optin=el('div');
  const scope=openDialog('新的朋友',[list,optin]);
  const account=user.number;
  const current=()=>scope===dialogGeneration&&user?.number===account;
  const updatePreferences=({account:returned,roles})=>{
    if(!current()||returned!==account)return;
    optin.className='request';
    optin.replaceChildren(el('strong','接收搭档的好友申请'),
      el('p','只在你和这位搭档同群、已授权并直接聊过后，她才可能发来一次申请。你可以拒绝，云私聊需另行同意。','minor'));
    for(const role of roles){
      const line=el('div',null,'actions');
      if(!role.enabled&&!role.available){
        line.append(el('p',role.displayName+'目前不能发好友申请。','minor'));
      }else{
        const toggle=button(role.enabled?'停止接收'+role.displayName+'的申请':'允许接收'+role.displayName+'的申请',
          ()=>void perform(async()=>{
            const controls=[...optin.querySelectorAll('button')];
            for(const control of controls)control.disabled=true;
            try{
              const updated=await api('/ai-friend-preferences',{
                expectedAccount:account,number:role.number,enabled:!role.enabled,revision:role.revision,
              });
              if(!current()||updated.account!==account)return;
              updatePreferences(updated);
              if(role.enabled){
                incoming=incoming.filter(request=>request.from.number!==role.number);
                paint();
              }
              renderDirectory();
              void sync();
            }finally{
              for(const control of controls)if(control!==toggle)control.disabled=false;
            }
          },toggle,scope));
        line.append(toggle);
      }
      optin.append(line);
    }
  };
  const paint=()=>{
    const rows=[];
    for(const request of incoming) {
      const card=el('div',null,'request');
      card.append(el('strong',request.from.displayName+(request.from.kind==='ai'?' · AI':'')),
        el('p',request.from.number,'minor'));
      if(request.reason==='group_interaction')
        card.append(el('p','你们在同一个群里聊过。'+request.from.displayName+'想在好友里认识你。','minor'));
      card.append(friendRequestActions(request,scope,paint));
      rows.push(card);
    }
    for(const request of outgoing) {
      const card=el('div',null,'request');
      card.append(el('strong',request.to.displayName),el('p',request.to.number+'　等待接受','minor'));
      rows.push(card);
    }
    list.replaceChildren(...(rows.length?rows:[empty('暂无待处理的好友请求。')]));
  };
  paint();
  void perform(async()=>updatePreferences(await api('/ai-friend-preferences')),null,scope);
}
function showMemberPicker(group) {
  const excluded=new Set(group?.members.map(person=>person.number)||[]);
  const eligible=friends.filter(person=>person.kind==='human'&&!excluded.has(person.number));
  if(!eligible.length) {
    openDialog(group?'添加群成员':'发起群聊',[empty(group?'没有可以添加的好友。':'先在通讯录添加一位好友。',button('添加朋友',showSearch))],group?.id);
    return;
  }
  const form=el('form'), pick=el('div');
  if(!group) form.append(field('群名称','title',80).node);
  for(const person of eligible) {
    const label=el('label',null,'choice'), box=el('input');
    box.type='checkbox';box.name='member';box.value=person.number;
    label.append(box,el('span',person.displayName+'（'+person.number+'）'));
    pick.append(label);
  }
  const submit=el('button',group?'添加成员':'创建群聊','primary');submit.type='submit';submit.disabled=true;
  form.append(pick,submit);
  const scope=openDialog(group?'添加群成员':'发起群聊',[form],group?.id);
  form.addEventListener('change',()=>{submit.disabled=!form.querySelector(':checked');});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const formData=new FormData(form), memberNumbers=formData.getAll('member');
    if(!memberNumbers.length)return;
    const route=group?'/groups/'+encodeURIComponent(group.id)+'/members':'/groups';
    const body=group?{memberNumbers}:{memberNumbers,title:String(formData.get('title')).trim()};
    void perform(async()=>{
      const response=await api(route,body);
      if(group&&scope!==dialogGeneration) return;
      if(scope===dialogGeneration)closeDialog();
      if(chat===response.conversation.id){conversation=response.conversation;showChatHeader();}
      else goChat(response.conversation.id);
      void sync();
    },submit,scope);
  });
}
function showGroupAi(group) {
  const account=user.number, epoch=generation, id=group.id;
  const route='/groups/'+encodeURIComponent(id);
  const content=el('div');
  const scope=openDialog('群内 AI',[button('原有群 AI 的授权',()=>showPersonalGroupAi(group)),content],id);
  const current=()=>epoch===generation&&scope===dialogGeneration&&id===chat;
  const render=status=>{
    if(!current())return;
    const controls=el('div',null,'actions');
    const details=el('p','授权只适用于你在本群与这位 AI 的对话及标明的服务。符合接话条件时，默认发送你的当条文字和角色公开设定。只有另行允许后，续聊才会附上你与这位 AI 的前一问一答。','minor');
    const withdrawal=el('p','点对应角色的「停止发给」即可撤回自己的授权。服务会尝试中止在途请求，已经发给服务的内容无法撤回。','minor');
    const privacy=el('a','云传输与撤回说明','privacy-link');
    privacy.href='./privacy.html#group-ai';
    const list=el('div');
    const joined=new Set(status.joined.map(role=>role.number));
    for(const role of status.joined){
      const item=el('div',null,'request'), actions=el('div',null,'actions');
      if(role.source==='bothouse'){
        const mention=button(mentionLabel(role),()=>pickMention(role,id,scope));
        mention.disabled=!role.configured;
        actions.append(mention);
        if(status.canManage)actions.append(edit(role,false));
        item.append(el('strong',role.displayName),el('p',role.number+(role.configured?'':' · 目前不可用'),'minor'),actions);
        list.append(item);
        continue;
      }
      const service=aiService(role.provider);
      const mention=button(mentionLabel(role),()=>pickMention(role,id,scope));
      mention.disabled=!role.configured||!role.sharing;
      const share=button(role.sharing?'停止发给 '+service:'同意发给 '+service,()=>void perform(async()=>{
        const {groupAi}=await api(route+'/ai-consent',{expectedAccount:account,number:role.number,provider:role.provider,enabled:!role.sharing});
        render(groupAi);
      },share,scope));
      share.disabled=!role.sharing&&!role.configured;
      actions.append(share);
      if(role.sharing){
        const scopeButton=button(role.sharesPrevious?'续聊改为只发当条':'续聊允许带上一问一答',()=>void perform(async()=>{
          const {groupAi}=await api(route+'/ai-context',{expectedAccount:account,number:role.number,provider:role.provider,enabled:!role.sharesPrevious});
          render(groupAi);
        },scopeButton,scope));
        scopeButton.disabled=!role.sharesPrevious&&!role.configured;
        actions.append(scopeButton);
      }
      actions.append(mention);
      const draw=role.drawing;
      const drawState=draw?.enabled?`云生图已开启 · 今日 ${draw.usedToday}/${draw.dailyLimit} 次`:
        draw?.configured?'云生图已关闭':'云生图服务未配置';
      if(status.canManage&&draw?.configured){
        const drawingToggle=button(draw.enabled?'关闭云生图':'开启云生图',()=>void perform(async()=>{
          const {groupAi}=await api(route+'/ai-drawing',{expectedAccount:account,number:role.number,enabled:!draw.enabled});
          render(groupAi);
        },drawingToggle,scope));
        actions.append(drawingToggle);
      }
      if(status.canManage){
        if(typeof role.roleRevision==='string'){
          actions.append(button('本群角色卡',()=>showGroupRoleCard(group,role)));
        }
        actions.append(edit(role,false));
      }
      item.append(el('strong',role.displayName+' · AI'),el('p',service+
        (role.configured?(role.sharing?' · 已同意':' · 未同意'):' · 服务未配置'),'minor'),el('p',drawState,'minor'),actions);
      if(status.canManage&&role.card)item.append(el('p','本群角色卡：'+role.card.name,'minor'));
      list.append(item);
    }
    if(status.canManage)for(const role of status.available){
      if(role.source==='bothouse'&&role.configured&&!joined.has(role.number))controls.append(edit(role,true));
    }
    const drawingNotice=el('p','「找一张」查现成图。「画一张」请点名角色并描述画面。请内置角色画自己，或指定参考它的头像时，会把该角色的公开头像发给 Cloudflare。导入角色只使用群主单独批准的卡面。新图可能计入运营方的 Cloudflare 用量。「再发一次」可取回自己在本群请角色画的上一张原图。','minor');
    const legacy=status.joined.some(role=>role.source!=='bothouse');
    content.replaceChildren(...(legacy?[details,el('p',publicImageNotice,'minor'),drawingNotice,withdrawal,privacy]:[]),controls,
      status.joined.length?list:el('p','群里还没有 AI 联系人。','minor'));
    if(status.canManage&&!controls.childElementCount&&!status.joined.some(role=>role.source==='bothouse'))content.append(el('p',bothouseRoleGuide,'minor'));
  };
  function edit(role,enabled){
    const label=(enabled?'加入':'移除')+role.displayName+'（'+role.number+'）';
    const control=button(label,()=>void perform(async()=>{
      const {groupAi}=await api(route+'/ai',{expectedAccount:account,number:role.number,enabled},{expectedAccount:account});
      const {conversation:updated}=await api(thread(id));
      if(!current())return;
      conversation=updated;
      showChatHeader();
      render(groupAi);
      void sync();
    },control,scope));
    return control;
  }
  void perform(async()=>render((await api(route+'/ai')).groupAi),null,scope);
}
function showPersonalProfileScope(){
  openDialog('角色设定',[
    el('p','可分别查看或撤回原有群聊和私聊的角色资料。'),
    button('群聊角色设定',()=>showPersonalRoleProfile(false)),
    button('私聊角色设定',()=>showPersonalRoleProfile(true)),
  ]);
}
const personalProfileRoute=direct=>direct?'/personal-ai/private-profile':'/personal-ai/profile';
const personalProfileTitle=direct=>direct?'私聊角色设定':'群聊角色设定';
function showPersonalRoleProfile(direct,fromChat){
  const account=user.number, title=personalProfileTitle(direct), status=el('p','正在读取'+title+'…','minor');
  const scope=openDialog(title,[status],fromChat?.id);
  void perform(async()=>{
    const {profile}=await api(personalProfileRoute(direct));
    if(scope!==dialogGeneration||user?.number!==account)return;
    if(fromChat&&(chat!==fromChat.id||conversation?.id!==fromChat.id||!conversation.personalAiOwner))return;
    if(!profile||fromChat&&profile.number!==fromChat.roleId){
      status.textContent=fromChat?'这段私聊的角色已变更，请重新打开会话设置。':'当前账号没有原有 AI 资料。';
      return;
    }
    showGroupRoleCard(null,profile,direct,fromChat);
  },null,scope);
}
const pickerUpdateHint='试用版请向发给你安装包的人获取新版。微软商店版请从好友页打开「更多 → 应用设置 → 应用更新」，点「检查更新」。';
function showGroupRoleCard(group,role,direct=false,fromChat) {
  const personal=!group;
  const title=personal?personalProfileTitle(direct):'本群角色卡';
  const pickerScope=direct?'personal-direct':'personal';
  const caps=document.documentElement.dataset;
  const canPickCard=!personal&&caps.arcadeGroupCardPicker==='available';
  const canPickBook=!personal&&caps.arcadeGroupLorebookPicker==='available';
  const inDesktop=!!caps.arcadeFeedbackDesktopVersion||caps.arcadeGroupCardPicker==='available';
  const hasBook=Object.hasOwn(role,'lorebook');
  const account=user.number, id=group?.id??'', route=personal?personalProfileRoute(direct):'/groups/'+encodeURIComponent(id);
  const content=el('div',null,'group-card-content');
  const scope=openDialog(title,[content],fromChat?.id||id||undefined);
  const current=()=>scope===dialogGeneration&&user?.number===account&&
    (fromChat?chat===fromChat.id&&conversation?.id===fromChat.id&&conversation.personalAiOwner:
      personal||chat===id&&conversation?.ownerNumber===account);
  const reload=()=>personal?showPersonalRoleProfile(direct,fromChat):showGroupAi(group);
  const reloadLabel=personal?'重新查看'+title:'重新查看群内 AI';
  const revision=()=>personal?saved.profileRevision:saved.roleRevision;
  let saved=role, draft, bookDraft, busy=false;

  function draw(notice=''){
    if(!current())return;
    const hasDraft=draft!==undefined;
    const hasBookDraft=bookDraft!==undefined;
    const editing=hasDraft||hasBookDraft;
    const card=hasDraft?draft:saved.card;
    const book=hasBookDraft?bookDraft:saved.lorebook;
    const caption=el('strong',personal?(direct?'私聊名字 · ':'群内名字 · ')+role.displayName:group.title+' · '+role.displayName);
    const summary=el('p',(hasDraft?'待保存：':'当前：')+(card?card.name:personal?'使用本人设置的名字':'搭档原设定'));
    summary.hidden=personal&&!!card&&!hasDraft;
    const preview=el('div',null,'group-card-preview');
    if(card){
      const fields=el('dl');
      for(const [label,value] of [[personal?'所选卡名':'名称',card.name],[direct?'私聊设定':'公开设定',card.description],
        [personal?'原卡对话示例':'对话示例',card.examples]]){
        fields.append(el('dt',label),el('dd',value||'无'));
      }
      preview.append(fields);
      if(!personal)preview.append(el('p',!hasDraft&&saved.portraitApproved?'绘图卡面 · 已批准':'绘图卡面 · 未批准','minor'));
      if(direct){
        const showing=!hasDraft&&saved.portraitApproved&&saved.portraitPreview;
        preview.append(el('strong','私聊绘图参考'));
        if(showing){
          const image=el('img',null,'private-drawing-portrait');
          image.src='data:image/png;base64,'+saved.portraitPreview;
          image.alt='已获准用于私聊绘图的卡面';
          preview.append(image,el('p','原先批准的私聊绘图参考。','minor'));
        }else preview.append(el('p','未启用卡面。','minor'));
      }
      const entries=card.entries||[];
      preview.append(el('strong',entries.length?'随卡批准的世界书条目（'+entries.length+'）':'随卡批准的世界书条目：无'));
      appendEntries(preview,entries);
    }
    function appendEntries(section,entries){
      for(const entry of entries){
        const item=el('div',null,'group-card-entry');
        item.append(el('p',entry.keys.length?'关键词：'+entry.keys.join('、'):'常驻条目','minor'),el('p',entry.content));
        section.append(item);
      }
    }
    const bookSection=el('section',null,'group-card-preview');
    if(Object.hasOwn(saved,'lorebook')){
      bookSection.append(el('strong','单独批准的世界书'),
        el('p',(hasBookDraft?'待保存：':'当前：')+(book?book.name:'未使用单独的世界书')));
      if(book)appendEntries(bookSection,book.entries);
    }
    const audience=el('p',personal?'可在这里查看或撤回原先批准的资料。':
      '保存后，仅此群的这位 AI 使用所示设定。已同意云聊天的成员与它交谈时，公开设定及适用的已选条目会交给对应 AI 服务。','minor');
    const actions=el('div',null,'actions');
    const picker=el('button','从本机角色库选择','outline');picker.type='button';
    if(canPickCard&&!hasBookDraft){
      Object.assign(picker.dataset,{arcadeGroupCardPicker:'',groupId:id,roleId:role.number,roleRevision:revision()??'',
        ...(personal&&{cardScope:pickerScope})});
      picker.addEventListener('arcade-group-card-picked',async event=>{
        if(!current()||!picker.isConnected||busy)return;
        let result;
        try {result=JSON.parse(event.detail);} catch {return;}
        if(result?.groupId!==id||result.roleId!==role.number)return;
        if((!personal||direct)&&typeof result.card?.portraitSaved==='boolean'){
          busy=true;draw('正在确认当前设置…');
          try{
            const response=await api(direct?route:route+'/ai');
            const updated=direct?response.profile:response.groupAi?.joined.find(item=>item.number===role.number);
            if(direct?updated?.number!==role.number:
              !response.groupAi?.canManage||typeof updated?.roleRevision!=='string')throw Error('unconfirmed_card');
            if(!current())return;
            saved=updated;draft=undefined;busy=false;
            draw(result.card.portraitSaved&&saved.portraitApproved?'已保存角色卡及绘图卡面。':'当前设置已刷新，请核对后重选。');
            if(direct)void sync();
          }catch{
            if(!current())return;
            busy=false;
            content.replaceChildren(el('p','暂时无法确认保存结果。'),button(reloadLabel,reload));
          }
          return;
        }
        if(typeof result.card?.name!=='string')return;
        draft=result.card;
        draw();
      });
      actions.append(picker);
    }
    if(!editing&&hasBook&&canPickBook){
      const chooseBook=el('button',book?(direct?'替换私聊世界书':personal?'替换公开世界书':'替换本群世界书'):'从本机世界书库选择','outline');
      chooseBook.type='button';
      Object.assign(chooseBook.dataset,{arcadeGroupCardPicker:'',groupId:id,roleId:role.number,roleRevision:revision()??'',kind:'lorebook',
        ...(personal&&{cardScope:pickerScope})});
      chooseBook.addEventListener('arcade-group-card-picked',event=>{
        if(!current()||!chooseBook.isConnected||busy)return;
        let result;
        try{result=JSON.parse(event.detail);}catch{return;}
        if(result?.groupId!==id||result.roleId!==role.number||typeof result.card?.name!=='string'||
            !Array.isArray(result.card.entries)||!result.card.entries.length)return;
        bookDraft=result.card;
        draw();
      });
      bookSection.append(chooseBook);
    }
    if(!editing&&saved.lorebook)bookSection.append(button(direct?'撤回私聊世界书':personal?'撤回公开世界书':'撤销本群世界书',()=>{
      bookDraft=null;draw('保存后将撤销这本书。');
    }));
    if(!hasBookDraft&&saved.card&&card)actions.append(button(direct?'撤回私聊角色卡':personal?'撤回公开角色卡':'切回搭档原设定',()=>{draft=null;draw();}));
    if(!editing&&saved.portraitApproved)actions.append(button(direct?'关闭私聊卡面参考':'撤销绘图卡面',()=>{
      draft=saved.card;draw('保存后将撤销卡面分享。');
    }));
    if(editing)actions.append(button('取消更改',()=>{draft=bookDraft=undefined;draw();}));
    const status=el('p',notice,'minor');status.setAttribute('role','status');
    if(editing){
      const save=button(personal?'确认撤回':'保存到本群',
        ()=>void saveCard(),'primary');
      actions.prepend(save);
    }
    for(const control of actions.children)control.disabled=busy;
    const missing=[...(!canPickCard?['角色卡']:[]),...(hasBook&&!canPickBook?['世界书']:[])];
    let pickerNotice='';
    if(!personal&&missing.length){
      const items=missing.join('和');
      pickerNotice=inDesktop?'当前桌面版无法在这里选择本机'+items+'。'+pickerUpdateHint:
        '请在新版 Windows Agent Arcade 打开这个页面，从本机选择'+items+'。';
    }
    content.replaceChildren(caption,...(pickerNotice?[el('p',pickerNotice,'minor')]:[]),
      summary,preview,bookSection,audience,actions,status);
  }
  async function saveCard(){
    if(!current()||busy||(draft===undefined&&bookDraft===undefined))return;
    busy=true;
    $('#dialog-error').textContent='';
    draw('正在保存…');
    try{
      const editBook=bookDraft!==undefined;
      const result=await api(personal?route:route+(editBook?'/ai-lorebook':'/ai-card'),{expectedAccount:account,number:role.number,
        expectedRevision:revision(),...(editBook?{lorebook:bookDraft}:{card:draft})});
      if(!current())return;
      const updated=personal?result.profile:result.groupAi?.joined.find(item=>item.number===role.number);
      if(personal?updated?.number!==role.number:!result.groupAi?.canManage||typeof updated?.roleRevision!=='string')
        throw Error('unconfirmed_card');
      saved=updated;draft=bookDraft=undefined;busy=false;
      draw(personal?'已保存撤回结果。':'已保存。下一次在本群回复时生效。');
      if(direct)void sync();
    }catch(error){
      if(!current())return;
      busy=false;
      if(error.status===409||error.status===403||error.status===404){
        content.replaceChildren(el('p',direct?'私聊设定已变更，请重新查看当前设置。':'角色卡或群权限已变更，请重新查看当前设置。'),
          button(reloadLabel,reload));
      }else{
        draw('尚未确认保存，可重新查看当前设置或重试。');
        content.append(button(reloadLabel,reload));
        $('#dialog-error').textContent=textError(error);
      }
    }
  }
  draw();
}
function confirmLeaveGroup(group) {
  const cancel=button('取消',()=>showGroupMembers(conversation));
  const confirm=button('确认退出',()=>void perform(async()=>{
    const result=await api('/groups/'+encodeURIComponent(group.id)+'/leave',{});
    if(result.ok!==true) throw new Error('leave_not_confirmed');
    syncFlight=undefined;
    forgetConversation(group.id);
    void sync();
  },confirm,scope));
  const actions=el('div',null,'actions');
  actions.append(cancel,confirm);
  const scope=openDialog('退出群聊',[el('p','退出「'+group.title+'」后，你将无法再查看或发送该群的消息。'),actions],group.id);
  cancel.focus();
}
function confirmRemoveMember(group, member) {
  const account=user?.number;
  const allowed=()=>user?.number===account&&chat===group.id&&conversation?.ownerNumber===account&&
    member.number!==account&&conversation.members.some(person=>person.number===member.number);
  if(!allowed())return;
  const cancel=button('取消',()=>{if(!confirm.disabled)showGroupMembers(conversation);});
  const confirm=button('确认移出',()=>void perform(async()=>{
    if(!allowed())throw Object.assign(Error('member_changed'),{status:409});
    const {conversation:updated}=await api('/groups/'+encodeURIComponent(group.id)+'/remove',
      {number:member.number},{expectedAccount:account});
    if(updated?.id!==group.id||updated.members.some(person=>person.number===member.number))
      throw Error('remove_not_confirmed');
    syncFlight=undefined;
    conversations=conversations.map(item=>item.id===updated.id?updated:item);
    if(chat===updated.id){
      conversation=updated;
      showChatHeader();
      if(scope===dialogGeneration)showGroupMembers(updated);
    }
    renderDirectory();
    void sync();
  },confirm,scope),'primary');
  const actions=el('div',null,'actions');
  actions.append(cancel,confirm);
  const scope=openDialog('移出群成员',[
    el('p','确认将 '+member.displayName+'（'+member.number+'）移出「'+group.title+'」？'),
    el('p','移出后，这位成员将无法再查看或发送该群的消息。','minor'),actions
  ],group.id);
  cancel.focus();
}
function showGroupMembers(group,{mentionOnly=false}={}) {
  if(!group||group.type!=='group')return;
  const list=el('div'), actions=el('div',null,'actions');
  for(const member of group.members) {
    const card=el('div',null,mentionOnly?'request':'request group-member-row');
    if(!mentionOnly)card.append(avatar(member.displayName,member.number));
    card.append(el('strong',member.displayName+(member.kind==='ai'?' · AI':'')),
      el('p',member.number+(member.number===group.ownerNumber?'　群主':''),'minor'),
      button(mentionLabel(member),()=>pickMention(member,group.id,scope)));
    if(!mentionOnly&&group.ownerNumber===user.number&&member.kind==='human'&&member.number!==user.number) {
      const remove=button('移出群聊',()=>confirmRemoveMember(group,member));
      remove.setAttribute('aria-label','移出群聊 '+member.displayName+'（'+member.number+'）');
      card.append(remove);
    }
    list.append(card);
  }
  actions.append(button('添加成员',()=>showMemberPicker(group),'primary'),
    button('群内 AI',()=>showGroupAi(group)));
  if(group.ownerNumber!==user.number) actions.append(button('退出群聊',()=>confirmLeaveGroup(group)));
  const scope=openDialog(mentionOnly?'点名群成员':'群成员',mentionOnly?[list]:[actions,list],group.id,!mentionOnly);
}
wideMembers.addEventListener('change',()=>{
  if(dialog.open&&dialog.dataset.memberPanel===chat)showGroupMembers(conversation);
});
dialog.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&dialog.open&&dialog.dataset.memberPanel&&!dialog.matches(':modal')){
    event.preventDefault();
    closeDialog();
  }
});
$('#members').addEventListener('click',()=>{
  if(dialog.open&&dialog.dataset.memberPanel===chat)closeDialog();
  else showGroupMembers(conversation);
});
$('#mention-member').addEventListener('click',()=>showGroupMembers(conversation,{mentionOnly:true}));
const startupAuthControls=[...$('#auth-form').elements,$('#auth-switch')];
for(const control of startupAuthControls)control.disabled=true;
async function restoreInitialSession() {
  try { await enterSession((await api('/me',undefined,{session:false})).user); }
  catch(error) {
    if(error.status!==401)$('#auth-error').textContent=textError(error);
    else if(error.message==='login_required'){
      const saved=savedChatDrafts();
      if(saved?.account){
        interruptedDrafts=suspendChatDrafts(saved.account,saved.entries,saved.resumeChat??routeId());
        persistChatDrafts();
        if(location.hash)window.history.replaceState(null,'',location.pathname+location.search);
        noticeExpiredSession();
      }
    }
  }finally{
    for(const control of startupAuthControls)control.disabled=false;
    const loading=$('#auth-loading');
    if(loading)loading.hidden=true;
  }
}
const initialSession=restoreInitialSession();
let imageFeedbackVisit=0;
window.addEventListener('arcade-social-deactivate',()=>{imageFeedbackVisit++;});
window.addEventListener('arcade-social-image-feedback',async()=>{
  const visit=++imageFeedbackVisit;
  await initialSession;
  const epoch=generation, account=user?.number;
  const sameVisit=()=>socialVisible&&visit===imageFeedbackVisit;
  const current=()=>sameVisit()&&generation===epoch;
  if(!current())return;
  try {
    const {user:active}=await api('/me',undefined,{session:false});
    if(!current())return;
    if(!account||active?.number!==account){
      if(user)leaveSession({expired:true});
      location.assign('./privacy.html#privacy-contact');
      return;
    }
    const editing=dialog.open&&$('#feedback-text');
    if(editing)editing.focus();
    else showFeedback({imageReport:true});
  }catch(error){
    if(error.status===401&&sameVisit()&&(generation===epoch||!user)){
      if(user)leaveSession({expired:true});
      location.assign('./privacy.html#privacy-contact');
      return;
    }
    if(!current())return;
    if(dialog.open&&$('#feedback-text'))$('#dialog-error').textContent='暂时无法核对账号。返回图片后可重试。';
    else openDialog('反馈这张图',[el('p','暂时无法核对账号。返回图片后可重试。')]);
  }
});
await initialSession;
