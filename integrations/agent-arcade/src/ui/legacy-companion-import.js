'use strict';

(() => {
  const entry=document.getElementById('legacy-companion-entry'), launch=document.getElementById('legacy-companion-import');
  if(!entry||!launch||typeof window.arcade?.storeSocial!=='function'||typeof window.arcade?.legacyCompanionPreview!=='function')return;
  document.querySelector('#bot-view .bot-heading-actions')?.prepend(entry);
  entry.hidden=false;
  const english=()=>document.documentElement.lang.startsWith('en');
  const tr=(zh,en)=>english()?en:zh;
  function make(tag,text){const node=document.createElement(tag);if(text)node.textContent=text;return node;}
  function button(label,action){const control=make('button',label);control.type='button';control.className='plain';control.onclick=action;return control;}
  const dialog=make('dialog'), heading=make('h2'), body=make('div'), status=make('p');
  dialog.id='legacy-companion-dialog';heading.id='legacy-companion-title';dialog.setAttribute('aria-labelledby',heading.id);
  status.setAttribute('role','status');
  const close=button('',()=>dialog.close());
  dialog.append(heading,body,status,close);document.body.append(dialog);
  let revision=0,applying=false;
  dialog.addEventListener('cancel',event=>{if(applying)event.preventDefault();});
  dialog.addEventListener('close',()=>{revision++;launch.focus();});

  const error=code=>({
    changed:tr('搭档或旧资料已变化，请重新选择目录。','The companion or source changed. Choose the folder again.'),
    same_source:tr('请选择另一个旧资料目录。','Choose a different previous data folder.'),
    source_busy:tr('旧聊天库还有写入记录。请先退出使用它的旧版，再选择目录。','Close the old app before choosing this folder again.'),
    busy:tr('请先暂停当前 App 聊天，再继续迁移。','Pause the current App conversation and try again.'),
    linked_source:tr('旧目录包含无法直接读取的链接。请选择实际资料目录。','Choose the actual data folder rather than a link.'),
    unsupported_history:tr('这个旧聊天库格式暂不支持。','This conversation database format is unsupported.'),
    book_copy_failed:tr('角色所选的世界书还没有复制成功。请重试或取消勾选这本书。','A selected lorebook could not be copied. Retry or deselect it.'),
  })[code]||tr('暂时无法迁移，请核对旧目录、权限或资料库容量后重试。','Check the source folder, permissions and library capacity, then retry.');

  async function openConversation(plan,item){
    try{
      const patch=item.kind==='role'?{characterId:null,builtinPersonaId:item.id}:{characterId:item.id};
      await window.arcade.stConfigure({profileId:plan.profileId,groupId:null,branchId:null,...patch});
      const opened=await window.ArcadeDesktopConversation.select('local',true,{force:true,profileId:plan.profileId});
      if(opened.ok)dialog.close();
      else if(opened.code==='changed')status.textContent=error('changed');
      else status.textContent=tr('资料已保存。请先连接 AI，再开启 App 对话。','The migration is saved. Connect AI before starting App chat.');
    }catch{status.textContent=error('busy');}
  }

  function render(plan){
    body.replaceChildren();
    body.append(make('p',tr('迁入当前搭档：','Import into: ')+plan.destination));
    body.append(make('p',tr('角色卡、独立世界书和主会话文字只复制到本机。分支、陪伴群聊、附件、记忆设置和登录凭据留在旧档。',
      'Cards, standalone lorebooks and main conversation text stay on this device. Branches, group chats, attachments, memory settings and logins stay in the old profile.')));
    body.append(make('p',tr('首次迁入角色时，会启用你勾选且旧档中该角色在用的书。其他书可在「对话设定」选用。重复迁移会保留你后来的选书。','On first import, the card keeps the books it used that you select here. Choose other books in Conversation settings. Importing again keeps your later choices.')));
    if(plan.skippedAccounts)body.append(make('p',tr('所选目录之外的搭档未列出。可单独选择其实际目录。','Companions outside this folder were skipped. Choose their own folder separately.')));
    const profileLabel=make('label',tr('旧搭档 ','Previous companion ')), profiles=make('select');
    plan.profiles.forEach((profile,index)=>{
      const label=plan.profiles.some(other=>other!==profile&&other.name===profile.name)?profile.name+' · '+profile.location:profile.name;
      const option=make('option',label);option.value=String(index);option.selected=profile.preferred;profiles.append(option);
    });
    profileLabel.append(profiles);body.append(profileLabel);
    const items=make('fieldset'), chosen=make('div');
    items.append(make('legend',tr('选择要带入的资料','Choose what to bring over')),chosen);
    body.append(items);
    const actions=make('div');actions.className='button-row';
    const apply=button(tr('确认迁入','Import selected'),async()=>{
      const selected=[...chosen.querySelectorAll('input:checked')].map(input=>input.value);
      if(!selected.length)return;
      applying=true;apply.disabled=true;profiles.disabled=true;items.disabled=true;close.disabled=true;another.disabled=true;
      status.textContent=tr('正在复制本机资料…','Copying local data…');
      try{
        const result=await window.arcade.legacyCompanionApply({token:plan.token,profile:Number(profiles.value),items:selected});
        if(!dialog.open||!body.contains(apply))return;
        if(!result.ok){status.textContent=error(result.code);return;}
        results.replaceChildren();
        for(const row of result.results){
          const message=row.status==='retry'?error(row.code):row.history==='history_exists'?tr('已有对话，原记录保留。','Existing conversation kept.'):
            row.status==='already_imported'&&row.history!=='imported'?tr('已带入。','Already imported.'):tr('已复制。','Copied.');
          const line=make('li',row.name+' · '+message);
          if(row.kind!=='book'&&row.status!=='retry'&&row.history!=='history_exists')line.append(' ',button(tr('打开对话','Open conversation'),()=>void openConversation(plan,row)));
          results.append(line);
        }
        status.textContent=tr('已核对所选资料。','Selected items checked.');
      }catch{status.textContent=error();}
      finally{applying=false;apply.disabled=false;profiles.disabled=false;items.disabled=false;close.disabled=false;another.disabled=false;}
    });
    const results=make('ul');
    const another=button(tr('另选目录…','Choose another folder…'),()=>void inspectFolder());
    actions.append(apply,another);body.append(actions,results);
    function drawItems(){
      const profile=plan.profiles[Number(profiles.value)];
      chosen.replaceChildren();results.replaceChildren();
      if(profile.historyIssue){chosen.append(make('p',error(profile.historyIssue)));apply.disabled=true;return;}
      for(const item of [...profile.items,...plan.books]){
        const label=make('label'), input=make('input'), row=make('div');
        input.type='checkbox';input.value=item.key;
        const title=item.kind==='book'?tr('世界书：','Lorebook: '):item.kind==='card'?tr('角色卡：','Card: '):tr('内置角色：','Built-in role: ');
        const count=item.messages?tr(`，主会话 ${item.messages} 条文字`,` · ${item.messages} messages`):'';
        const omitted=item.omitted?tr(`（另有 ${item.omitted} 条不复制）`,` (${item.omitted} not copied)`):'';
        const identity=item.disambiguation?' · '+item.disambiguation:'';
        const detail=item.excerpt?' · '+item.excerpt:'';
        const owner=item.kind==='book'&&profile.boundBooks.includes(item.key)&&profile.bookOwner?
          tr('（旧档中「'+profile.bookOwner+'」在用）',' (used by '+profile.bookOwner+')'):'';
        label.append(input,' '+title+(english()&&item.nameEn?item.nameEn:item.name)+detail+identity+owner+count+omitted);row.append(label);chosen.append(row);
      }
      if(!chosen.children.length)chosen.append(make('p',tr('这个目录没有可迁资料。','No supported items in this folder.')));
      apply.disabled=true;
    }
    chosen.onchange=()=>{apply.disabled=!chosen.querySelector('input:checked');};
    profiles.onchange=drawItems;drawItems();profiles.focus();
  }

  async function inspectFolder(){
    const request=++revision;
    status.textContent=tr('请选择旧版资料目录。若旧版仍在写入，请先正常退出旧版。','Choose the old data folder. Close the old app if it is still writing to it.');
    body.replaceChildren();
    try{
      const result=await window.arcade.legacyCompanionPreview();
      if(!dialog.open||request!==revision)return;
      if(result.ok){status.textContent='';render(result);}
      else if(result.code==='cancelled')dialog.close();
      else{status.textContent=error(result.code);body.append(button(tr('重新选择目录…','Choose a folder…'),()=>void inspectFolder()));}
    }catch{status.textContent=error();body.append(button(tr('重新选择目录…','Choose a folder…'),()=>void inspectFolder()));}
  }

  launch.addEventListener('click',()=>{
    heading.textContent=tr('迁移旧陪伴资料','Bring over companion data');close.textContent=tr('关闭','Close');
    if(!dialog.open)dialog.showModal();
    void inspectFolder();
  });
  const translate=()=>{launch.textContent=tr('迁移旧陪伴资料…','Bring over companion data…');};
  new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  translate();
})();
