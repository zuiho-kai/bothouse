'use strict';
// Apply only the public projection returned for the chosen account, group and card.
(() => {
  let active=null,language='zh';
  const t=(zh,en)=>language==='zh'?zh:en;
  const available=()=>['groupCardTargets','groupCardPreview','groupCardApply'].every(key=>typeof window.arcade?.[key]==='function');
  const button=(id,cls)=>{const b=el('button',cls);b.id=id;b.type='button';return b;};
  const field=(id)=>{const label=el('label'),select=el('select');select.id=id;label.htmlFor=id;return {label,select};};
  const option=(value,text)=>{const node=el('option','',text);node.value=value;return node;};
  function open(card,trigger){
    if(!available()||active||!card?.id)return;
    const dlg=el('dialog','group-card-dialog');dlg.id='group-card-dialog';dlg.setAttribute('aria-labelledby','group-card-heading');
    const heading=el('h2'),source=el('p'),profile=field('group-card-profile'),group=field('group-card-group'),current=el('p'),effect=el('p');
    heading.id='group-card-heading';source.id='group-card-source';current.id='group-card-current';effect.id='group-card-effect';
    const fields=el('div','group-card-fields');fields.append(profile.label,profile.select,group.label,group.select,current,effect);
    const review=button('group-card-review','secondary'),preview=el('section','group-card-public'),title=el('h3'),scope=el('p'),list=el('dl');
    title.id='group-card-public-title';preview.setAttribute('aria-labelledby',title.id);scope.id='group-card-public-scope';
    const publicFields=['name','description','examples'].map(key=>{
      const label=el('dt'),value=el('dd');value.id='group-card-public-'+key;list.append(label,value);return {key,label,value};
    });
    preview.append(title,scope,list);
    const status=el('p','group-card-feedback');status.id='group-card-feedback';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const apply=button('group-card-apply','primary'),reload=button('group-card-reload','secondary'),close=button('group-card-close','secondary'),actions=el('div','button-row');
    actions.append(apply,reload,close);dlg.append(heading,source,fields,review,preview,status,actions);document.body.append(dlg);
    const s={card,trigger,dlg,rows:[],profileId:'',groupId:'',phase:'loading',notice:'',preview:null,epoch:0};active=s;
    const selected=()=>s.rows.find(r=>r.profileId===s.profileId&&r.groupId===s.groupId);
    const targetKey=r=>[r.profileId,r.expectedAccountId,r.groupId].join('/');
    const binding=r=>r.profileName+' · QQ '+r.expectedAccountId+' · '+t('群 ','group ')+r.groupId;
    const busy=()=>s.phase==='saving';
    const alive=n=>active===s&&dlg.open&&s.epoch===n;
    function draw(){
      const r=selected(),locked=busy(),reviewed=s.preview;
      const texts={
        loading:t('正在读取已配置的 QQ 群…','Loading configured QQ groups…'),
        noGroups:t('还没有已配置的普通 QQ 群。请先在「工作 → 渠道」保存搭档的 QQ 号和群号。','No configured QQ groups yet. Save a companion’s QQ account and groups under Work → Channels.'),
        loadError:t('读取目标群失败。可以重新读取。','Could not load target groups. Try loading them again.'),
        reading:t('正在读取这张卡的公开字段…','Reading the public fields of this card…'),
        reviewError:t('未取得可保存的预览。请重新查看公开字段；若档案或群已更改，请重新读取群列表。','Could not get a current preview. Review the public fields again, or reload the groups if the account changed.'),
        saving:t('正在为选定的群保存角色卡…','Saving the card for the selected group…'),
        changed:t('选择或配置已改变。请重新读取群列表，核对后再保存。','The selection or configuration changed. Reload the groups and review before saving.'),
        failed:t('未确认保存。请重新读取群列表，核对当前人设后再试。','Save was not confirmed. Reload the groups and check the current role before retrying.'),
        save_failed:t('保存失败。请重新查看公开字段后再试。','The role could not be saved. Review the public fields again to retry.'),
        apply_failed:t('角色卡已保存，但尚未在此群生效。请重新查看公开字段并确认，再次尝试应用。','The card was saved but is not active in this group. Review the fields and confirm again to retry.'),
        connected:t('已保存并在线生效；本群下一条消息将使用此角色卡。','Saved and active. This group’s next message will use this card.'),
        offline:t('已保存。下次连接 QQ 时使用此卡。','Saved. QQ will use this card on its next connection.')
      };
      heading.textContent=t('用于 QQ 群','Use in QQ group');
      source.textContent=t('准备使用的角色卡：','Character card to use: ')+(card.name||card.id);
      profile.label.textContent=t('搭档档案与 QQ 号','Companion profile and QQ account');
      group.label.textContent=t('目标群','Target group');
      const profiles=new Map(s.rows.map(x=>[x.profileId,x]));
      profile.select.replaceChildren(option('',t('选择搭档档案','Choose a companion profile')),...[...profiles.values()].map(x=>option(x.profileId,x.profileName+' · QQ '+x.expectedAccountId)));
      profile.select.value=s.profileId;
      group.select.replaceChildren(option('',t('选择群号','Choose a group')),...s.rows.filter(x=>x.profileId===s.profileId).map(x=>option(x.groupId,x.groupId)));
      group.select.value=s.groupId;fields.hidden=!s.rows.length;
      profile.select.disabled=locked;group.select.disabled=locked||!s.profileId;
      current.hidden=!r;effect.hidden=!r||s.phase==='done';
      current.textContent=r?t('当前群人设：','Current group role: ')+(r.currentRoleStatus==='review_required'?t('原角色卡待复核，群回复已暂停','Previous card needs review. Group replies are paused.'):r.currentRoleName||t('默认搭档人设','Default companion role')):'';
      if(r)effect.textContent=r.status==='connected'
        ?t('QQ 在线。确认后在当前连接中切换此群人设。','QQ is online. Confirm to switch this group’s role on the current connection.')
        :r.status==='disconnected'?t('QQ 当前未连接。保存后将在下次连接时使用。','QQ is offline. The role will be used on the next connection.')
        :t('QQ 连接状态正在变化。请稍后重新读取。','The QQ connection is changing. Reload in a moment.');
      const stable=r&&['connected','disconnected'].includes(r.status);
      review.textContent=t('查看可公开字段','Review public fields');
      review.hidden=!r||s.phase==='done';review.disabled=!stable||locked||s.phase==='reading'||s.notice==='changed'||s.notice==='failed';
      preview.hidden=!reviewed;
      title.textContent=t('将交给本群 AI 的字段','Fields shared with this group’s AI');
      scope.textContent=r&&reviewed?binding(r):'';
      const labels=[t('名称','Name'),t('描述','Description'),t('对白范例','Example dialogue')];
      publicFields.forEach(({key,label,value},i)=>{label.textContent=labels[i];value.textContent=reviewed?(reviewed[key]||t('（空）','(Empty)')):'';});
      apply.textContent=t('确认用于此群','Confirm for this group');
      apply.hidden=!reviewed||s.phase==='done';apply.disabled=locked||!reviewed||!stable;
      reload.textContent=t('重新读取群列表','Reload groups');reload.hidden=locked||!['loadError','noGroups','reviewError','changed','failed','apply_failed'].includes(s.notice)&&!(r&&!stable);
      close.textContent=t('关闭','Close');close.disabled=locked;
      status.textContent=(s.phase==='done'&&r?binding(r)+' · ':'')+(texts[s.notice]||'');status.hidden=!status.textContent;
    }
    s.draw=draw;
    s.syncTarget=data=>{
      const row=selected();if(!row||busy()||s.phase==='done')return;
      const account=data.accounts?.accounts?.find(x=>x.id===row.profileId);
      if(!account)return;
      const currentQQ=data.accounts.selectedId===row.profileId?data.bot?.qq?.expectedAccountId:account.expectedQQAccountId;
      if(currentQQ&&currentQQ!==row.expectedAccountId){
        if(s.notice!=='changed'){reset();s.notice='changed';draw();}return;
      }
      if(account.status&&row.status!==account.status){row.status=account.status;draw();}
    };
    function reset(){s.epoch++;s.preview=null;s.notice='';s.phase='ready';}
    function chooseGroup(){const rows=s.rows.filter(x=>x.profileId===s.profileId);s.groupId=rows.length===1?rows[0].groupId:'';}
    profile.select.onchange=()=>{if(busy())return;reset();s.profileId=profile.select.value;chooseGroup();draw();};
    group.select.onchange=()=>{if(busy())return;reset();s.groupId=group.select.value;draw();};
    async function load(){
      const prior=selected(),profileId=s.profileId;reset();const n=s.epoch;s.rows=[];s.profileId=s.groupId='';s.phase='loading';s.notice='loading';draw();
      try{
        const {targets}=await window.arcade.groupCardTargets({cardId:card.id});if(!alive(n))return;
        if(!Array.isArray(targets))throw Error('No groups response');
        s.rows=targets;s.phase='ready';s.notice=s.rows.length?'':'noGroups';
        const keep=prior&&s.rows.find(row=>targetKey(row)===targetKey(prior));
        const preferred=profileId||card.profileId;
        s.profileId=keep?.profileId||(s.rows.some(x=>x.profileId===preferred)?preferred:new Set(s.rows.map(x=>x.profileId)).size===1?s.rows[0].profileId:'');
        chooseGroup();if(keep)s.groupId=keep.groupId;
      }catch{if(!alive(n))return;s.phase='ready';s.notice='loadError';}
      draw();
    }
    review.onclick=async()=>{
      const r=selected();if(!r||review.disabled)return;reset();const n=s.epoch;
      const request={profileId:r.profileId,expectedAccountId:r.expectedAccountId,groupId:r.groupId,cardId:card.id};
      s.phase='reading';s.notice='reading';draw();
      try{
        const result=await window.arcade.groupCardPreview(request);if(!alive(n))return;
        if(!result?.approval||!result.reviewToken||!['name','description','examples','approval','reviewToken'].every(key=>typeof result[key]==='string')||targetKey(result)!==targetKey(r)||result.cardId!==card.id)throw Error('Changed review');
        Object.assign(r,{status:result.status,currentRoleName:result.currentRoleName,currentCardId:result.currentCardId,currentRoleStatus:result.currentRoleStatus});
        s.preview=result;s.phase='ready';s.notice='';
      }catch{if(!alive(n))return;s.phase='ready';s.notice='reviewError';}
      draw();if(s.preview)apply.focus({preventScroll:true});
    };
    apply.onclick=async()=>{
      const r=selected(),v=s.preview;if(!r||!v||apply.disabled)return;
      const n=++s.epoch;s.phase='saving';s.notice='saving';draw();
      const request={profileId:r.profileId,expectedAccountId:r.expectedAccountId,groupId:r.groupId,cardId:card.id,approval:v.approval,reviewToken:v.reviewToken};
      try{
        const result=await window.arcade.groupCardApply(request);if(!alive(n))return;
        s.preview=null;
        if(result?.saved===true&&['connected','offline'].includes(result.state)){
          r.currentRoleName=v.name;r.currentRoleStatus='card';r.currentCardId=card.id;r.status=result.state==='connected'?'connected':'disconnected';
          s.phase='done';s.notice=result.state;
        }else{
          s.phase='ready';s.notice=['changed','save_failed','apply_failed'].includes(result?.state)?result.state:'failed';
        }
      }catch{if(!alive(n))return;s.preview=null;s.phase='ready';s.notice='failed';}
      draw();(s.phase==='done'?close:!reload.hidden?reload:review).focus({preventScroll:true});
    };
    reload.onclick=()=>void load();close.onclick=()=>dlg.close();
    dlg.addEventListener('cancel',e=>{if(busy())e.preventDefault();});
    dlg.addEventListener('close',()=>{if(active===s)active=null;dlg.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});});
    dlg.showModal();void load();
  }
  function update(data){
    const next=data?.config?.language==='zh'?'zh':'en',s=active;
    if(s?.card.fromChat&&s.phase!=='saving'&&s.phase!=='done'){
      const local=data?.bot?.local;
      if(data.accounts?.selectedId!==s.card.profileId||data.desktopChat?.kind!=='local'||local?.libraryGroupId||local?.libraryCharacterId!==s.card.id){s.dlg.close();return;}
    }
    s?.syncTarget(data);
    if(next!==language){language=next;s?.draw();}
  }
  window.ArcadeGroupCard=Object.freeze({available,open,update});
})();
