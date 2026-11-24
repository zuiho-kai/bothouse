'use strict';
// Official bot credentials and group OpenIDs are independent of OneBot settings.
(() => {
  let latest,scope='',epoch=0,dirty=false,pending=null,feedback='';
  const ids=['bot-qqofficial-app','bot-qqofficial-secret','bot-qqofficial-groups','bot-qqofficial-enabled'];
  const form=document.createElement('div');form.id='bot-qqofficial-options';form.hidden=true;
  form.innerHTML=`<p data-qqofficial="intro"></p>
    <label for="bot-qqofficial-app">App ID</label><input id="bot-qqofficial-app" type="text" inputmode="numeric" maxlength="32" autocomplete="off" spellcheck="false">
    <label for="bot-qqofficial-secret">App Secret</label><input id="bot-qqofficial-secret" type="password" maxlength="512" autocomplete="off" spellcheck="false"><small id="bot-qqofficial-secret-state"></small>
    <label for="bot-qqofficial-groups" data-qqofficial="groups"></label><textarea id="bot-qqofficial-groups" rows="3" maxlength="1400" autocomplete="off" spellcheck="false" aria-describedby="bot-qqofficial-id-note bot-qqofficial-feedback"></textarea>
    <small id="bot-qqofficial-id-note" data-qqofficial="ids"></small>
    <label class="qq-group-toggle"><input id="bot-qqofficial-enabled" type="checkbox"><span data-qqofficial="enable"></span></label>
    <p data-qqofficial="permissions"></p><p data-qqofficial="limits"></p>
    <button id="bot-qqofficial-save" class="secondary" data-qqofficial="save"></button>
    <p id="bot-qqofficial-feedback" role="status" aria-live="polite"></p><p id="bot-qqofficial-runtime" class="bot-fine" role="status"></p>`;
  $('bot-qq-options').after(form);
  const copy={zh:{intro:'QQ 官方机器人身份，可在 Mac 上直接连接。先在 QQ 开放平台创建机器人并取得凭据，再选择允许接收的测试群。',groups:'测试群 group_openid（每行一个，最多 5 个）',ids:'填写此机器人应用下的 group_openid，不是数字群号或群名。可从该应用收到的群事件中获取；不会自动信任陌生群。',enable:'在这些群启用陪伴回复',permissions:'在 QQ 侧开启“接收所有消息”后，才能收到未 @ 的群消息。沿用搭档的接话判断；保存配置不会连接或发送消息。',limits:'当前接入支持文字、成员独立记忆和接话判断；群媒体、工具与无事件主动发送仍待接入。群内不支持逐字流式输出；单条消息的被动回复受 5 分钟、5 次限制。',save:'保存官方机器人设置',saved:'设置已保存，尚未连接；真实群聊仍待验收。',invalid:'请填写有效 App ID、最多 5 个不重复的 group_openid；启用回复时至少选择一个群。',secretInvalid:'请填写与当前 App ID 对应的 App Secret；更换应用时不能沿用旧 Secret。Secret 最多 512 个字符，不能有空白或控制字符。',secret:'App Secret 已加密保存，留空保留；更换 App ID 时需填写对应 Secret。',empty:'不会显示已保存的 Secret；它与 AI 的 API key 分开保存。',locked:'请先断开连接，再修改设置。',saving:'正在保存…',failed:'设置没有保存。请检查 App ID、Secret 和群 ID 后重试；刚才输入的 Secret 已清除，需要重新填写。'},en:{intro:'Connect an official QQ bot directly from this Mac. Create a bot in the QQ developer portal, obtain its credentials, and select the test groups it may receive.',groups:'Test group_openid values (one per line, up to 5)',ids:'Use group_openid values from events for this bot application, not numeric QQ group numbers or names. Unknown groups are never trusted automatically.',enable:'Enable companion replies in these groups',permissions:'QQ must enable “receive all messages” to deliver messages without an @mention. The companion decides when to reply. Saving does not connect or send messages.',limits:'This connection currently supports text, member-specific memory and reply decisions. Group media, tools and sends without an incoming event remain pending. Group replies are not streamed; passive replies have a five-minute window and a maximum of five per incoming message.',save:'Save official bot settings',saved:'Settings saved; not connected. Live group acceptance remains pending.',invalid:'Enter a valid App ID and up to five distinct group_openid values. Enabling replies requires at least one group.',secretInvalid:'Enter the App Secret for this App ID; a different application cannot keep the old Secret. Use at most 512 characters, without whitespace or control characters.',secret:'App Secret saved with OS encryption; leave blank to keep it. A different App ID needs its own Secret.',empty:'Saved Secrets are never displayed. This is separate from your AI API key.',locked:'Disconnect before changing settings.',saving:'Saving…',failed:'Settings were not saved. Check the App ID, Secret and group IDs, then retry. The entered Secret was cleared; enter it again if needed.'}};
  const currentScope=n=>JSON.stringify([n?.accounts?.selectedId,n?.bot?.mode,n?.bot?.channel,n?.bot?.qqOfficial?.appId]);
  const ownerScope=n=>JSON.stringify([n?.accounts?.selectedId,n?.bot?.mode,n?.bot?.channel]);
  const words=()=>copy[latest?.config?.language==='zh'?'zh':'en'];
  const clearSecret=()=>{$('bot-qqofficial-secret').value='';};
  for(const id of ['bot-mode','bot-channel'])$(id).addEventListener('change',clearSecret);
  $('bot-setup-panel').addEventListener('toggle',()=>{if(!$('bot-setup-panel').open)clearSecret();});
  new MutationObserver(()=>{if(document.body.dataset.view!=='bot')clearSecret();}).observe(document.body,{attributes:true,attributeFilter:['data-view']});
  window.addEventListener('pagehide',clearSecret);
  for(const id of ids)$(id).addEventListener('input',()=>{dirty=true;feedback='';$('bot-qqofficial-groups').removeAttribute('aria-invalid');});
  window.renderQQOfficial=next=>{
    latest=next;const bot=next.bot||{},official=bot.qqOfficial||{},groups=official.groups||{},changed=scope!==currentScope(next),w=words();
    form.hidden=bot.channel!=='qqofficial';
    if(changed){const ownUpdate=pending&&pending.epoch===epoch&&pending.owner===ownerScope(next)&&pending.appId===official.appId;scope=currentScope(next);epoch++;if(ownUpdate)pending.epoch=epoch;else pending=null;dirty=false;feedback='';clearSecret();}
    if(document.body.dataset.view!=='bot'||!$('bot-setup-panel').open)clearSecret();
    if(!dirty){$('bot-qqofficial-app').value=official.appId||'';$('bot-qqofficial-groups').value=(groups.groupIds||[]).join('\n');$('bot-qqofficial-enabled').checked=groups.enabled===true;}
    form.querySelectorAll('[data-qqofficial]').forEach(n=>n.textContent=w[n.dataset.qqofficial]);
    const locked=bot.status!=='disconnected';
    for(const id of [...ids,'bot-qqofficial-save'])$(id).disabled=locked||!!pending;
    $('bot-qqofficial-secret-state').textContent=official.hasSecret?w.secret:w.empty;
    $('bot-qqofficial-feedback').textContent=locked?w.locked:pending?w.saving:feedback?w[feedback]||feedback:'';
    $('bot-qqofficial-runtime').textContent=groups.problem|| (groups.active?(next.config.language==='zh'?`群接入运行中 · 已接收 ${groups.incoming||0} · 已发送 ${groups.sent||0}。计数不代表真人验收。`:`Group connection active · received ${groups.incoming||0} · sent ${groups.sent||0}. Counts are not live acceptance.`):'');
    if(bot.channel!=='qqofficial'||next.desktopChat?.kind==='local')return;
    $('bot-start-note').textContent=next.config.language==='zh'?'连接后仅处理选定群的新事件。群成员不能批准本机工具或读取主人私聊。':'Connect to handle new events in the selected groups. Members cannot approve local tools or read owner private chats.';
    document.querySelector('[data-bot="messageEntry"]').textContent=next.config.language==='zh'?'在已选 QQ 群与官方机器人聊天。接收所有消息需在 QQ 侧开启。':'Chat with the official bot in the selected QQ groups. Receive-all permission must be enabled in QQ.';
    $('bot-privacy').textContent=next.config.language==='zh'?'收到的群消息会交给所选 AI 服务；记忆按应用、群、成员及角色分别保存在本机。App Secret 和模型密钥使用系统加密。':'Received group messages go to your selected AI service. Local memories are separated by application, group, member and persona. App Secret and model keys use OS encryption.';
    document.querySelector('[data-bot="help"]').textContent=next.config.language==='zh'?'群内直接聊天。管理员配置、私人记忆与工具批准保留在主人控制台。':'Chat in the group. Administration, private memories and tool approvals stay with the owner console.';
    document.querySelector('[data-bot="risk"]').textContent=next.config.language==='zh'?'当前群聊不执行本机文件或命令；断开不会撤回已经发送的消息。':'Group chat does not execute local file or command tools. Disconnecting does not recall sent messages.';
    $('bot-start').disabled=locked||!!pending||!window.ArcadeQQStartConnect?.officialReady(bot);
  };
  $('bot-qqofficial-save').onclick=()=>action(async()=>{
    if(pending||latest?.bot?.status!=='disconnected')return;
    const appId=$('bot-qqofficial-app').value.trim(),groupIds=$('bot-qqofficial-groups').value.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean),enabled=$('bot-qqofficial-enabled').checked,secret=$('bot-qqofficial-secret').value;
    let invalid='';
    if(!/^[0-9]{5,32}$/.test(appId))invalid='bot-qqofficial-app';
    else if(groupIds.length>5||new Set(groupIds).size!==groupIds.length||groupIds.some(id=>id.length>256||!/^[\x21-\x7e]+$/.test(id)||id==='.'||id==='..')||enabled&&!groupIds.length)invalid='bot-qqofficial-groups';
    else if(secret&&(secret.length>512||/[\s\p{Cc}\p{Cf}]/u.test(secret))||!secret&&(!latest.bot.qqOfficial?.hasSecret||appId!==latest.bot.qqOfficial?.appId))invalid='bot-qqofficial-secret';
    if(invalid){feedback=invalid==='bot-qqofficial-secret'?'secretInvalid':'invalid';for(const id of ids)$(id).removeAttribute('aria-invalid');$(invalid).setAttribute('aria-invalid','true');window.renderQQOfficial(latest);$(invalid).focus();return;}
    for(const id of ids)$(id).removeAttribute('aria-invalid');
    const request={epoch,owner:ownerScope(latest),appId},patch={profileId:latest.accounts.selectedId,expectedMode:latest.bot.mode,expectedChannel:'qqofficial',qqOfficialAppId:appId,qqOfficialGroups:{enabled,groupIds,proactive:false}};
    if(secret)patch.qqOfficialSecret=secret;clearSecret();pending=request;feedback='';window.renderQQOfficial(latest);
    try{await window.arcade.botConfigure(patch);if(pending===request&&request.epoch===epoch&&request.owner===ownerScope(latest)){dirty=false;feedback='saved';}}
    catch{if(pending===request&&request.epoch===epoch&&request.owner===ownerScope(latest))feedback='failed';}
    finally{if(pending===request){pending=null;window.renderQQOfficial(latest);}}
  });
})();
