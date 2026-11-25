'use strict';

window.createQQGroupDrawingSettings=()=>{
  const element=document.createElement('section');
  element.id='qq-group-image-workflows';
  element.innerHTML=`<details id="qq-daily-drawing" class="qq-group-media"><summary></summary>
    <label for="qq-drawing-provider"></label><select id="qq-drawing-provider">
      <option value="cloudflare">Cloudflare Workers AI</option><option value="openai">OpenAI Images API</option>
    </select>
    <p id="qq-drawing-service"></p><button type="button" class="secondary" id="qq-drawing-credentials"></button>
    <p class="drawing-cost"></p><p id="qq-drawing-legacy"></p>
    <label id="qq-drawing-reference-row" class="qq-group-toggle" hidden><input id="qq-drawing-reference" type="checkbox"><span></span></label>
    <label for="qq-drawing-limit"></label> <select id="qq-drawing-limit"></select>
    <p class="drawing-usage"></p><div class="qq-actions"><button id="qq-drawing-apply" type="button" class="secondary"></button>
    <button id="qq-drawing-disable" type="button" class="plain"></button></div>
    <p id="qq-drawing-feedback" role="status"></p></details>
  <section class="qq-group-media">
    <button id="qq-group-drawing-share" type="button" class="secondary"></button>
    <p id="qq-group-drawing-share-status" role="status"></p>
  </section>`;
  const find=s=>element.querySelector(s),limit=find('#qq-drawing-limit'),apply=find('#qq-drawing-apply'),disable=find('#qq-drawing-disable');
  const feedback=find('#qq-drawing-feedback'),usage=find('.drawing-usage'),drawing=find('#qq-daily-drawing');
  const method=find('#qq-drawing-provider'),credentials=find('#qq-drawing-credentials');
  const ref=find('#qq-drawing-reference'),refRow=find('#qq-drawing-reference-row'),legacy=find('#qq-drawing-legacy');
  const share=find('#qq-group-drawing-share'),shareStatus=find('#qq-group-drawing-share-status');
  let target,identity,policy,reading,busy=false,language='zh',activity,scope=0,context;
  const tr=(zh,en)=>language==='zh'?zh:en;
  const enabled=()=>policy?.enabled===true&&policy.provider!=='local-comfy';
  const matches=value=>value?.accountId===target.expectedAccountId&&value.groupId===target.groupId&&
    value.roleId===target.roleId&&!!value.revision;
  for(let i=1;i<=10;i++)limit.add(new Option(String(i),String(i)));
  function display(){
    share.textContent=tr('选择已画好的图片','Choose an existing image');
    share.disabled=!context?.canShare;
    share.title=share.disabled?tr('当前群的发送连接未就绪。','The connection for sending to this group is not ready.'):'';
    const on=enabled(),cloudflare=method.value==='cloudflare',same=on&&method.value===policy.provider;
    const selected=policy?.providers?.find(item=>item.id===method.value);
    const ready=selected?.ready===true,model=selected?.defaultModel;
    drawing.querySelector('summary').textContent=tr('群友画图 · ','Group drawing · ')+
      (policy?(on?tr('已开启云生图','Cloud drawing on'):tr('未开启','Off')):tr('云生图设置','Cloud drawing settings'));
    find('label[for="qq-drawing-provider"]').textContent=tr('本群绘图服务','Image service for this group');
    const activeService=policy?.provider==='cloudflare'?'Cloudflare Workers AI':'OpenAI Images API';
    find('#qq-drawing-service').textContent=[on&&!same?tr(`当前仍在使用 ${activeService}。`, `Currently using ${activeService}.`):'',
      model==='@cf/black-forest-labs/flux-2-klein-4b'?'FLUX.2 Klein 4B':model,
      ready?tr('凭据已保存','Credentials saved'):tr('尚未保存此服务的凭据','No credentials saved for this service')].filter(Boolean).join(' · ');
    credentials.textContent=ready?tr('管理云生图','Manage cloud drawing'):tr('连接云生图','Connect cloud drawing');
    credentials.disabled=!policy||busy||!selected||typeof window.ArcadeCharacterSticker?.openGroupCredentials!=='function';
    find('.drawing-cost').textContent=cloudflare?
      tr('允许后，群友可 @ 角色请它画图。Cloudflare 免费档有每日额度，用完停止；付费档按 Cloudflare 规则计费。',
         'Members can @ the character to draw. Cloudflare Free stops at its daily allowance. Paid plans follow Cloudflare billing.'):
      tr('允许后，群友可 @ 角色请它画图。新图按所连接服务的 API 用量计费。',
         'Members can @ the character to draw. New images may incur API charges from the connected service.');
    legacy.hidden=!policy?.localRetired&&!policy?.canResend;
    const resendTip=tr('用 QQ 的 @ 点名画图的搭档，例如「@画图的搭档 再发一次稳住」。本群只有一位搭档能按这个名字发图时，可以省略 @。重发不调用云生图。',
      'In one QQ message, @mention the companion that drew the image and write “再发一次稳住”. You can skip the mention if only one companion can resend that name in this group. Resending makes no image API request.');
    const retiredTip=tr('旧许可已停止生成。要画新图，请明确允许本群云生图。',
      'The old permission no longer allows new drawings. Allow cloud drawing for this group to continue.');
    legacy.textContent=[policy?.localRetired?retiredTip:'',policy?.canResend?resendTip:''].filter(Boolean).join(' ');
    refRow.hidden=!policy?.hasReference;
    refRow.querySelector('span').textContent=tr('新图可附上当前群卡的卡面发给所选云服务',
      'Send the current group character portrait to the selected cloud service as a reference');
    find('label[for="qq-drawing-limit"]').textContent=tr('本群每天最多请求次数','Daily request limit for this group');
    apply.textContent=same?tr('保存本群生图设置','Save group drawing settings'):
      on?tr('改用此服务并允许本群生图','Switch service and allow group drawing'):
        tr('允许本群云生图并发回本群','Allow cloud drawing and delivery to this group');
    disable.textContent=tr('关闭群内生图','Turn off group drawing');disable.hidden=!on;
    usage.textContent=policy?tr(`今天已用 ${policy.usedToday} 次。提交后失败的请求也占次数，按本地日期重置。`,
      `Used today: ${policy.usedToday}. Failed submissions count. Resets on the local date.`):'';
    const locked=!policy||busy;
    method.disabled=limit.disabled=ref.disabled=disable.disabled=locked;
    apply.disabled=locked||(!same&&!ready)||same&&Number(limit.value)===policy.dailyLimit&&ref.checked===(policy.useReference===true);
  }
  async function read(){
    if(!target||busy)return;
    const request=reading={},start=scope;
    try{
      const next=await window.arcade.botGroupDrawingSettings({...target,operation:'view'});
      if(request!==reading||start!==scope)return;
      if(!matches(next))throw Error('Changed group');
      if(next.revision!==policy?.revision){method.value=next.provider;limit.value=String(next.dailyLimit);ref.checked=next.useReference===true;}
      policy=next;display();
    }catch{if(request===reading){
      policy=null;display();
      feedback.textContent=tr('无法读取本群生图设置，请重新展开重试。','Could not read this group’s settings. Reopen to retry.');
    }}
  }
  async function save(nextEnabled){
    if(!target||!policy||busy||(nextEnabled?apply:disable).disabled)return;
    const start=scope,dailyLimit=nextEnabled?Number(limit.value):policy.dailyLimit;
    const provider=nextEnabled?method.value:policy.provider;
    const useReference=nextEnabled&&policy.hasReference===true&&ref.checked;
    busy=true;reading=null;display();
    try{
      const next=await window.arcade.botGroupDrawingSettings({...target,operation:'save',revision:policy.revision,enabled:nextEnabled,dailyLimit,provider,useReference});
      if(start!==scope)return;
      if(!matches(next)||next.enabled!==nextEnabled||next.dailyLimit!==dailyLimit||next.provider!==provider||
        (nextEnabled&&next.useReference!==useReference))throw Error('Group permission changed');
      policy=next;method.value=next.provider;limit.value=String(next.dailyLimit);ref.checked=next.useReference===true;
      feedback.textContent=nextEnabled?
        tr(`已允许本群云生图，每天最多 ${dailyLimit} 次。`, `Cloud drawing allowed for this group, up to ${dailyLimit} requests per day.`):
        tr('已关闭群内生图。已画好的图片仍保留。','Group drawing is off. Existing images are kept.');
    }catch{if(start===scope){
      policy=null;
      feedback.textContent=tr('未确认保存，请重新展开核对本群当前设置。','Could not confirm the save. Reopen to review this group’s settings.');
    }}finally{if(start===scope){busy=false;display();}}
  }
  method.onchange=()=>{ref.checked=method.value===policy?.provider&&policy.useReference===true;feedback.textContent='';display();};
  limit.onchange=ref.onchange=display;apply.onclick=()=>save(true);disable.onclick=()=>save(false);
  credentials.onclick=()=>{
    if(credentials.disabled)return;
    const start=scope,provider=method.value,binding=target,revision=policy.revision;
    const isCurrent=()=>start===scope&&method.value===provider&&policy?.revision===revision&&!!element.closest('dialog[open]');
    window.ArcadeCharacterSticker.openGroupCredentials({origin:credentials,profileId:binding.profileId,
      groupId:binding.groupId,profileName:context?.profileName||binding.expectedAccountId,provider,
      ready:policy.providers.find(row=>row.id===provider)?.ready===true,isCurrent,
      async save(fields){
        if(!isCurrent())return {ok:false,code:'changed'};
        const next=await window.arcade.botGroupDrawingSettings({...binding,operation:'configureProvider',revision,provider,...fields});
        if(!isCurrent())return {ok:false,code:'changed'};
        if(!next?.ok)return next;
        if(!matches(next)||next.revision!==revision||!next.providers?.some(row=>row.id===provider&&row.ready))return {ok:false,code:'changed'};
        reading=null;policy=next;display();
        feedback.textContent=tr('生图凭据已保存。','Image credentials saved.');
        return {ok:true};
      },
    },language);
  };
  share.onclick=()=>{
    if(share.disabled||!target)return;
    shareStatus.textContent='';
    if(window.ArcadeQQMedia?.openForGroup({...target,returnFocus:share})!==true)
      shareStatus.textContent=tr('无法打开此群的图片预览。请核对当前搭档、群和连接。','Could not open the image preview. Check the companion, group and connection.');
  };
  drawing.ontoggle=()=>{if(drawing.open){feedback.textContent='';void read();}};
  function update(next,lang,counter,groupContext){
    const id=next?JSON.stringify(next):null,changed=id!==identity,refresh=activity!==counter;
    language=lang;activity=counter;context=groupContext;
    if(changed){
      window.ArcadeCharacterSticker?.closeGroupCredentials?.(credentials);
      scope++;identity=id;target=next;policy=null;reading=null;busy=false;
      feedback.textContent=shareStatus.textContent='';
      drawing.open=false;method.value='cloudflare';limit.value='1';ref.checked=false;
    }
    element.hidden=!next;display();if(changed||refresh)void read();
  }
  return {element,update};
};
