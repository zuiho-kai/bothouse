'use strict';
// Immersive layout: stage artwork, name plate and the folded companion / conversation control
// around the existing chat DOM (bot.js and desktop-chat.js keep producing it). Nothing here
// changes behaviour: nodes are moved in on mount and moved back on unmount, ids stay the same.
(() => {
  if(!window.ArcadeLayouts)return;
  const theme=window.ArcadeTheme,shell=window.ArcadeShell;
  const backdrop=el('div','imm-backdrop'),backdropImage=el('img','');backdrop.setAttribute('aria-hidden','true');backdropImage.alt='';backdrop.append(backdropImage);
  const art=el('div','imm-art');art.id='imm-art';
  const figures=el('div','imm-figures');figures.setAttribute('aria-hidden','true');
  // The name is already the page's <h1>; the plate repeats it visually only.
  const plate=el('div','imm-nameplate'),kicker=el('span','imm-nameplate-kicker'),name=el('strong',''),sub=el('span','imm-nameplate-sub');plate.setAttribute('aria-hidden','true');plate.append(kicker,name,sub);
  art.append(figures,plate);
  const control=el('div','imm-control');control.id='imm-control';
  const companion=el('div','imm-companion'),chip=el('button','imm-chip'),chipImage=el('img',''),chipText=el('span','imm-chip-text'),chipName=el('strong',''),chipState=el('small','');
  chip.type='button';chip.id='imm-companion-toggle';chip.setAttribute('aria-haspopup','true');chip.setAttribute('aria-expanded','false');chipImage.alt='';chipText.append(chipName,chipState);
  chip.append(chipImage,chipText,shell.icon(['m6 9 6 6 6-6'],'0 0 24 24',16));companion.append(chip);control.append(companion);
  let mounted=false,switcherHome=null,artKey='',token=0,tileObserver=null,tileKey='';
  const switcher=()=>document.getElementById('companion-switcher');
  const setOpen=(open,focus)=>{companion.dataset.open=String(open);chip.setAttribute('aria-expanded',String(open));if(!open&&focus)chip.focus({preventScroll:true});};
  chip.onclick=()=>{const open=companion.dataset.open!=='true';setOpen(open);if(open)switcher()?.querySelector('.companion-tab[aria-pressed=true],.companion-tab,button')?.focus({preventScroll:true});};
  companion.addEventListener('keydown',event=>{if(event.key==='Escape'&&companion.dataset.open==='true'){event.stopPropagation();setOpen(false,true);}});
  companion.addEventListener('focusout',event=>{if(event.relatedTarget&&!companion.contains(event.relatedTarget))setOpen(false);});
  companion.addEventListener('click',event=>{if(event.target.closest('.companion-switcher button'))setOpen(false);});
  document.addEventListener('pointerdown',event=>{if(mounted&&!companion.contains(event.target))setOpen(false);});

  const hueOf=text=>{let n=2166136261;for(const ch of String(text||'?')){n^=ch.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0)%360;};
  const monogram=(text,seed)=>{const node=el('span','imm-monogram',(text||'?').trim().slice(0,1));node.style.setProperty('--fig-h',String(hueOf(seed||text)));return node;};
  // A library character's poster: thumbnail first, then the large portrait; a monogram without one.
  function poster(member,max,mine,onImage){
    const figure=el('figure','imm-figure imm-card');figure.dataset.memberId=member.id;figure.append(monogram(member.name,member.name||member.id)); // same seed as the accent theme.js derives for a character without a portrait
    const show=(url,final)=>{if(mine!==token||!url)return;let image=figure.querySelector('img');if(!image){image=el('img','');image.alt='';figure.replaceChildren(image);}image.onload=()=>{if(image.naturalWidth&&image.naturalHeight)figure.style.setProperty('--ratio',`${image.naturalWidth}/${image.naturalHeight}`);};image.src=url;if(final)onImage?.(url);};
    theme.thumb(member.id).then(url=>{if(!figure.querySelector('img'))show(url,false);});
    theme.portrait(member.id,max).then(url=>show(url,true));
    return figure;
  }
  function drawArt(data,context){
    const who=context.target,anime=(data.config?.portrait||'anime')==='anime';
    const key=JSON.stringify([who.kind,who.id,who.portrait,who.members.map(m=>[m.id,m.name]),anime,who.name]);
    if(key!==artKey){
      artKey=key;const mine=++token;art.dataset.kind=who.kind;backdropImage.removeAttribute('src');
      if(who.kind==='persona'){
        if(anime&&who.portrait){const figure=el('figure','imm-figure imm-bust'),image=el('img','');image.alt='';image.src=who.portrait;figure.append(image);figures.replaceChildren(figure);backdropImage.src=who.portrait;}
        else figures.replaceChildren();
      }else if(who.kind==='character')figures.replaceChildren(poster({id:who.id,name:who.name},1200,mine,url=>{backdropImage.src=url;}));
      else{const shown=who.members.slice(0,3);art.dataset.count=String(shown.length);figures.replaceChildren(...shown.map((member,index)=>poster(member,720,mine,index===0?url=>{backdropImage.src=url;}:null)));}
      if(who.kind!=='group')delete art.dataset.count;
    }
    if(who.kind==='group'){
      const local=data.bot?.local,speaker=local?.streaming?.speakerId||[...(local?.history||[])].reverse().find(m=>m.role==='assistant'&&m.speakerId)?.speakerId||null;
      for(const figure of figures.children)figure.classList.toggle('is-speaker',figure.dataset.memberId===speaker);
    }
    const members=who.kind==='group'?who.members.map(m=>m.name).join(context.zh?'、':', '):'';if(sub.textContent!==members)sub.textContent=members;
    drawPlate();
  }
  // The plate mirrors the heading that bot.js / desktop-chat.js maintain (they also rename it after their own IPC).
  const heading=document.querySelector('#bot-view .chat-identity');
  function drawPlate(){
    const title=heading?.querySelector('[data-bot="title"]')?.textContent||'',note=heading?.querySelector('[data-bot="inboxNote"]')?.textContent||'';
    if(name.textContent!==title)name.textContent=title;if(kicker.textContent!==note)kicker.textContent=note;
  }
  if(heading)new MutationObserver(()=>{if(mounted)drawPlate();}).observe(heading,{childList:true,subtree:true,characterData:true});
  function drawChip(data,context){
    const bar=switcher();if(!bar)return;
    companion.hidden=bar.hidden;
    const selected=bar.querySelector('.companion-tab[aria-pressed=true]'),image=selected?.querySelector('img')?.getAttribute('src')||'';
    const title=context.target?.name||selected?.querySelector('strong')?.textContent||context.tr('搭档','Companion'),state=context.tr('切换搭档 / 内置角色','Switch companion / role');
    if(chipName.textContent!==title)chipName.textContent=title;if(chipState.textContent!==state)chipState.textContent=state;
    if(image){if(chipImage.getAttribute('src')!==image)chipImage.src=image;}else chipImage.removeAttribute('src');
    const text=context.tr(`当前搭档：${title}。切换或管理搭档`,`Current companion: ${title}. Switch or manage companions`);if(chip.getAttribute('aria-label')!==text){chip.setAttribute('aria-label',text);chip.title=context.tr('切换或管理搭档','Switch or manage companions');}
    const choice=document.getElementById('desktop-conversation-choice');if(choice&&choice.parentNode!==control)control.append(choice);
  }
  // Library tiles: give each a hue of its own and swap the 128px thumbnail for a sharper portrait once visible.
  function drawTiles(){
    const grid=document.querySelector('#characters-view .characters-grid');if(!grid)return;
    const cards=[...grid.querySelectorAll('.characters-card')],key=cards.map(card=>card.dataset.characterId).join();
    for(const card of cards)if(!card.style.getPropertyValue('--tile-h'))card.style.setProperty('--tile-h',String(hueOf(card.querySelector('strong')?.textContent||card.dataset.characterId)));
    if(key===tileKey&&cards.every(card=>card.dataset.immTile))return;tileKey=key;
    tileObserver?.disconnect();
    tileObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const card=entry.target;tileObserver.unobserve(card);const image=card.querySelector('.characters-portrait img');if(!image)continue;theme.portrait(card.dataset.characterId,560).then(url=>{if(url&&image.isConnected&&mounted)image.src=url;});}},{rootMargin:'200px'});
    for(const card of cards){card.dataset.immTile='true';tileObserver.observe(card);}
  }
  window.ArcadeLayouts.register('immersive',{
    mount(){
      const view=document.getElementById('bot-view'),bar=switcher();if(!view)return;
      mounted=true;artKey='';tileKey='';
      view.prepend(backdrop,art,control);
      if(bar){switcherHome=document.createComment('companion-switcher');bar.before(switcherHome);companion.append(bar);}
    },
    unmount(){
      mounted=false;token++;setOpen(false);tileObserver?.disconnect();tileObserver=null;
      const bar=switcher(),choice=document.getElementById('desktop-conversation-choice'),thread=document.getElementById('bot-thread-scroll');
      if(bar&&switcherHome?.parentNode){switcherHome.replaceWith(bar);}switcherHome=null;
      if(choice&&thread&&choice.parentNode===control)thread.parentNode.insertBefore(choice,thread);
      backdrop.remove();art.remove();control.remove();
      for(const card of document.querySelectorAll('.characters-card[data-imm-tile]'))delete card.dataset.immTile;
    },
    render(data,context){
      if(!mounted)return;
      if(context.view==='bot'){drawChip(data,context);drawArt(data,context);}
      else if(context.view==='characters')drawTiles();
    },
  });
  // The library grid is redrawn by characters.js outside the render loop (after its own IPC).
  new MutationObserver(()=>{if(mounted&&document.body.dataset.view==='characters')drawTiles();}).observe(document.getElementById('characters-view')||document.body,{childList:true,subtree:true});
  if(typeof data!=='undefined'&&data)render();
})();
