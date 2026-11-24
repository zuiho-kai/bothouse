'use strict';
(() => {
  const words = {
    zh: {
      reportOpen:'反馈这张图',
      entry:'角色表情', close:'返回对话', create:'创作', find:'图库', actions:'表情操作',
      namedWorks:'已命名作品',galleryRefresh:'刷新',galleryMore:'加载更多',galleryCreate:'去创作',
      galleryLoading:'正在读取作品…',galleryEmpty:'这里还没有已命名的作品。创作后给图片取名并保存，就能在这里找到。',
      galleryError:'暂时无法读取图库，请重试。',galleryRetry:'重试',
      prompt:'想让角色做什么表情？', example:'例如：双手捧脸，笑着说“太好了”', model:'图像模型',
      fee:'生成时会把角色名和你的描述发给所选图像服务。',
      appearance:'本次表情的外观（选填）', appearanceHint:'例如：银色短发、戴圆眼镜。留空则本次不用。',
      remember:'为这张卡记住', forget:'移除已记外观', remembered:'已为当前搭档的这张卡记住外观。', forgotten:'已移除这张卡的已记外观。',
      cardFee:'生成预览会发送角色名、本次填写的外观和表情描述。',
      appearance_changed:'已记外观已变化，请重新打开角色表情后再试。', invalid_appearance:'外观最多 300 个字符，请去掉控制字符。',
      appearanceUnavailable:'暂时无法读取已记外观。可重新打开重试，也可直接生成不带外观的表情。',
      referenceLabel:'卡面参考',useCard:'有卡面时作为参考',textOnly:'只用文字',
      referenceReady:'生成预览会随描述发送这张角色卡的一张卡面图。',
      referenceMissing:'没有可用的卡面图，本次只发送文字。',
      referenceText:'本卡已设为只用文字。',
      referenceFailed:'暂时无法核对卡面设置，本次只发送文字。',
      referenceLoading:'正在检查卡面…',
      image_content_rejected:'这次绘图请求未通过图像服务的内容安全检查。请按服务的内容规则调整请求。',
      image_reference_rejected:'图像服务未接受这张卡面参考图。请检查卡面图，或切换「只用文字」后再试。',
      referenceFee:'生成时还会发送角色名、填写的外观文字和表情描述。',
      appearanceFee:'生成时会把角色名、公开外观特征和你的描述发给所选图像服务。',
      noKey:'为这位搭档连接云生图后可生成新图。已有表情可直接按名字查找。',
      connect:'连接云生图', manageImages:'管理云生图', profile:'搭档档案', imageKey:'OpenAI 图像 API 密钥',
      backToGroup:'返回群设置', qqGroup:'QQ 群', groupKeyNote:'凭据保存到这位搭档的档案。本群绘图仍需单独允许。',
      providerLabel:'图像服务', cloudflare:'Cloudflare Workers AI（推荐）', cloudflareGuide:'打开 Cloudflare Workers AI 控制台',
      cloudflarePlan:'FLUX.2 Klein 4B。免费档有每日额度，用完停止；付费档按 Cloudflare 规则计费。',
      openaiPlan:'OpenAI Images API 按用量计费。',
      repairNote:'可更新这位搭档的生图凭据，原描述会保留。',
      keyNote:'凭据保存在这位搭档的档案。只有生成新图时才调用图像服务。',
      selectProvider:'使用已保存的凭据', providerChanged:'已选用这项云生图服务。',
      providerStored:'凭据已保存。请再点「使用已保存的凭据」切换服务。',
      guideUnavailable:'无法打开控制台。可在 Cloudflare 控制台进入 Workers AI → Use REST API。',
      invalid_account_id:'请输入 32 位 Cloudflare Account ID。',
      saveKey:'保存生图密钥', cancelKey:'取消', savingKey:'正在保存生图密钥…', keySaved:'生图密钥已保存，可以生成预览。',
      invalid_key:'密钥格式有误。请粘贴完整的 API 密钥，去掉其中的空格或换行。',
      credentials_locked:'档案的凭据库已锁定。请先解锁，再回到这里保存。',
      credentials_busy:'档案正在更新凭据，请稍后重试。', already_configured:'当前档案已有生图凭据。请返回表情页查看。',
      keyStorageFailed:'暂时无法将生图密钥安全保存到当前档案，请稍后重试。',
      generate:'生成预览', again:'重新生成预览', preview:'表情预览', name:'给这张表情取个名字', save:'保存表情',
      searchName:'表情名字', lookup:'查找', saved:'已保存', generating:'正在生成预览…', reading:'正在查找…', saving:'正在保存…',
      changed:'当前角色或档案已变化，请返回对话重新打开。', busy:'另一项创作还在处理中，请稍后再试。',
      cancelled:'这次生成已取消。', duplicate_name:'这个名字已经用过。可以改名保存，或按这个名字查找已有表情。',
      not_found:'这位角色还没有这个名字的表情。', invalid_name:'名字需要 1–40 个字符，请去掉控制字符。',
      invalid_request:'请输入 1–500 个字符，并选择可用的图像模型。', credentials_missing:'当前档案没有可用的云生图凭据。',
      provider_failed:'生成未完成，请检查图像模型权限、额度或网络后再试。', storage_unavailable:'暂时无法读取或保存这位角色的表情。',
      image_auth:'图像服务未接受当前档案的凭据，请检查密钥或 Token。', image_forbidden:'当前凭据没有生成图像的权限。',
      image_model_unavailable:'所选绘图模型不可用。请在绘图设置中检查模型和访问权限。', image_rate_limited:'图像请求已达到服务限额，请检查额度或稍后重试。',
      image_quota_exceeded:'Cloudflare Workers AI 额度已用完，请等额度恢复或到控制台检查用量。',
      image_request_rejected:'图像服务未接受这次请求，未提供可确认的原因。请检查所选模型和请求设置后再试。', image_provider_failed:'图像服务暂时不可用，请稍后再试。',
      image_invalid_response:'服务没有返回可用的 PNG 图片，请重新生成。', image_too_large:'返回的图片超过大小限制，请重新生成。',
      image_cancelled:'这次生成已取消。', image_timeout:'等待图像服务超时，请稍后再试。',
      limit:'这位角色的表情存储已满。', invalid_image:'未能显示有效的图片，请重新生成或查找。', failed:'操作未完成，请再试一次。',
      lookupResult:'找到表情', title:'的表情', historyFailed:'图片已生成，尚未存入这段对话。',
      retryHistory:'重新保存到对话',historySaving:'正在保存到对话…',historySaved:'图片已保存到这段对话。'
    },
    en: {
      reportOpen:'Report this image',
      entry:'Stickers', close:'Back to chat', create:'Create', find:'Gallery', actions:'Sticker actions',
      namedWorks:'Named artwork',galleryRefresh:'Refresh',galleryMore:'Load more',galleryCreate:'Create an image',
      galleryLoading:'Loading artwork…',galleryEmpty:'No named artwork yet. Create an image, then give it a name and save it here.',
      galleryError:'The gallery could not be loaded. Please try again.',galleryRetry:'Retry',
      prompt:'What expression should the character make?', example:'For example: cheeks in hands, smiling with delight', model:'Image model',
      fee:'Generating sends the character’s name and your description to the selected image service.',
      appearance:'Appearance for this sticker (optional)', appearanceHint:'For example: short silver hair, round glasses. Leave blank to skip this time.',
      remember:'Remember for this card', forget:'Remove saved appearance', remembered:'Appearance saved for this card and companion.', forgotten:'Saved appearance removed.',
      cardFee:'Generate preview sends the character name, the appearance entered here and the expression.',
      appearance_changed:'The saved appearance changed. Reopen Stickers and try again.', invalid_appearance:'Use up to 300 characters without control characters.',
      appearanceUnavailable:'Saved appearance could not be loaded. Reopen to retry, or generate without it.',
      referenceLabel:'Card portrait reference',useCard:'Use card portrait when available',textOnly:'Use text only',
      referenceReady:'Generate preview sends one portrait from this card with your description.',
      referenceMissing:'No usable card portrait. This request sends text only.',
      referenceText:'This card is set to use text only.',
      referenceFailed:'Could not check this card’s reference settings. This request sends text only.',
      referenceLoading:'Checking the card portrait…',
      image_content_rejected:'This request did not pass the image service’s content safety check. Review the service’s content rules before changing the request.',
      image_reference_rejected:'The image service could not use this portrait reference image. Check it or choose Use text only before trying again.',
      referenceFee:'The request also sends the character name, any appearance text and the expression.',
      appearanceFee:'Generating sends the character’s name, public appearance details and your description to the selected service.',
      noKey:'Connect cloud drawing for this companion to create new images. You can still find saved stickers by name.',
      connect:'Connect cloud drawing', manageImages:'Manage cloud drawing', profile:'Companion profile', imageKey:'OpenAI Images API key',
      backToGroup:'Back to group', qqGroup:'QQ group', groupKeyNote:'Credentials are saved to this companion’s profile. Group drawing requires separate permission.',
      providerLabel:'Image service', cloudflare:'Cloudflare Workers AI (recommended)', cloudflareGuide:'Open the Cloudflare Workers AI dashboard',
      cloudflarePlan:'FLUX.2 Klein 4B. Cloudflare Free stops at the daily allowance. Paid plans follow Cloudflare billing.',
      openaiPlan:'OpenAI Images API usage is billed.',
      repairNote:'Update this companion’s image credentials here. Your description is kept.',
      keyNote:'Credentials stay in this companion’s profile. The image service is contacted when you generate a new image.',
      selectProvider:'Use saved credentials', providerChanged:'Image service selected.',
      providerStored:'Credentials saved. Choose Use saved credentials to switch to this service.',
      guideUnavailable:'Could not open the dashboard. In Cloudflare, open Workers AI → Use REST API.',
      invalid_account_id:'Enter the 32-character Cloudflare Account ID.',
      saveKey:'Save image key', cancelKey:'Cancel', savingKey:'Saving image key…', keySaved:'Image key saved. You can now generate a preview.',
      invalid_key:'Paste the complete API key without spaces or line breaks.',
      credentials_locked:'The profile’s credential store is locked. Unlock it, then return to save the key.',
      credentials_busy:'This profile is updating credentials. Try again shortly.', already_configured:'This profile already has image credentials. Return to the sticker controls.',
      keyStorageFailed:'Could not save the image key securely in this profile. Try again later.',
      generate:'Generate preview', again:'Generate a new preview', preview:'Sticker preview', name:'Name this sticker', save:'Save sticker',
      searchName:'Sticker name', lookup:'Find', saved:'Saved', generating:'Generating preview…', reading:'Finding sticker…', saving:'Saving…',
      changed:'The character or profile changed. Return to chat and reopen the studio.', busy:'Another request is in progress. Try again shortly.',
      cancelled:'Generation was cancelled.', duplicate_name:'That name is already in use. Choose a different name or find the saved sticker.',
      not_found:'This character has no sticker with that name.', invalid_name:'Use 1–40 characters without control characters.',
      invalid_request:'Enter 1–500 characters and choose an available image model.', credentials_missing:'This profile has no usable cloud drawing credentials.',
      provider_failed:'Generation did not finish. Check model access, quota or network and try again.', storage_unavailable:'This character’s stickers could not be opened or saved.',
      image_auth:'The image service did not accept the credentials for this profile. Check the key or token.', image_forbidden:'These credentials do not have permission to generate images.',
      image_model_unavailable:'The selected image model is unavailable. Check the model and your access in drawing settings.', image_rate_limited:'The image service limit was reached. Check the quota or try again later.',
      image_quota_exceeded:'Your Workers AI allowance is exhausted. Wait for it to reset or check usage in the Cloudflare dashboard.',
      image_request_rejected:'The image service rejected this request and did not provide a specific reason. Check the model and request settings before trying again.', image_provider_failed:'The image service is temporarily unavailable. Try again later.',
      image_invalid_response:'The service returned no usable PNG. Generate a new preview.', image_too_large:'The returned image is too large. Generate a new preview.',
      image_cancelled:'Generation was cancelled.', image_timeout:'The image service timed out. Try again later.',
      limit:'Sticker storage is full for this character.', invalid_image:'The image could not be displayed. Generate or look up the sticker again.',
      failed:'The operation did not finish. Try again.', lookupResult:'Found', title:' stickers',
      historyFailed:'Your picture is ready, but could not be saved to this chat.',
      retryHistory:'Retry saving to chat',historySaving:'Saving to chat…',historySaved:'Picture saved to this chat.'
    }
  };
  const byId = id => document.getElementById('character-sticker-' + id);
  const dlg = byId('studio'), image = byId('image'), entry = document.createElement('button');
  entry.type = 'button'; entry.id = 'character-sticker-entry'; entry.className = 'secondary'; entry.hidden = true;
  entry.setAttribute('aria-haspopup','dialog'); entry.setAttribute('aria-controls',dlg.id);
  document.querySelector('#bot-view .bot-heading-actions').prepend(entry);
  let current = null, editor = null, lang = 'en';
  const artWords = {
    zh:{
      title:'的绘图',actions:'绘图操作',prompt:'想画什么？',example:'例如：傍晚的书店，窗边亮着一盏灯',
      fee:'生成预览会把这段描述发给所选图像服务。',
      noKey:'为这位搭档连接云生图后可生成新图。已有作品可直接按名字查找。',
      preview:'图片预览',name:'给这张图取个名字',save:'保存图片',searchName:'作品名字',lookupResult:'找到作品',
      not_found:'当前角色的图库中没有这个名字的作品。',duplicate_name:'图库中已使用这个名字，请换个名字或查找已有作品。',
      storage_unavailable:'暂时无法读取或保存这张图。'
    },
    en:{
      title:' artwork',actions:'Artwork actions',prompt:'What would you like to draw?',example:'For example: a bookshop at dusk with a lamp in the window',
      fee:'Generate preview sends this description to the selected image service.',
      noKey:'Connect cloud drawing for this companion to create a picture. Saved artwork is available by name.',
      preview:'Image preview',name:'Name this picture',save:'Save picture',searchName:'Artwork name',lookupResult:'Found artwork',
      not_found:'There is no artwork with that name in this companion’s library.',duplicate_name:'That name is already in the library. Try another name or find the saved work.',
      storage_unavailable:'This picture could not be opened or saved.'
    }
  };
  const galleryTitles = {zh:'的图库',en:'’s gallery'};
  function tr(key) {
    if (editor?.mode==='find' && key==='title') return galleryTitles[lang];
    const artwork = editor?.kind==='illustration' || editor?.mode==='find';
    return (artwork && artWords[lang][key]) || words[lang][key] || words[lang].failed;
  }
  const binding = ({accountId, scopeId}) => ({accountId, scopeId});
  const providerInfo=id=>current?.providers?.find(provider=>provider.id===id);
  const providerName=id=>id==='cloudflare'?'Cloudflare Workers AI':'OpenAI Images API';
  const planKey=id=>id==='cloudflare'?'cloudflarePlan':'openaiPlan';
  const resetImageFields=()=>{byId('key').value='';byId('account-id').value='';};
  const length = text => [...text].length;
  const nameOf = text => text.trim().normalize('NFC');
  const validName = text => length(text) >= 1 && length(text) <= 40 && !/\p{Cc}/u.test(text);
  const validPreview = url => typeof url === 'string' && url.length <= 22 + 4 * Math.ceil(8 * 1024 * 1024 / 3) &&
    url.startsWith('data:image/png;base64,') && /^[A-Za-z0-9+/]+={0,2}$/.test(url.slice(22));
  const currentEditor = s => !!s && editor === s && dlg.open;
  const hasAppearance = s => current?.roleKind === 'card' && s.kind === 'sticker' && typeof window.arcade.characterStickerAppearance === 'function';
  const hasReference = s => current?.roleKind === 'card' && s.kind === 'sticker' && typeof window.arcade.characterStickerReference === 'function';
  async function loadReference(s, textOnly) {
    if (!hasReference(s) || s.mode !== 'create' || s.referenceLoading || (s.reference && textOnly === undefined)) return;
    s.referenceLoading = true;
    s.reference = null;
    draw();
    try {
      const result = await window.arcade.characterStickerReference({...s.binding,...(textOnly === undefined ? {} : {textOnly})});
      if (!currentEditor(s)) return;
      s.reference = result?.ok ? result : {failed:true};
    } catch {
      if (currentEditor(s)) s.reference = {failed:true};
    } finally {
      if (currentEditor(s)) {s.referenceLoading = false; draw();}
    }
  }
  async function loadAppearance(s) {
    if (!hasAppearance(s) || s.appearanceState || s.mode !== 'create') return;
    s.appearanceState = 'loading';
    draw();
    try {
      const result = await window.arcade.characterStickerAppearance(s.binding);
      if (!currentEditor(s)) return;
      if (!result?.ok || typeof result.text !== 'string') throw Error('Appearance unavailable');
      byId('appearance').value = s.savedAppearance = result.text;
      s.appearanceState = 'ready';
    } catch {
      if (!currentEditor(s)) return;
      s.appearanceState = 'failed';
      notice('appearanceUnavailable');
    }
    draw();
  }
  async function saveAppearance(clear) {
    const s = editor;
    if (!currentEditor(s) || s.pending || s.appearanceState !== 'ready' || !hasAppearance(s)) return;
    s.pending = true;
    draw();
    try {
      const result = await window.arcade.characterStickerAppearance({...s.binding, expected:s.savedAppearance,
        text:clear ? '' : byId('appearance').value});
      if (!currentEditor(s)) return;
      if (!result?.ok) throw result;
      byId('appearance').value = s.savedAppearance = result.text;
      notice(clear ? 'forgotten' : 'remembered');
    } catch (error) {
      if (currentEditor(s)) notice(Object.hasOwn(words[lang],error?.code) ? error.code : 'failed');
    } finally {
      if (currentEditor(s)) {s.pending = false; draw(); byId('appearance').focus();}
    }
  }
  function notice(key, name='') {
    const s = editor;
    if (s) {s.message = key; s.noticeName = name;}
    byId('status').textContent = key ? tr(key) + (name ? ' · ' + name : '') : '';
  }
  function drawGallery(s) {
    const section = byId('gallery'), list = byId('gallery-items');
    section.hidden = s.mode !== 'find' || !s.galleryShown || !!s.keySetup || typeof window.arcade.characterStickerList !== 'function';
    if (section.hidden) return;
    const loading = s.galleryPhase === 'loading', failed = s.galleryPhase === 'error';
    const empty = s.galleryPhase === 'ready' && !list.childElementCount;
    byId('gallery-status').textContent = loading ? tr('galleryLoading') : failed ? tr('galleryError') : empty ? tr('galleryEmpty') : '';
    byId('gallery-refresh').textContent = tr(failed ? 'galleryRetry' : 'galleryRefresh');
    byId('gallery-refresh').disabled = byId('gallery-more').disabled = loading || !!s.pending;
    byId('gallery-more').hidden = !s.galleryAfter || failed;
    byId('gallery-create').hidden = !empty;
    byId('gallery-create').disabled = !!s.pending;
    for (const button of list.querySelectorAll('button')) {
      button.disabled = !!s.pending;
      if (s.found?.name === button.dataset.name) button.setAttribute('aria-current','true');
      else button.removeAttribute('aria-current');
    }
  }
  async function loadGallery(s, after) {
    if (!currentEditor(s) || s.mode !== 'find' || typeof window.arcade.characterStickerList !== 'function') return;
    const request = ++s.galleryRequest, list = byId('gallery-items');
    const trigger = document.activeElement;
    const active = () => currentEditor(s) && s.mode === 'find' && s.galleryRequest === request;
    s.galleryPhase = 'loading'; s.galleryRetryAfter = after;
    drawGallery(s);
    try {
      const result = await window.arcade.characterStickerList({...s.binding,...(after ? {after} : {})});
      if (!active()) return;
      if (!result?.ok || !Array.isArray(result.items) || result.items.some(item => typeof item?.name !== 'string' || !validName(item.name)) ||
          !(result.nextAfter == null || typeof result.nextAfter === 'string' && result.nextAfter && result.nextAfter !== after)) throw Error('Invalid gallery page');
      const existing = new Set(after ? [...list.querySelectorAll('button')].map(b => b.dataset.name) : []);
      const page = document.createDocumentFragment();
      for (const {name} of result.items) {
        if (existing.has(name)) continue;
        existing.add(name);
        const row = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.dataset.name = name; button.textContent = name;
        row.append(button); page.append(row);
      }
      const firstNew = page.firstElementChild?.firstElementChild;
      if (after) list.append(page); else list.replaceChildren(page);
      s.galleryAfter = result.nextAfter; s.galleryPhase = 'ready';
      drawGallery(s);
      if (after && firstNew && !s.pending && [trigger,document.body,dlg].includes(document.activeElement)) firstNew.focus();
      if (s.chatAction === 'gallery') {s.onUsed?.(); s.onUsed = null;}
    } catch {
      if (active()) {s.galleryPhase = 'error'; drawGallery(s);}
    }
  }
  function drawImageKeyForm(s,provider,profileName,{selectSaved=false,canEnterCredential=true}={}){
    const cloudflare=provider==='cloudflare';
    byId('key-form').hidden=!s.keySetup;
    byId('key-form').querySelector('h3').hidden=!!s.groupSetup;
    byId('profile').textContent=profileName;
    byId('image-provider').value=provider||'cloudflare';
    byId('plan-note').textContent=tr(planKey(provider));
    byId('cloudflare-account').hidden=!cloudflare;
    byId('provider-guide').hidden=typeof window.arcade.providerGuide!=='function';
    const key=byId('key'),keyLabel=byId('key-form').querySelector('label[for="character-sticker-key"]');
    keyLabel.textContent=cloudflare?'Workers AI API Token':tr('imageKey');
    keyLabel.hidden=key.hidden=!canEnterCredential;
    byId('save-key').textContent=tr(selectSaved?'selectProvider':'saveKey');
    byId('save-key').disabled=!!s.pending||(!selectSaved&&!canEnterCredential);
    byId('image-provider').disabled=!!s.groupSetup||!!s.pending;
    byId('account-id').disabled=byId('provider-guide').disabled=key.disabled=byId('key-cancel').disabled=!!s.pending;
  }
  function draw() {
    const s = editor;
    if (!s) return;
    if(s.groupSetup){
      const group=s.groupSetup;
      dlg.querySelectorAll('[data-sticker-label]').forEach(n=>{n.textContent=tr(n.dataset.stickerLabel);});
      byId('title').textContent=tr(group.ready?'manageImages':'connect');
      byId('close').textContent=byId('close').title=tr('backToGroup');
      byId('close').disabled=s.pending;
      for(const id of ['actions','create-fields','find-fields','provider','name-fields','history','figure','gallery'])byId(id).hidden=true;
      drawImageKeyForm(s,group.provider,`${group.profileName} · ${tr('qqGroup')} ${group.groupId}`);
      byId('key-note').textContent=tr('groupKeyNote');
      byId('status').textContent=s.message?tr(s.message):'';
      dlg.setAttribute('aria-busy',String(s.pending));
      return;
    }
    const setup = s.keySetup, create = s.mode === 'create', record = setup ? null : create ? s.draft : s.found;
    byId('report').hidden = !window.ArcadeShell?.reportImage;
    byId('report-open').disabled = !!s.pending;
    const repair = !!s.repairCode && current.canGenerate;
    const provider=setup?s.setupProvider:current.provider;
    const cloudflare=provider==='cloudflare',saved=providerInfo(provider)?.ready===true;
    const selectSaved=setup&&saved&&provider!==current.provider&&!byId('key').value.trim()&&!byId('account-id').value.trim();
    const canEnterCredential=cloudflare||!saved||(repair&&current.provider==='openai');
    dlg.querySelectorAll('[data-sticker-label]').forEach(n => {
      const label = n.dataset.stickerLabel;
      n.textContent = tr(label === 'connect' && current.canGenerate ? 'manageImages' : label);
    });
    byId('title').textContent = current.roleName + tr('title');
    byId('actions').setAttribute('aria-label',tr('actions'));
    byId('prompt').placeholder = tr('example');
    byId('close').title = tr('close');
    byId('close').disabled=false;
    byId('create').setAttribute('aria-pressed',String(create)); byId('find').setAttribute('aria-pressed',String(!create));
    byId('create').disabled = byId('find').disabled = !!s.pending;
    byId('actions').hidden = setup;
    byId('create-fields').hidden = setup || !create; byId('find-fields').hidden = setup || create;
    byId('provider').hidden = setup || (current.canGenerate && !repair && !create);
    byId('provider-note').textContent = current.canGenerate&&!repair?providerName(current.provider):tr(repair?'repairNote':'noKey');
    byId('connect').hidden = typeof window.arcade.characterStickerConfigureImages !== 'function';
    byId('connect').disabled = !!s.pending;
    drawImageKeyForm(s,provider,tr('profile')+' · '+current.profileName,{selectSaved,canEnterCredential});
    const models = Array.isArray(current.models) ? current.models : [], select = byId('model');
    if (JSON.stringify(models) !== select.dataset.options) {
      const chosen = select.value;
      select.replaceChildren(...models.map(id => new Option(id==='@cf/black-forest-labs/flux-2-klein-4b'?'FLUX.2 Klein 4B':id,id)));
      select.value = models.includes(chosen) ? chosen : current.defaultModel;
      select.dataset.options = JSON.stringify(models);
    }
    const canGenerate = current.canGenerate === true && models.includes(select.value);
    const appearance = byId('appearance');
    byId('appearance-fields').hidden = !hasAppearance(s);
    appearance.placeholder = tr('appearanceHint');
    appearance.disabled = !!s.pending || s.appearanceState !== 'ready';
    byId('remember').disabled = appearance.disabled || !appearance.value.trim() || nameOf(appearance.value) === s.savedAppearance;
    byId('forget').hidden = !s.savedAppearance;
    byId('forget').disabled = appearance.disabled;
    const ref = s.reference, useReference = hasReference(s) && !!ref?.digest;
    byId('reference-fields').hidden = !hasReference(s);
    byId('reference-mode').disabled = !!s.pending || !!s.referenceLoading;
    byId('reference-mode').value = ref?.textOnly || ref?.failed ? 'text' : 'card';
    byId('reference-note').textContent = tr(s.referenceLoading ? 'referenceLoading' :
      ref?.failed ? 'referenceFailed' : ref?.textOnly ? 'referenceText' : useReference ? 'referenceReady' : 'referenceMissing');
    const fee = useReference ? 'referenceFee' : hasAppearance(s) && appearance.value.trim() ? 'cardFee' :
      s.kind !== 'illustration' && current.roleKind === 'builtin' && current.hasImageAppearance ? 'appearanceFee' : 'fee';
    byId('fee').textContent = tr(fee)+' '+tr(planKey(current.provider));
    byId('prompt').disabled = select.disabled = !!s.pending;
    const text = byId('prompt').value.trim();
    byId('generate').textContent = tr(s.draft ? 'again' : 'generate');
    byId('generate').disabled = !!s.pending || !!s.referenceLoading || s.appearanceState === 'loading' || !canGenerate || !text || length(text)>500;
    byId('search').disabled = !!s.pending;
    byId('lookup').disabled = !!s.pending || !validName(nameOf(byId('search').value));
    const showName = !setup && create && !!s.draft && !s.draft.saved;
    byId('name-fields').hidden = !showName;
    byId('name').disabled = !!s.pending || !showName;
    byId('save').disabled = !!s.pending || !showName || !validName(nameOf(byId('name').value));
    byId('figure').hidden = !record;
    byId('history').hidden = !create || !!setup || s.draft?.historySaved !== false;
    byId('history-retry').disabled = !!s.pending || typeof window.arcade.characterStickerRetryHistory !== 'function';
    if (record) {
      if (image.getAttribute('src') !== record.preview) image.src = record.preview;
      image.alt = (record.name || current.roleName) + ' · ' + tr('preview');
    } else image.removeAttribute('src');
    byId('status').textContent = s.message ? tr(s.message) + (s.noticeName ? ' · ' + s.noticeName : '') : '';
    drawGallery(s);
    dlg.setAttribute('aria-busy',String(!!s.pending));
  }
  function discard(s) {
    if (!s?.requestId) return Promise.resolve();
    const requestId = s.requestId; s.requestId = '';
    return window.arcade.characterStickerDiscard({...s.binding,requestId}).catch(()=>{});
  }
  function close(restore=true) {
    const s = editor; if (!s) return;
    editor = null; void discard(s);
    if (dlg.open) dlg.close();
    byId('gallery-items').replaceChildren(); byId('gallery').hidden = true;
    image.removeAttribute('src'); byId('figure').hidden = byId('name-fields').hidden = true;
    resetImageFields();
    for (const k of ['prompt','name','search','appearance']) byId(k).value = '';
    if(restore&&s.groupSetup){s.origin?.focus({preventScroll:true});}
    else if (restore && !entry.hidden && document.body.dataset.view === 'bot') (s.origin?.isConnected?s.origin:entry).focus({preventScroll:true});
  }
  function openGroupCredentials(group,language){
    if(editor||!group.isCurrent())return false;
    lang=language==='zh'?'zh':'en';resetImageFields();
    editor={groupSetup:group,origin:group.origin,keySetup:true,setupProvider:group.provider,pending:false};
    draw();dlg.showModal();byId(group.provider==='cloudflare'?'account-id':'key').focus();return true;
  }
  function open(request) {
    if (!current || editor) return false;
    if (request && (request.scope.scopeId!==current.scopeId || request.scope.accountId!==current.accountId)) return false;
    const intent=request?.intent;
    const mode=intent ? (['lookup','gallery'].includes(intent.kind)?'find':'create') : (current.canGenerate?'create':'find');
    editor = {
      binding:binding(current),mode,kind:intent?.kind==='illustration'?'illustration':'sticker',
      origin:request?.origin,onUsed:request?.onUsed,chatAction:request && (mode==='create'?'generate':intent?.kind),
      chatText:request && mode==='create'?request.text:null,
      keySetup:false,setupProvider:'',repairCode:'',message:'',noticeName:'',requestId:'',draft:null,found:null,pending:false,
      galleryShown:!(intent?.kind==='lookup' && intent.name),galleryRequest:0,galleryPhase:'idle',galleryAfter:null,galleryRetryAfter:null
    };
    if (request && mode==='create') byId('prompt').value=request.text;
    if (intent?.kind==='lookup') byId('search').value=intent.name||'';
    delete byId('model').dataset.options;
    draw(); dlg.showModal();
    void loadAppearance(editor);
    void loadReference(editor);
    (mode==='create' ? byId('prompt') : byId('search')).focus();
    if (mode==='find' && editor.galleryShown) void loadGallery(editor);
    if (intent?.kind==='lookup' && intent.name) void act('lookup');
    return true;
  }
  async function checkImage(result) {
    if (!validPreview(result.preview)) throw {code:'invalid_image'};
    const check = new Image(); check.src = result.preview;
    try {await check.decode();} catch {throw {code:'invalid_image'};}
  }
  async function act(action, fromGallery=false) {
    const s = editor;
    if (!currentEditor(s) || s.groupSetup || s.pending || byId(action).disabled) return;
    s.pending = true;
    notice(({generate:'generating',save:'saving',lookup:'reading','history-retry':'historySaving'})[action]);
    if (action === 'lookup') s.found = null;
    draw();
    let focus = null;
    try {
      if (action === 'generate') {
        const prompt = byId('prompt').value.trim(), model = byId('model').value;
        s.repairCode = ''; s.draft = null; byId('name').value = ''; draw();
        await discard(s); if (!currentEditor(s)) return;
        const requestId = s.requestId = crypto.randomUUID();
        const result = await window.arcade.characterStickerGenerate({...s.binding,requestId,prompt,model,...(current.provider?{provider:current.provider}:{}),
          ...(hasReference(s) && s.reference?.digest ? {referenceDigest:s.reference.digest} : {}),
          ...(hasAppearance(s) && byId('appearance').value.trim() ? {appearance:byId('appearance').value.trim(),expectedAppearance:s.savedAppearance} : {}),
          ...(s.chatText?{kind:s.kind,fromChat:true,chatText:s.chatText}:{})});
        if (!currentEditor(s)) return;
        if (result?.ok !== true) {
          if (result?.ok === false && ['image_auth','image_forbidden'].includes(result.code)) s.repairCode = result.code;
          throw result;
        }
        if (typeof result.draftId !== 'string' || !result.draftId) throw {code:'invalid_image'};
        await checkImage(result); if (!currentEditor(s)) return;
        s.draft = {preview:result.preview,id:result.draftId,historySaved:result.historySaved};
        notice(''); focus = result.historySaved===false ? byId('history-retry') : byId('figure');
        if (s.chatAction==='generate') {s.onUsed?.(); s.onUsed=null;}
      } else if (action === 'history-retry') {
        if (s.draft?.historySaved !== false) return;
        const result = await window.arcade.characterStickerRetryHistory({...s.binding,draftId:s.draft.id});
        if (!currentEditor(s)) return;
        if (result?.ok !== true || result.historySaved !== true) throw result;
        s.draft.historySaved = true;
        notice('historySaved'); focus = byId('figure');
      } else if (action === 'save') {
        const name = nameOf(byId('name').value);
        const result = await window.arcade.characterStickerSave({...s.binding,draftId:s.draft.id,name});
        if (!currentEditor(s)) return;
        if (result?.ok !== true) throw result;
        s.draft.saved = true; s.draft.name = result.name;
        byId('search').value = result.name; notice('saved',result.name); focus = byId('find');
      } else {
        const result = await window.arcade.characterStickerLookup({...s.binding,name:nameOf(byId('search').value)});
        if (!currentEditor(s)) return;
        if (result?.ok !== true) throw result;
        await checkImage(result); if (!currentEditor(s)) return;
        s.found = {name:result.name,preview:result.preview}; notice('lookupResult',result.name);
        if (fromGallery) focus = byId('figure');
        if (s.chatAction==='lookup') {s.onUsed?.(); s.onUsed=null;}
      }
    } catch (error) {
      if (!currentEditor(s)) return;
      if (action === 'generate') void discard(s);
      notice(Object.hasOwn(words[lang],error?.code) ? error.code : 'failed');
      if (action === 'generate' && s.repairCode && current.canGenerate) focus = byId('connect');
      if (action === 'save') focus = byId('name');
    } finally {
      if (currentEditor(s)) {s.pending=false;draw(); if(focus) focus.focus({preventScroll:false});}
    }
  }
  for (const [id, action] of [['generate-form','generate'],['name-fields','save'],['find-fields','lookup']]) {
    byId(id).onsubmit = e => {e.preventDefault(); void act(action);};
  }
  for (const key of ['prompt','name','search']) byId(key).oninput = () => {
    const value = nameOf(byId(key).value);
    const issue = key === 'prompt' ? (length(value)>500 ? 'invalid_request' : '') : (value && !validName(value) ? 'invalid_name' : '');
    notice(issue); draw();
  };
  byId('model').onchange = draw;
  byId('reference-mode').onchange = event => {
    if (editor && !editor.pending) void loadReference(editor,event.target.value === 'text');
  };
  byId('appearance').oninput = () => {notice(''); draw();};
  byId('remember').onclick = () => { void saveAppearance(false); };
  byId('forget').onclick = () => { void saveAppearance(true); };
  function mode(next) {
    const s = editor; if (!s || s.pending || s.mode === next && (next !== 'find' || s.galleryShown)) return;
    if (next === 'find') s.galleryShown = true;
    if (next === 'find' && byId('name').value.trim()) byId('search').value = nameOf(byId('name').value);
    s.mode = next; notice(''); draw(); (next === 'find' ? byId('search') : byId('prompt')).focus();
    if (next === 'find') void loadGallery(s);
    else {void loadAppearance(s);void loadReference(s);}
  }
  function leaveKeySetup() {
    if (!editor || editor.pending) return;
    if(editor.groupSetup){close();return;}
    resetImageFields(); editor.keySetup = false; notice(''); draw();
    if (!byId('provider').hidden) byId('connect').focus();
    else (editor.mode === 'create' ? byId('prompt') : byId('search')).focus();
  }
  byId('connect').onclick = () => {
    if (!editor || editor.pending) return;
    resetImageFields();editor.keySetup = true;
    editor.setupProvider = current.provider || (current.canGenerate?'openai':'cloudflare');
    notice('');draw();byId('image-provider').focus();
  };
  byId('key-cancel').onclick = leaveKeySetup;
  byId('image-provider').onchange = event=>{
    if(!editor?.keySetup||editor.groupSetup)return;
    editor.setupProvider=event.target.value;resetImageFields();notice('');draw();
  };
  byId('key').oninput=byId('account-id').oninput=()=>draw();
  byId('provider-guide').onclick=async()=>{
    const s=editor;
    try{await window.arcade.providerGuide('cloudflare-workers-ai');}
    catch{if(currentEditor(s)&&s.keySetup){notice('guideUnavailable');draw();}}
  };
  byId('key-form').onsubmit = async event => {
    event.preventDefault();
    const s = editor, field = byId('key');
    if (!currentEditor(s) || !s.keySetup || byId('save-key').disabled) return;
    if(s.groupSetup&&!s.groupSetup.isCurrent()){close(false);return;}
    const provider=s.setupProvider,cloudflare=provider==='cloudflare',previous=current?.provider;
    const key=field.value.trim(),cloudflareAccountId=byId('account-id').value.trim().toLowerCase();
    const select=!s.groupSetup&&provider!==current.provider&&providerInfo(provider)?.ready===true&&!key&&!cloudflareAccountId;
    if (!select && cloudflare && !/^[a-f0-9]{32}$/u.test(cloudflareAccountId)) {
      notice('invalid_account_id');byId('account-id').focus();return;
    }
    if (!select && (!key || window.ArcadeFirstRun?.keyProblem(key,lang === 'zh'))) {
      notice('invalid_key'); field.focus(); return;
    }
    resetImageFields();
    s.pending = true; notice('savingKey'); draw();
    try {
      if(s.groupSetup){
        const result=await s.groupSetup.save(cloudflare?{cloudflareAccountId,apiToken:key}:{key});
        if(!currentEditor(s))return;
        if(!result?.ok)throw result;
        close();return;
      }
      const request = {...s.binding,provider};
      if(select)request.select=true;
      else if(cloudflare)Object.assign(request,{cloudflareAccountId,apiToken:key});
      else {
        request.key=key;
        if(s.repairCode&&current.provider==='openai')request.repair=true;
      }
      const reply = await window.arcade.characterStickerConfigureImages(request);
      if (!currentEditor(s)) return;
      if (!reply?.ok || !reply.providers?.some(option=>option.id===provider&&option.ready)) throw reply;
      const {provider:active,providers,models,defaultModel,canGenerate}=reply;
      current = {...current,provider:active,providers,models,defaultModel,canGenerate};
      if(active!==provider){notice('providerStored');return;}
      if(active!==previous)s.draft=null;
      s.keySetup = false; s.repairCode = ''; s.mode = 'create'; notice(select?'providerChanged':'keySaved');
      void loadAppearance(s);
      void loadReference(s);
    } catch (error) {
      if (!currentEditor(s)) return;
      if (s.repairCode && error?.code === 'changed') {s.keySetup = false; s.repairCode = '';}
      notice(error?.code === 'storage_unavailable' ? 'keyStorageFailed' : Object.hasOwn(words[lang],error?.code) ? error.code : 'failed');
    } finally {
      if (currentEditor(s)) {
        s.pending = false; draw();
        (s.keySetup ? (field.hidden ? byId('save-key') : cloudflare ? byId('account-id') : field) :
          byId('generate').disabled ? byId('prompt') : byId('generate')).focus();
      }
    }
  };
  byId('history-retry').onclick = () => { void act('history-retry'); };
  byId('gallery-items').onclick = event => {
    const button = event.target.closest('button[data-name]');
    if (!button || button.disabled || !currentEditor(editor) || editor.mode !== 'find') return;
    byId('search').value = button.dataset.name; draw(); void act('lookup',true);
  };
  byId('gallery-refresh').onclick = () => { if (editor) void loadGallery(editor,editor.galleryPhase === 'error' ? editor.galleryRetryAfter : null); };
  byId('gallery-more').onclick = () => { if (editor?.galleryAfter) void loadGallery(editor,editor.galleryAfter); };
  byId('gallery-create').onclick = () => mode('create');
  byId('create').onclick = () => mode('create'); byId('find').onclick = () => mode('find');
  byId('report-open').onclick = () => {
    const source = editor;
    if (!source || source.pending || !window.ArcadeShell?.reportImage) return;
    dlg.close();
    window.ArcadeShell.reportImage(() => {
      if (editor !== source) return;
      dlg.showModal();
      byId('report-open').focus();
    });
  };
  byId('close').onclick = () => close();
  dlg.addEventListener('cancel',event => {event.preventDefault();if(editor?.groupSetup&&editor.pending)return;if (editor?.keySetup && !editor.pending) leaveKeySetup(); else close();});
  entry.onclick = () => open();
  window.ArcadeCharacterSticker = {openFromChat:open,openGroupCredentials,closeGroupCredentials(origin){
    if(editor?.groupSetup&&editor.origin===origin)close(false);
  },update(snapshot) {
    const s = snapshot?.characterSticker, previous = current, oldLang = lang, nextLang = snapshot?.config?.language === 'zh' ? 'zh' : 'en';
    const available = ['Generate','Save','Lookup','Discard'].every(method => typeof window.arcade?.['characterSticker'+method] === 'function');
    current = document.body.dataset.view === 'bot' && available && s?.scopeId && s?.accountId === snapshot.accounts?.selectedId
      ? {...s,models:Array.isArray(s.models) ? [...s.models] : [],
        profileName:snapshot.accounts.accounts?.find(profile=>profile.id===s.accountId)?.name || s.accountId} : null;
    entry.hidden = !current;
    lang = nextLang; entry.textContent = tr('entry');
    if(editor?.groupSetup){
      if(editor.groupSetup.profileId!==snapshot.accounts?.selectedId||!editor.groupSetup.isCurrent())close(false);
      else if(oldLang!==nextLang)draw();
      return;
    }
    if (editor && (!current || editor.binding.scopeId !== current.scopeId || editor.binding.accountId !== current.accountId)) close(false);
    if (editor && (oldLang !== lang || previous.roleName !== current.roleName || previous.profileName !== current.profileName ||
        previous.roleKind !== current.roleKind || previous.hasImageAppearance !== current.hasImageAppearance || previous.canGenerate !== current.canGenerate ||
        previous.provider !== current.provider || JSON.stringify(previous.providers) !== JSON.stringify(current.providers) ||
        previous.defaultModel !== current.defaultModel || JSON.stringify(previous.models) !== JSON.stringify(current.models))) draw();
  }};
  addEventListener('pagehide',()=>close(false));
})();
