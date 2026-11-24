'use strict';
// Explicit friend management. Directory rows select a target, not authority.
(() => {
  const id=v=>typeof v==='string'&&/^[1-9]\d{4,14}$/.test(v)&&Number.isSafeInteger(Number(v));
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
  const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const display=v=>typeof v==='string'&&v.length<=2000;
  const remark=v=>typeof v==='string'&&v.length<=120&&[...v].length<=60&&!/[\p{Cc}\p{Cf}\u2028\u2029\ud800-\udfff]/u.test(v);
  const date=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
  const sameTarget=(r,c)=>r?.contactId===c.contactId;
  const exact=(a,b)=>record(a)&&record(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(k=>Object.hasOwn(a,k)&&a[k]===b[k]);
  const LOCAL={ownerBindingChanged:false,permissionsRevoked:false,memoriesCleared:false,configChanged:false,aiDisconnected:false};

  class ContactAdminView {
    constructor({host,createAdapter,now=Date.now}){this.host=host;this.createAdapter=createAdapter;this.now=now;this.session=null;this.epoch=0;this.timer=null;}
    tr(zh,en){return this.session?.context.language==='en'?en:zh;}
    current(s,op){return this.session===s&&s.epoch===this.epoch&&(!op||s.busy===op);}
    open(context){
      if(!id(context.accountId)||!id(context.contactId)||context.contactId===context.accountId||typeof context.scopeKey!=='string')throw Error('invalid context');
      this.dispose();this.session={context:{...context},adapter:this.createAdapter(context),epoch:++this.epoch,read:null,ticket:null,busy:null,result:null,feedback:'',value:'',composing:false,edited:false,block:false,both:false};
      this.mount();this.render();this.nodes.read.focus();
    }
    update(context){const s=this.session;if(!s)return;if(context.scopeKey!==s.context.scopeKey||context.accountId!==s.context.accountId||context.contactId!==s.context.contactId){this.dispose();return;}s.context.language=context.language;this.render();}
    dismiss(){clearTimeout(this.timer);this.timer=null;const s=this.session;if(s){s.ticket=null;try{s.adapter.discardPreview();}catch{}}}
    dispose(){const s=this.session;this.session=null;this.epoch++;clearTimeout(this.timer);this.timer=null;if(s){try{s.adapter.discardPreview();}catch{}Promise.resolve().then(()=>s.adapter.close()).catch(()=>{});}this.host.classList.remove('qq-contact-admin');}
    async back(){
      const s=this.session;if(!s||s.busy?.kind==='closing')return;this.dismiss();const op=s.busy={kind:'closing'};s.feedback=this.tr('正在结束本次管理连接…','Closing this management connection…');this.render();
      try{const r=await s.adapter.close();if(!this.current(s,op))return;if(r?.closed!==true)throw Error('close unconfirmed');this.session=null;this.epoch++;this.host.classList.remove('qq-contact-admin');s.context.onBack?.();}
      catch{if(this.current(s,op)){s.busy=null;s.feedback=this.tr('管理连接结束尚未确认，请再次返回。','Connection closure is unconfirmed. Try going back again.');this.render();}}
    }
    mount(){
      this.host.classList.add('qq-contact-admin');this.host.innerHTML=`<div class="qq-directory-heading"><div><h2 id="qq-directory-title"></h2><p id="ca-account" class="qq-directory-account"></p></div><button id="qq-directory-close" class="secondary" type="button"></button></div><button id="ca-back" class="plain ca-back" type="button"></button><div class="ca-scroll"><div class="ca-identity"><strong id="ca-name"></strong><p id="ca-identity"></p></div><div class="ca-read"><p id="ca-source"></p><button id="ca-read" class="secondary" type="button"></button></div><dl id="ca-values" class="ca-values"><div><dt id="ca-nickname-label"></dt><dd id="ca-nickname"></dd></div><div><dt id="ca-remark-label"></dt><dd id="ca-remark"></dd></div></dl><p id="ca-owner" class="ca-owner" hidden></p><p id="ca-unavailable" class="ca-unavailable"></p><section id="ca-editor" hidden><div class="ca-field-heading"><label id="ca-input-label" for="ca-input"></label><output id="ca-count" class="ca-count"></output></div><input id="ca-input" type="text" autocomplete="off"><p id="ca-hint" class="ca-hint"></p><p id="ca-validation" class="ca-validation" aria-live="polite"></p><button id="ca-preview" class="primary" type="button"></button></section><details id="ca-danger" class="ca-danger" hidden><summary id="ca-danger-title"></summary><div><p id="ca-delete-copy"></p><label class="ca-choice"><input id="ca-block" type="checkbox"><span id="ca-block-label"></span></label><label class="ca-choice"><input id="ca-both" type="checkbox"><span id="ca-both-label"></span></label><p id="ca-flags-hint" class="ca-hint"></p><button id="ca-delete-preview" type="button"></button></div></details><section id="ca-review" class="ca-review" hidden><h3 id="ca-review-title"></h3><p id="ca-target"></p><dl><dt id="ca-before-label"></dt><dd id="ca-before"></dd><dt id="ca-after-label"></dt><dd id="ca-after"></dd></dl><p id="ca-consequence"></p><div class="ca-actions"><button id="ca-confirm" type="button"></button><button id="ca-edit" class="plain" type="button"></button></div></section><div id="ca-result" class="ca-result" role="status" aria-live="polite" hidden><strong id="ca-result-title"></strong><p id="ca-result-target"></p><p id="ca-result-ack"></p><p id="ca-result-observation"></p><p id="ca-result-detail"></p></div><p id="ca-feedback" class="ca-feedback" role="status"></p><details class="ca-limits"><summary id="ca-limit-title"></summary><p id="ca-limit-copy"></p></details></div><p id="ca-footer" class="ca-footer"></p>`;
      this.nodes=Object.fromEntries([...this.host.querySelectorAll('[id^=ca-]')].map(n=>[n.id.slice(3),n]));const n=this.nodes;
      this.host.querySelector('#qq-directory-close').onclick=()=>this.session?.context.onClose();n.back.onclick=()=>void this.back();n.read.onclick=()=>void this.read();n.preview.onclick=()=>void this.preview('remark');n['delete-preview'].onclick=()=>void this.preview('delete');n.confirm.onclick=()=>void this.confirm();
      n.edit.onclick=()=>{const operation=this.session?.ticket?.operation;this.dismiss();this.render();(operation==='delete'?n.block:n.input).focus();};
      n.input.oninput=()=>this.change();n.input.addEventListener('compositionstart',()=>{const s=this.session;if(s&&!s.busy){s.composing=true;this.dismiss();this.render();}});n.input.addEventListener('compositionend',()=>{if(this.session){this.session.composing=false;this.change();}});
      for(const key of ['block','both'])n[key].onchange=()=>{const s=this.session;if(!s||s.busy)return;this.dismiss();s[key]=n[key].checked;s.result=null;s.feedback='';this.render();};
    }
    change(){const s=this.session;if(!s||s.busy)return;this.dismiss();s.value=this.nodes.input.value;s.edited=true;s.result=null;s.feedback='';this.render();}
    validProfile(r,c){
      return record(r)&&r.kind==='contact-admin'&&sameTarget(r,c)&&uuid(r.observationId)&&display(r.nickname)&&(r.remark===null||remark(r.remark))&&r.isOwner===(c.ownerId===c.contactId)&&record(r.capabilities?.remark)&&typeof r.capabilities.remark.enabled==='boolean'&&(!r.capabilities.remark.enabled||remark(r.remark))&&r.capabilities?.delete?.enabled===true&&r.limits?.remarkCodePoints===60&&r.limits.remarkUtf16===120&&r.source==='bridge-cache'&&r.cacheMayBeStale===true&&r.remarkSource==='bridge-projection'&&date(r.fetchedAt);
    }
    async read(){
      const s=this.session;if(!s||s.busy)return;this.dismiss();s.read=null;s.result=null;s.value='';s.edited=false;s.block=false;s.both=false;this.nodes.danger.open=false;const op=s.busy={kind:'read'};s.feedback=this.tr('正在读取这位好友…','Reading this friend…');this.render();
      try{const r=await s.adapter.read();if(!this.current(s,op))return;if(!this.validProfile(r,s.context))throw Error('invalid response');s.read=r;s.value=r.remark??'';s.feedback='';}
      catch(e){if(this.current(s,op))s.feedback=e.code==='contact_not_friend'?this.tr('本次好友列表中没有此人。请返回并刷新列表。','This person is not in the current friend list. Go back and refresh it.'):this.tr('本次未取得可用的好友资料，请重新读取。','No usable friend details were obtained. Read again.');}
      finally{if(this.current(s,op)){s.busy=null;this.render();}}
    }
    async preview(operation){
      const s=this.session;if(!s||s.busy||s.composing||!s.read?.capabilities[operation]?.enabled||!['remark','delete'].includes(operation))return;
      if(operation==='remark'&&(!remark(s.value)||s.value===s.read.remark))return;
      this.dismiss();const base=s.read,value=operation==='remark'?s.value:{block:s.block,deleteBoth:s.both};
      const before=operation==='remark'?{remark:base.remark}:{friend:true},after=operation==='remark'?{remark:value}:{friend:false,...value},op=s.busy={kind:'preview'};
      s.result=null;s.feedback=this.tr('正在核对操作预览…','Checking this operation preview…');this.render();
      try{
        const r=await s.adapter.preview({observationId:base.observationId,operation,value});if(!this.current(s,op))return;
        if(!record(r)||r.kind!=='contact-admin-preview'||!sameTarget(r,s.context)||!uuid(r.ticketId)||r.operation!==operation||r.isOwner!==base.isOwner||!exact(r.before,before)||!exact(r.after,after)||!exact(r.localEffects,LOCAL)||r.additionalEffectsUnverifiable!==(operation==='delete')||r.cacheMayBeStale!==true||r.automaticRetry!==false||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=this.now()||r.expiresAt>this.now()+301000)throw Error('invalid preview');
        s.ticket=r;s.feedback='';this.timer=setTimeout(()=>{if(this.current(s)&&s.ticket===r){this.dismiss();s.read=null;s.value='';s.feedback=this.tr('预览已过期，请重新读取并预览。','Preview expired. Read and review again.');this.render();}},Math.max(1,r.expiresAt-this.now()));
      }catch{if(this.current(s,op)){this.dismiss();s.read=null;s.value='';s.feedback=this.tr('预览不可用，好友或备注可能已变化。请重新读取。','Preview unavailable. The friend or remark may have changed. Read again.');}}
      finally{if(this.current(s,op)){s.busy=null;this.render();if(s.ticket)this.nodes.confirm.focus();}}
    }
    observation(o,t){
      if(!record(o)||o.source!=='bridge-cache'||o.cacheMayBeStale!==true||!date(o.fetchedAt)||!['observed_match','observed_different'].includes(o.state))return null;
      const valid=t.operation==='remark'?record(o.value)&&remark(o.value.remark):record(o.value)&&typeof o.value.friend==='boolean';
      const match=t.operation==='remark'?o.value?.remark===t.after.remark:o.value?.friend===false;
      return valid&&((o.state==='observed_match')===match)?o:null;
    }
    async confirm(){
      const s=this.session,t=s?.ticket;if(!s||s.busy||!t)return;
      if(t.expiresAt<=this.now()){this.dismiss();s.read=null;s.feedback=this.tr('预览已过期，请重新读取。','Preview expired. Read again.');this.render();return;}
      clearTimeout(this.timer);this.timer=null;s.ticket=null;s.read=null;s.value='';s.edited=false;const op=s.busy={kind:'confirm'};s.feedback=this.tr('正在提交这一次操作…','Submitting this operation once…');this.render();
      try{
        const r=await s.adapter.confirm({ticketId:t.ticketId});if(!this.current(s,op))return;
        if(!record(r)||r.kind!=='contact-admin-change'||!sameTarget(r,s.context)||r.ticketId!==t.ticketId||r.operation!==t.operation||r.isOwner!==t.isOwner||!['accepted','unknown','not_submitted','rejected'].includes(r.outcome)||!['received','unavailable'].includes(r.bridgeResponse)||!exact(r.localEffects,LOCAL)||r.additionalEffectsUnverifiable!==(t.operation==='delete')||r.automaticRetry!==false||r.automaticRestore!==false)throw Error('invalid receipt');
        if(t.operation==='delete'&&(r.outcome==='accepted'||!exact(r.deleteOptions,{block:t.after.block,deleteBoth:t.after.deleteBoth})||r.outcome==='rejected'&&(r.knownRefusal!==true||!['contact_not_friend','contact_not_found'].includes(r.code)||r.bridgeResponse!=='received')))throw Error('invalid delete receipt');
        if(t.operation==='remark'&&(r.outcome==='rejected'||r.outcome==='accepted'&&(r.acknowledgement!=='bridge-action-only'||r.bridgeResponse!=='received')))throw Error('invalid remark receipt');
        s.result={operation:t.operation,after:t.after,isOwner:t.isOwner,outcome:r.outcome,bridgeResponse:r.bridgeResponse,observation:this.observation(r.observation,t)};s.feedback='';
      }catch{if(this.current(s,op)){s.result={operation:t.operation,after:t.after,isOwner:t.isOwner,outcome:'unknown',bridgeResponse:'unavailable',observation:null};s.feedback='';}}
      finally{if(this.current(s,op)){s.busy=null;this.render();this.nodes.read.focus();}}
    }
    identity(s){return 'QQ '+s.context.accountId+' · '+this.tr('好友 QQ ','Friend QQ ')+s.context.contactId;}
    ownerWarning(){return this.tr('此人是指定主人。本操作仅请求改变 QQ 好友关系，不撤销指定主人身份或派活权限，也不清空本地记忆和配置。若要停止处理其消息，请先断开 AI 或修改绑定。','This is the configured owner. This only requests changing the QQ friend relationship; it does not revoke owner identity or task permissions, or clear local memories and settings. To stop handling their messages, disconnect AI or change the binding first.');}
    deleteDescription(after){return this.tr('请求删除这位好友','Request removal of this friend')+'\n'+(after.block?this.tr('同时请求加入黑名单','Also request blocking'):this.tr('不请求加入黑名单','Do not request blocking'))+'\n'+(after.deleteBoth?this.tr('同时请求双向删除','Also request two-way deletion'):this.tr('不请求双向删除','Do not request two-way deletion'));}
    render(){
      const s=this.session;if(!s)return;const n=this.nodes,r=s.read,p=s.ticket,out=s.result,busy=!!s.busy,editable=!!r?.capabilities.remark.enabled;
      const invalid=editable&&s.edited&&!busy&&!p&&!remark(s.value),unread=this.tr('尚未读取','Not read'),empty=this.tr('（空备注）','(Empty remark)');
      this.host.querySelector('#qq-directory-title').textContent=this.tr('好友管理','Friend management');this.host.querySelector('#qq-directory-close').textContent=this.tr('关闭','Close');n.account.textContent=this.identity(s);n.back.textContent=this.tr('返回好友列表','Back to friends');n.back.disabled=s.busy?.kind==='closing';
      n.name.textContent=r?.nickname||s.context.name||this.tr('未命名好友','Unnamed friend');n.identity.textContent=this.tr('所选好友 QQ ','Selected friend QQ ')+s.context.contactId;
      n.source.textContent=r?this.tr('来自桥接缓存；本次读取 ','From the bridge cache; read ')+new Date(r.fetchedAt).toLocaleString(s.context.language==='en'?'en':'zh-CN'):this.tr('请明确读取当前好友资料。列表内容仅用于选择对象。','Read the current friend details explicitly. The directory only selects a target.');
      n.read.textContent=r||out?this.tr('重新读取','Read again'):this.tr('读取好友资料','Read friend details');n.read.disabled=busy;
      n['nickname-label'].textContent=this.tr('昵称','Nickname');n.nickname.textContent=r?r.nickname||this.tr('未提供','Not provided'):unread;n['remark-label'].textContent=this.tr('读取到的备注','Observed remark');n.remark.textContent=r?(r.remark===null?this.tr('原值不可编辑','Original unavailable for editing'):r.remark||empty):unread;
      n.owner.hidden=!(r?.isOwner||p?.isOwner||out?.isOwner);n.owner.textContent=p?.operation==='delete'||out?.operation==='delete'?this.ownerWarning():this.tr('此人是当前搭档的指定主人。修改备注不会改变主人绑定、人设或记忆。','This person is the companion’s configured owner. A remark change does not change the owner binding, persona or memories.');
      n.unavailable.hidden=!r||editable;n.unavailable.textContent=this.tr('原备注不在当前编辑范围内，保持只读；仍可明确预览删除好友。','The original remark is outside the editor’s limits and remains read-only. Friend removal can still be explicitly reviewed.');
      n.editor.hidden=!editable||!!p;n['input-label'].textContent=this.tr('新的备注','New remark');n.count.textContent=[...s.value].length+' / 60';if(n.input.value!==s.value)n.input.value=s.value;n.input.disabled=busy||!editable;n.input.setAttribute('aria-invalid',String(invalid));
      n.hint.textContent=this.tr('最多 60 个字符，保留空格；留空表示清除备注。','Up to 60 characters; spaces are preserved. Empty clears the remark.');n.validation.textContent=invalid?this.tr('请使用 60 个字符以内的单行备注，不含控制字符。','Use a single-line remark of up to 60 characters, without control characters.'):'';n.preview.textContent=this.tr('预览备注修改','Preview remark change');n.preview.disabled=busy||s.composing||!editable||!remark(s.value)||s.value===r?.remark;
      n.danger.hidden=!r?.capabilities.delete.enabled||!!p;n['danger-title'].textContent=this.tr('删除好友…','Remove friend…');n['delete-copy'].textContent=this.tr('请求删除这位 QQ 好友。提交前会再次显示账号、联系人和所选附加选项。','Request removal of this QQ friend. The account, contact and additional choices are shown again before confirmation.');
      n.block.checked=s.block;n.both.checked=s.both;n.block.disabled=busy;n.both.disabled=busy;n['block-label'].textContent=this.tr('同时请求加入黑名单','Also request blocking');n['both-label'].textContent=this.tr('同时请求双向删除','Also request two-way deletion');n['flags-hint'].textContent=this.tr('附加选项默认关闭；本应用暂无可信的附加效果读取或撤销。','Additional choices are off by default. The app has no verified readback or undo for these effects.');n['delete-preview'].textContent=this.tr('预览删除好友','Preview friend removal');n['delete-preview'].disabled=busy;
      n.review.hidden=!p;if(p){n['review-title'].textContent=this.tr('确认这一次操作','Review this single operation');n.target.textContent=this.identity(s);n['before-label'].textContent=this.tr('本次读取','This reading');n['after-label'].textContent=this.tr('将要请求','Requested change');n.before.textContent=p.operation==='remark'?(p.before.remark||empty):this.tr('本次好友列表中有此人','This person appears in the current friend list');n.after.textContent=p.operation==='remark'?(p.after.remark||empty):this.deleteDescription(p.after);n.consequence.textContent=p.operation==='delete'?this.tr('桥接应答不等于已确认删除；随后列表观察另行显示。不会自动重发或恢复好友，附加效果也未核实。','A bridge response does not confirm removal. A later list observation is shown separately. No automatic resend or friend restoration; additional effects remain unverified.'):this.tr('备注来自桥接投影，可能使用昵称回退。提交应答与随后缓存观察分别显示，不自动重试或恢复。','The remark is a bridge projection and may fall back to the nickname. The response and subsequent cached observation are separate. No automatic retry or restore.');n.confirm.textContent=p.operation==='delete'?this.tr('确认请求删除好友','Confirm friend removal request'):this.tr('确认修改备注','Confirm remark change');n.confirm.className=p.operation==='delete'?'ca-destructive':'primary';n.edit.textContent=this.tr('返回编辑','Back to editing');}n.confirm.disabled=busy;n.edit.disabled=busy;
      n.result.hidden=!out;if(out){n['result-title'].textContent=out.outcome==='accepted'?this.tr('备注桥接动作已应答','Remark bridge action acknowledged'):out.outcome==='rejected'?this.tr('桥接返回已知拒绝信息','Bridge returned a known refusal'):out.outcome==='not_submitted'?this.tr('本次未提交','Not submitted'):this.tr('提交结果尚未确认','Submission outcome unconfirmed');n['result-target'].textContent=this.identity(s)+'\n'+(out.operation==='delete'?this.deleteDescription(out.after):this.tr('请求备注：','Requested remark: ')+(out.after.remark||empty));n['result-ack'].textContent=out.bridgeResponse==='received'?this.tr('已收到匹配的桥接应答。','A matching bridge response was received.'):this.tr('未取得可用的桥接应答。','No usable bridge response was obtained.');const o=out.observation;n['result-observation'].textContent=!o?this.tr('未取得独立后续观察；不据此判断成功或失败。','No independent subsequent observation was obtained; this does not establish success or failure.'):out.operation==='delete'?(o.value.friend?this.tr('本次好友列表仍见此人；观察可能包含缓存。','This person still appeared in this friend-list reading; it may be cached.'):this.tr('本次好友列表未见此人；不证明远端删除或附加选项已生效。','This person was absent from this friend-list reading; this does not prove remote removal or the additional effects.')):o.state==='observed_match'?this.tr('随后读取到相同备注；缓存可能尚未同步。','A later reading matched the remark; caches may not be synchronized.'):this.tr('随后读取到不同备注：','A later reading returned a different remark: ')+(o.value.remark||empty);n['result-detail'].textContent=out.outcome==='rejected'?this.tr('桥接返回已知的好友拒绝信息；未据此判定远端执行情况。请重新读取，不自动重试。','The bridge returned a known friend-refusal response; this does not establish what executed remotely. Read again. No automatic retry.'):out.outcome==='unknown'?this.tr('不会自动重发。请先重新读取，再决定是否需要新操作。','No automatic resend. Read again before deciding on a new operation.'):this.tr('不会自动重复操作或恢复原值。需要继续操作时，请重新读取。','No automatic repetition or restoration. Read again before another operation.');}
      n.feedback.textContent=s.feedback;n['limit-title'].textContent=this.tr('关于读取与关闭','About readings and closing');n['limit-copy'].textContent=this.tr('资料来自桥接缓存，读取不保证完整实时同步。选择、读取和提交均核对账号与好友；关闭仅结束本次管理连接，不能撤销已提交的远端操作。','Details come from the bridge cache; a read does not guarantee a complete live sync. The account and friend are checked at selection, read and submission. Closing ends only this management connection and cannot undo a submitted remote operation.');n.footer.textContent=this.tr('仅手动好友管理，不开启其他联系人的聊天或自动行动。','Manual friend management only; no chat or automatic actions for other contacts.');
    }
  }

  const methods=['qqContactAdminRead','qqContactAdminPreview','qqContactAdminConfirm','qqContactAdminDismiss','qqContactAdminClose'];
  window.hasQQContactAdminIPC=()=>methods.every(k=>typeof window.arcade?.[k]==='function');
  window.createQQContactAdminAdapter=context=>{
    const input={accountId:context.profileId,panelId:context.panelId,contactId:context.contactId};
    const call=async(method,extra={},field)=>{
      const r=await window.arcade[method]({...input,...extra});
      if(r?.ok!==true||r.accountId!==input.accountId||r.panelId!==input.panelId||!sameTarget(r,input)||field&&r.qqAccountId!==context.accountId){const e=Error('invalid_response');if(r?.ok===false&&r.accountId===input.accountId&&r.panelId===input.panelId&&r.contactId===input.contactId&&r.code==='contact_not_friend')e.code=r.code;throw e;}
      if(!field)return r;const value=r[field];
      if(!record(value)||['accountId','qqAccountId','panelId'].some(k=>Object.hasOwn(value,k))||!sameTarget(value,input))throw Error('invalid_response');
      return value;
    };
    return {read:()=>call('qqContactAdminRead',{},'profile'),preview:p=>call('qqContactAdminPreview',p,'preview'),confirm:p=>call('qqContactAdminConfirm',p,'change'),discardPreview:()=>{void call('qqContactAdminDismiss').catch(()=>{});},close:()=>call('qqContactAdminClose')};
  };
  window.ContactAdminView=ContactAdminView;
})();
