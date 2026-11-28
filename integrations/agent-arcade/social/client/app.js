const $ = selector => document.querySelector(selector);
const root = $('#workspace'), auth = $('#auth'), dialog = $('#dialog'), directory = $('#directory-body');
const historyView = $('#history'), messageBox = $('#message'), composer = $('#composer');
const tabs = [...root.querySelectorAll('[data-tab]')];
const labels = {messages:'消息', contacts:'通讯录', profile:'我'};
const pageSize = 50;
const date = new Intl.DateTimeFormat('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
let user, generation = 0, tab = 'messages', chat, conversation, messages = [], older = false;
let friends = [], incoming = [], outgoing = [], conversations = [], syncFlight, historyFlight, dialogGeneration = 0;
let authMode = 'login', authFlight = false;
const drafts = new Map(), sending = new Set(), attempts = new Map();
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function button(text, action, className = 'outline') {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function field(label, name, max, value = '') {
  const node = el('label', label), input = el('input');
  input.name = name;
  input.required = true;
  input.maxLength = max;
  input.value = value;
  node.append(input);
  return {node,input};
}
function avatar(name, seed = name) {
  const node = el('span', Array.from(name?.trim() || '聊')[0], 'avatar');
  node.dataset.tone = String(Array.from(seed || '').reduce((n,c) => n + c.codePointAt(0),0)%4);
  node.setAttribute('aria-hidden','true');
  return node;
}
function time(value) {
  return value && !Number.isNaN(Date.parse(value)) ? date.format(new Date(value)) : '';
}
function textError(error) {
  if (!error.status) return '暂时连不上服务，请检查网络后重试。';
  if (error.status === 401) return '请检查用户号和密码，或重新登录。';
  if (error.status === 403) return '你目前没有权限执行这项操作。';
  if (error.status === 404) return '没有找到这项内容，请核对后重试。';
  if (error.status === 409) return '当前状态已变化，或这个用户号已被使用。请刷新后重试。';
  if (error.status === 429) return '操作太频繁，请稍后再试。';
  return error.status === 400 ? '请检查填写内容后重试。' : '服务暂时不可用，请稍后再试。';
}
async function api(route, body, {session = true} = {}) {
  const epoch = generation;
  const response = await fetch('./api/v1' + route, {
    method:body === undefined ? 'GET' : 'POST',
    ...(body !== undefined && {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => null);
  if (session && epoch !== generation) throw new Error('session_changed');
  if (!response.ok || !payload) {
    if (response.status === 401 && session && user && epoch === generation) leaveSession();
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
  form.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}
function leaveSession() {
  ++generation;
  user = null;
  chat = conversation = undefined;
  friends = incoming = outgoing = conversations = messages = [];
  drafts.clear();
  sending.clear();
  attempts.clear();
  syncFlight = historyFlight = undefined;
  closeDialog();
  root.hidden = true;
  root.classList.remove('in-chat');
  showChatHeader();
  $('#directory-actions').replaceChildren();
  $('#directory-body').replaceChildren();
  historyView.replaceChildren();
  messageBox.value = '';
  $('#chat-avatar').replaceChildren();
  for (const selector of ['#chat-title', '#chat-detail', '#send-error', '#sync-status', '#dialog-error', '#contact-count']) {
    $(selector).textContent = '';
  }
  $('#contact-count').hidden = true;
  if (location.hash) window.history.replaceState(null,'',location.pathname+location.search);
  $('#auth-form').reset();
  toggleAuthMode('login');
  auth.hidden = false;
  $('#auth-form').elements.number.focus();
}
async function enterSession(account) {
  user = account;
  const epoch = ++generation;
  auth.hidden = true;
  root.hidden = false;
  tab = 'messages';
  $('#auth-form').reset();
  toggleAuthMode('login');
  $('#sync-status').textContent = '';
  renderDirectory();
  await openFromUrl();
  if (epoch === generation) await sync();
}
$('#auth-switch').addEventListener('click',()=>toggleAuthMode(authMode==='login'?'register':'login'));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (authFlight) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const body = {number:String(data.get('number')).trim(),password:data.get('password')};
  if(authMode==='register') body.displayName=String(data.get('displayName')).trim();
  authFlight = true;
  $('#auth-submit').disabled = $('#auth-switch').disabled = true;
  $('#auth-error').textContent = '';
  try { await enterSession((await api('/'+authMode,body,{session:false})).user); }
  catch (error) { $('#auth-error').textContent=textError(error); }
  finally { authFlight=false; $('#auth-submit').disabled=$('#auth-switch').disabled=false; }
});
function row(name, description, seed, action, extra = '') {
  const content = el('span');
  content.append(el('strong',name),el('small',description));
  const node = button('',action,'row');
  node.append(avatar(name,seed),content);
  if(extra) node.append(el('time',extra));
  return node;
}
function empty(message, action) {
  const block=el('div',null,'empty');
  block.append(el('p',message));
  if(action) block.append(action);
  return block;
}
function renderDirectory() {
  if(!user) return;
  const nextTitle = labels[tab];
  $('#directory-title').textContent = nextTitle;
  tabs.forEach(node=>node.setAttribute('aria-current',node.dataset.tab===tab?'page':'false'));
  const badge=$('#contact-count');
  badge.hidden=!incoming.length;
  badge.textContent=incoming.length;
  const actions=$('#directory-actions');
  actions.replaceChildren();
  if(tab==='messages') {
    actions.append(button('发起群聊',()=>showMemberPicker()),button('添加朋友',showSearch));
    const rows=conversations.map(item=>{
      const latest=item.lastMessage, summary=latest?latest.text:item.type==='group'?'群聊已建立':'开始发消息';
      const node=row(item.title,summary,item.id,()=>goChat(item.id),time(latest?.createdAt));
      node.setAttribute('aria-current',String(chat===item.id));
      return node;
    });
    directory.replaceChildren(...(rows.length?rows:[empty('暂无消息。添加朋友后就能开始聊天。')]));
  }
  if(tab==='contacts') {
    actions.append(button('添加朋友',showSearch),button('新的朋友'+(incoming.length?'（'+incoming.length+'）':''),showRequests),button('发起群聊',()=>showMemberPicker()));
    const rows=friends.map(person=>row(person.displayName,person.number,person.number,()=>perform(async()=>{
      const response=await api('/direct',{number:person.number});
      goChat(response.conversation.id);
      void sync();
    })));
    directory.replaceChildren(...(rows.length?rows:[empty('通讯录还没有好友。用用户号添加朋友。')]));
  }
  if(tab==='profile') {
    const profile=el('div',null,'profile');
    profile.append(avatar(user.displayName,user.number),el('h2',user.displayName),
      el('p','我的用户号 '+user.number),button('复制用户号',async()=>{
        try { await navigator.clipboard.writeText(user.number); $('#sync-status').textContent='已复制用户号。'; }
        catch { $('#sync-status').textContent='可以选中上方用户号手动复制。'; }
      }),button('退出登录',()=>perform(async()=>{await api('/logout',{});leaveSession();})));
    directory.replaceChildren(profile);
  }
}
function routeId() {
  if(!location.hash.startsWith('#chat/')) return undefined;
  try { return decodeURIComponent(location.hash.slice(6)) || undefined; } catch {return undefined;}
}
function goChat(id) {
  tab='messages';
  const route='#chat/'+encodeURIComponent(id);
  if(location.hash!==route) window.history.pushState(null,'',route);
  void openChat(id);
}
function goTab(next) {
  tab=next;
  if(location.hash) window.history.pushState(null,'',location.pathname+location.search);
  void openChat(undefined);
}
tabs.forEach(node=>node.addEventListener('click',()=>goTab(node.dataset.tab)));
$('#back').addEventListener('click',()=>goTab('messages'));
window.addEventListener('hashchange',()=>{if(user)void openFromUrl();});
window.addEventListener('popstate',()=>{if(user)void openFromUrl();});
async function openFromUrl() { const id=routeId(); if(id)tab='messages';await openChat(id); }
const thread = id => '/conversations/'+encodeURIComponent(id);
function showChatHeader() {
  const available=!!conversation, meta=conversation;
  $('#no-chat').hidden=!!chat;
  $('#chat-head').hidden=!available;
  historyView.hidden=!chat;
  composer.hidden=!available;
  if(!available) return;
  $('#chat-title').textContent=meta.title;
  const peer=meta.members.find(person=>person.number!==user.number);
  $('#chat-detail').textContent=meta.type==='group'?meta.members.length+' 位群成员':peer?.number||'';
  $('#chat-avatar').replaceChildren(avatar(meta.title,meta.id));
  $('#members').hidden=meta.type!=='group';
  composer.querySelector('button').disabled=sending.has(meta.id);
}
async function openChat(id) {
  if(!user) return;
  if(id===chat && (conversation||!id)) {renderDirectory();showChatHeader();return;}
  if(chat) drafts.set(chat,messageBox.value);
  const epoch=generation;
  chat=id;
  conversation=undefined;
  messages=[];
  older=false;
  historyFlight=undefined;
  root.classList.toggle('in-chat',!!id);
  messageBox.value=drafts.get(id)||'';
  $('#send-error').textContent='';
  showChatHeader();
  renderDirectory();
  historyView.replaceChildren();
  if(!id) return;
  historyView.append(empty('正在打开会话…',button('返回消息',()=>goTab('messages'))));
  try {
    const [meta, data]=await Promise.all([api(thread(id)),api(thread(id)+'/messages?limit='+pageSize)]);
    if(generation!==epoch||chat!==id) return;
    conversation=meta.conversation;
    messages=data.messages;
    older=messages.length===pageSize;
    showChatHeader();
    renderHistory('end');
  } catch(error) {
    if(generation!==epoch||chat!==id) return;
    historyView.replaceChildren(empty(textError(error),button('返回消息',()=>goTab('messages'))),
      button('重新打开',()=>void openChat(id)));
  }
}
function renderHistory(scroll) {
  const oldTop=historyView.scrollTop, oldHeight=historyView.scrollHeight;
  const nodes=[];
  if(older) nodes.push(button('加载更早消息',()=>void syncHistory(true)));
  if(!messages.length) nodes.push(empty('还没有消息。先打个招呼。'));
  for(const message of messages) {
    const mine=message.sender.number===user.number;
    const bubble=el('article',null,'bubble'+(mine?' mine':''));
    bubble.append(el('p',(mine?'我':message.sender.displayName)+'　'+time(message.createdAt),'meta'),el('p',message.text,'body'));
    nodes.push(bubble);
  }
  historyView.replaceChildren(...nodes);
  if(scroll==='end') historyView.scrollTop=historyView.scrollHeight;
  else if(scroll==='prepend') historyView.scrollTop=oldTop+historyView.scrollHeight-oldHeight;
  else historyView.scrollTop=oldTop;
}
function merge(rows, scroll) {
  const known=new Set(messages.map(row=>row.id)), fresh=rows.filter(row=>!known.has(row.id));
  if(!fresh.length&&scroll!=='prepend') return;
  messages=[...messages,...fresh].sort((a,b)=>a.id-b.id);
  renderHistory(scroll);
}
async function syncHistory(loadOlder=false) {
  if(!chat||!conversation||historyFlight||loadOlder&&!older) return;
  const id=chat, epoch=generation, lock={};
  historyFlight=lock;
  try {
    const cursor=loadOlder?'before='+messages[0].id:'after='+(messages.at(-1)?.id||0);
    const data=await api(thread(id)+'/messages?'+cursor+'&limit='+pageSize);
    if(generation!==epoch||chat!==id) return;
    if(loadOlder) older=data.messages.length===pageSize;
    const nearEnd=historyView.scrollHeight-historyView.scrollTop-historyView.clientHeight<100;
    merge(data.messages,loadOlder?'prepend':nearEnd?'end':'keep');
  } catch(error) {
    if(chat===id&&generation===epoch) {
      if(error.status===403||error.status===404) goTab('messages');
      $('#sync-status').textContent=textError(error);
    }
  } finally { if(historyFlight===lock)historyFlight=undefined; }
}
async function sync() {
  if(!user||syncFlight) return;
  const epoch=generation, lock={};
  syncFlight=lock;
  try {
    const [people,requests,threads]=await Promise.all([api('/friends'),api('/friend-requests'),api('/conversations')]);
    if(generation!==epoch) return;
    const changed=JSON.stringify([friends,incoming,outgoing,conversations])!==JSON.stringify([people.friends,requests.incoming,requests.outgoing,threads.conversations]);
    friends=people.friends;incoming=requests.incoming;outgoing=requests.outgoing;conversations=threads.conversations;
    if(changed)renderDirectory();
    if(chat&&conversation) {
      const active=conversations.find(item=>item.id===chat);
      if(active) {
        if(active.title!==conversation.title||JSON.stringify(active.members)!==JSON.stringify(conversation.members)) {
          conversation=active;showChatHeader();
        }
      }

    }
    $('#sync-status').textContent='';
    await syncHistory();
  } catch(error) {
    if(generation===epoch) $('#sync-status').textContent=textError(error);
  } finally {if(syncFlight===lock)syncFlight=undefined;}
}
setInterval(()=>{if(!document.hidden)void sync();},2500);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
window.addEventListener('online',()=>void sync());
messageBox.addEventListener('input',()=>{ if(chat)drafts.set(chat,messageBox.value); });
composer.addEventListener('submit',async event=>{
  event.preventDefault();
  const id=chat, epoch=generation, text=messageBox.value.trim();
  if(!id||!conversation||!text||sending.has(id)) return;
  let attempt=attempts.get(id);
  if(!attempt||attempt.text!==text) {
    const clientId=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    attempt={clientId,text};
    attempts.set(id,attempt);
  }
  sending.add(id);
  showChatHeader();
  $('#send-error').textContent='';
  try {
    const response=await api(thread(id)+'/messages',attempt);
    if(generation!==epoch) return;
    attempts.delete(id);
    if(drafts.get(id)?.trim()===text) drafts.delete(id);
    if(chat===id) {
      if(messageBox.value.trim()===text) messageBox.value='';
      merge([response.message],'end');
    }
    void sync();
  } catch(error) {
    if(chat===id&&generation===epoch) $('#send-error').textContent=textError(error)+' 消息仍在输入框，可再次发送。';
  } finally {
    if(generation===epoch) {sending.delete(id);if(chat===id)showChatHeader();}
  }
});
function closeDialog() {++dialogGeneration;if(dialog.open)dialog.close();$('#dialog-body').replaceChildren();}
$('#dialog-close').addEventListener('click',closeDialog);
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
function openDialog(title, nodes) {
  ++dialogGeneration;
  $('#dialog-title').textContent=title;
  $('#dialog-error').textContent='';
  $('#dialog-body').replaceChildren(...nodes);
  if(!dialog.open)dialog.showModal();
  return dialogGeneration;
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
function showSearch() {
  const form=el('form'), result=el('div'), number=field('对方的用户号','number',24);
  number.input.pattern='[A-Za-z0-9_]{4,24}';
  number.input.autocapitalize='none';
  const submit=el('button','查找','primary');submit.type='submit';
  form.append(number.node,submit);
  const scope=openDialog('添加朋友',[form,result]);
  const reset=()=>result.replaceChildren();
  number.input.addEventListener('input',reset);
  form.addEventListener('submit',event=>{
    event.preventDefault();reset();
    const target=number.input.value.trim().toLowerCase();
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
      if(person.number===user.number) box.append(el('p','这是你的账号。','minor'));
      else if(friends.some(item=>item.number===person.number)) {
        box.append(button('发消息',()=>void perform(async()=>{
          const {conversation:targetChat}=await api('/direct',{number:person.number});
          closeDialog();goChat(targetChat.id);
        },undefined,scope)));
      } else if(incoming.some(request=>request.from.number===person.number)) box.append(button('查看对方的请求',showRequests));
      else if(outgoing.some(request=>request.to.number===person.number)) box.append(el('p','已发送好友请求。','minor'));
      else {
        const add=button('发送好友请求',()=>void perform(async()=>{
          const {request}=await api('/friend-requests',{number:person.number});
          outgoing=[...outgoing,request];
          if(scope===dialogGeneration) add.replaceWith(el('p','已发送好友请求。','minor'));
          void sync();
        },add,scope),'primary');
        box.append(add);
      }
      result.replaceChildren(box);
    },submit,scope);
  });
}
function showRequests() {
  const list=el('div');
  const scope=openDialog('新的朋友',[list]);
  const paint=()=>{
    const rows=[];
    for(const request of incoming) {
      const card=el('div',null,'request'), actions=el('div',null,'actions');
      card.append(el('strong',request.from.displayName),el('p',request.from.number,'minor'),actions);
      for(const [label,action] of [['接受','accept'],['拒绝','decline']]) {
        const control=button(label,()=>void perform(async()=>{
          const response=await api('/friend-requests/'+encodeURIComponent(request.id)+'/'+action,{});
          incoming=incoming.filter(item=>item.id!==request.id);
          if(action==='accept'&&scope===dialogGeneration){closeDialog();goChat(response.conversation.id);}
          else if(scope===dialogGeneration)paint();
          renderDirectory();void sync();
        },control,scope),action==='accept'?'primary':'outline');
        actions.append(control);
      }
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
}
function showMemberPicker(group) {
  const excluded=new Set(group?.members.map(person=>person.number)||[]);
  const eligible=friends.filter(person=>!excluded.has(person.number));
  if(!eligible.length) {
    openDialog(group?'添加群成员':'发起群聊',[empty(group?'没有可以添加的好友。':'先在通讯录添加一位好友。',button('添加朋友',showSearch))]);
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
  const scope=openDialog(group?'添加群成员':'发起群聊',[form]);
  form.addEventListener('change',()=>{submit.disabled=!form.querySelector(':checked');});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const formData=new FormData(form), memberNumbers=formData.getAll('member');
    if(!memberNumbers.length)return;
    const route=group?'/groups/'+encodeURIComponent(group.id)+'/members':'/groups';
    const body=group?{memberNumbers}:{memberNumbers,title:String(formData.get('title')).trim()};
    void perform(async()=>{
      const response=await api(route,body);
      if(scope===dialogGeneration)closeDialog();
      if(chat===response.conversation.id){conversation=response.conversation;showChatHeader();}
      else goChat(response.conversation.id);
      void sync();
    },submit,scope);
  });
}
$('#members').addEventListener('click',()=>{
  const group=conversation;
  if(!group||group.type!=='group')return;
  const list=el('div');
  for(const member of group.members) {
    const card=el('div',null,'request');
    card.append(el('strong',member.displayName),el('p',member.number+(member.number===group.ownerNumber?'　群主':''),'minor'));
    list.append(card);
  }
  openDialog('群成员',[button('添加成员',()=>showMemberPicker(group),'primary'),list]);
});
try { await enterSession((await api('/me',undefined,{session:false})).user); }
catch(error) { if(error.status!==401)$('#auth-error').textContent=textError(error); }
