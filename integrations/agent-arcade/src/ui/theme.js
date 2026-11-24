'use strict';
// Foundation for every interface layout.
//
//  window.ArcadeTheme
//    apply(data)            called first in app.js render(): writes the colour tokens for the
//                           resolved accent (light and dark) and sets html[data-layout|data-accent-mode].
//    palette(hex, scheme)   pure: one accent colour -> the full token set for 'light' or 'dark'.
//    selfTest()             pure: contrast check of the token set for extreme accents.
//    target(data)           who the chat is with: {kind:'persona'|'character'|'group', id, name,
//                           portrait (built-in URL or ''), members:[{id,name}]}.
//    thumb(id)              Promise<data URL|''>: a library character's small portrait, cached.
//    portrait(id, max)      Promise<data URL|''>: the large portrait, scaled to `max` px tall, cached.
//    accent()               the accent hex currently applied.
//    PRESETS, PERSONA_ACCENTS
//  window.ArcadeLayouts
//    register(name, {mount(ctx), unmount(ctx), render(data, ctx)})   one object per layout file.
//    render(data, ctx)      called by shell.js at the end of every render.
//
// Colours are computed in OKLCH. No colour here encodes a provider or a status.
(() => {
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  // ---- colour math (sRGB <-> OKLab/OKLCH) ----
  const toLinear=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
  const toGamma=v=>v<=0.0031308?12.92*v:1.055*v**(1/2.4)-0.055;
  const parseHex=hex=>{const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||'').trim());if(!m)return null;const n=parseInt(m[1],16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];};
  const hexOf=rgb=>'#'+rgb.map(v=>Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
  function rgbToOklab([r,g,b]){
    r=toLinear(r);g=toLinear(g);b=toLinear(b);
    const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
    return [0.2104542553*l+0.7936177850*m-0.0040720468*s,1.9779984951*l-2.4285922050*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.8086757660*s];
  }
  function oklabToLinear([L,a,b]){
    const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.2914855480*b)**3;
    return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];
  }
  const rgbToOklch=rgb=>{const [L,a,b]=rgbToOklab(rgb);return {l:L,c:Math.hypot(a,b),h:(Math.atan2(b,a)*180/Math.PI+360)%360};};
  const inGamut=lin=>lin.every(v=>v>=-0.0005&&v<=1.0005);
  // OKLCH -> sRGB hex; chroma is reduced until the colour exists in sRGB.
  function oklch(l,c,h){
    l=clamp(l,0,1);const rad=h*Math.PI/180,at=k=>oklabToLinear([l,k*Math.cos(rad),k*Math.sin(rad)]);
    let lin=at(c);
    if(!inGamut(lin)){let lo=0,hi=c;for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(inGamut(at(mid)))lo=mid;else hi=mid;}lin=at(lo);}
    return hexOf(lin.map(v=>toGamma(clamp(v,0,1))));
  }
  const luminance=hex=>{const [r,g,b]=parseHex(hex).map(toLinear);return 0.2126*r+0.7152*g+0.0722*b;};
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
  // Move lightness in one direction until the colour reads on every background.
  function readable(l,c,h,step,against,min=4.5){
    let colour=oklch(l,c,h);
    for(let i=0;i<200&&against.some(bg=>contrast(colour,bg)<min);i++){l=clamp(l+step,0.02,0.995);colour=oklch(l,c,h);}
    return colour;
  }

  // ---- one accent -> all tokens ----
  function palette(hex,scheme){
    const rgb=parseHex(hex)||parseHex('#b45a86'),src=rgbToOklch(rgb),grey=src.c<0.025,h=src.h,dark=scheme==='dark';
    const c=grey?0:clamp(src.c,0.06,0.19),tint=k=>grey?0:k;
    const bg=dark?oklch(0.165,tint(0.012),h):oklch(0.962,tint(0.010),h);
    const surface=dark?oklch(0.212,tint(0.014),h):oklch(0.993,tint(0.004),h);
    const surface2=dark?oklch(0.256,tint(0.017),h):oklch(0.936,tint(0.015),h);
    const line=dark?oklch(0.335,tint(0.018),h):oklch(0.882,tint(0.014),h);
    const lineStrong=dark?oklch(0.44,tint(0.022),h):oklch(0.80,tint(0.020),h);
    const soft=dark?oklch(0.31,Math.min(c*0.45,0.07),h):oklch(0.93,Math.min(c*0.4,0.05),h);
    const grounds=[bg,surface,surface2,soft];
    const text=readable(dark?0.94:0.25,tint(dark?0.008:0.018),h,dark?0.01:-0.01,grounds,7);
    const muted=readable(dark?0.74:0.5,tint(0.018),h,dark?0.01:-0.01,grounds);
    // Light: a deeper fill under white. Dark: a lighter fill under dark ink. Either way the
    // fill itself stays visible against the page, so it also works for outlines and markers.
    const onAccent=dark?oklch(0.19,tint(0.03),h):'#ffffff';
    const accent=readable(dark?clamp(src.l,0.74,0.84):clamp(src.l,0.42,0.6),c,h,dark?0.005:-0.005,[onAccent]);
    const accentL=rgbToOklch(parseHex(accent)).l;
    const accentHover=readable(accentL+(dark?0.05:-0.05),c,h,dark?0.005:-0.005,[onAccent]);
    const accentInk=readable(dark?0.82:0.46,Math.min(c,0.15),h,dark?0.005:-0.005,grounds);
    const accentLine=dark?oklch(0.5,Math.min(c*0.6,0.09),h):oklch(0.79,Math.min(c*0.6,0.09),h);
    // Decorative tones for atmospheric backgrounds; never used under text without a surface.
    const tone1=dark?oklch(0.30,Math.min(c,0.085),h):oklch(0.90,Math.min(c,0.07),h);
    const tone2=dark?oklch(0.25,Math.min(c,0.07),(h+38)%360):oklch(0.93,Math.min(c,0.055),(h+38)%360);
    const tone3=dark?oklch(0.22,Math.min(c,0.06),(h+322)%360):oklch(0.95,Math.min(c,0.045),(h+322)%360);
    return {'--accent':accent,'--accent-hover':accentHover,'--on-accent':onAccent,'--accent-soft':soft,'--accent-line':accentLine,'--accent-ink':accentInk,
      '--bg':bg,'--surface':surface,'--surface-2':surface2,'--line':line,'--line-strong':lineStrong,'--text':text,'--muted':muted,
      '--tone-1':tone1,'--tone-2':tone2,'--tone-3':tone3,'--accent-h':String(Math.round(h)),'--accent-c':(grey?0:Math.min(c,0.16)).toFixed(3)};
  }
  const EXTREMES=['#ffff00','#000000','#ffffff','#808080','#ff0000','#00ff00','#0000ff','#00ffff','#ff00ff','#ff8a00','#fefefe','#010101','#e8752a','#8f63c9','#2d5bd0'];
  function selfTest(inputs=EXTREMES){
    const failures=[],rows=[];
    for(const hex of inputs)for(const scheme of ['light','dark']){
      const p=palette(hex,scheme),pairs=[['--on-accent','--accent'],['--on-accent','--accent-hover']];
      for(const ground of ['--bg','--surface','--surface-2','--accent-soft'])pairs.push(['--text',ground],['--muted',ground],['--accent-ink',ground]);
      let worst=99;
      for(const [fg,bg] of pairs){const ratio=contrast(p[fg],p[bg]);worst=Math.min(worst,ratio);if(ratio<4.5)failures.push(`${hex} ${scheme} ${fg} on ${bg}: ${ratio.toFixed(2)}`);}
      const edge=contrast(p['--accent'],p['--bg']);if(edge<3)failures.push(`${hex} ${scheme} --accent against --bg: ${edge.toFixed(2)}`);
      rows.push({hex,scheme,accent:p['--accent'],worst:Number(worst.toFixed(2)),edge:Number(edge.toFixed(2))});
    }
    return {ok:failures.length===0,failures,rows};
  }
  const pure={palette,selfTest,contrast,oklch,toOklch:hex=>{const rgb=parseHex(hex);return rgb?rgbToOklch(rgb):null;}};
  if(typeof module!=='undefined'&&module.exports){module.exports=pure;}
  if(typeof window==='undefined'||typeof document==='undefined')return;

  // ---- accents per character ----
  // Built-in personas: fixed hues read from their artwork (hair, horns, fins, flower knot).
  const PERSONA_ACCENTS={'claude-ju':'#e8752a','codex-dragon':'#8f63c9','deepseek-whale':'#2d5bd0','gemini-cat':'#d672ad','doubao-girl':'#d4493f',sprout:'#3aa67a'};
  const PRESETS=['#e8752a','#d4493f','#d672ad','#8f63c9','#2d5bd0','#1f9bb0','#3aa67a','#8a8f98'];
  const hashHue=name=>{let n=2166136261;for(const ch of String(name||'?')){n^=ch.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0)%360;};
  const fromHue=(h,c=0.13)=>oklch(0.62,c,h);
  const hues=new Map(),thumbs=new Map(),portraits=new Map();
  let last=null,applied='',lastAccent='#b45a86';
  const validData=url=>typeof url==='string'&&/^data:image\//.test(url);
  const loadImage=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});
  // Saturation-weighted mean hue of a small portrait. Near-white, near-black, transparent and
  // skin-like pixels carry little information about the character's colour and are down-weighted.
  async function hueFromImage(url){
    const image=await loadImage(url),size=40,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,size,size);
    const pixels=context.getImageData(0,0,size,size).data;let x=0,y=0,weight=0,chroma=0;
    for(let i=0;i<pixels.length;i+=4){
      if(pixels[i+3]<128)continue;
      const p=rgbToOklch([pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255]);
      if(p.l>0.93||p.l<0.16||p.c<0.03)continue;
      const skin=p.h>35&&p.h<85&&p.c<0.09&&p.l>0.62;
      const w=p.c**1.5*(skin?0.15:1);
      x+=Math.cos(p.h*Math.PI/180)*w;y+=Math.sin(p.h*Math.PI/180)*w;weight+=w;chroma+=p.c*w;
    }
    if(weight<0.4||Math.hypot(x,y)/weight<0.18)return null; // too little colour, or no dominant hue
    return fromHue((Math.atan2(y,x)*180/Math.PI+360)%360,clamp(chroma/weight*1.15,0.08,0.16));
  }
  function thumb(id){
    if(!id||typeof window.arcade?.charactersGet!=='function')return Promise.resolve('');
    if(!thumbs.has(id))thumbs.set(id,window.arcade.charactersGet(id).then(card=>validData(card?.thumb)?card.thumb:'').catch(()=>{thumbs.delete(id);return '';}));
    return thumbs.get(id);
  }
  function portrait(id,max=1200){
    if(!id||typeof window.arcade?.charactersPortrait!=='function')return Promise.resolve('');
    const key=`${id}:${max}`;
    if(!portraits.has(key)){
      if(portraits.size>24)portraits.delete(portraits.keys().next().value);
      portraits.set(key,Promise.resolve(window.arcade.charactersPortrait(id)).then(async url=>{
        if(!validData(url))return '';
        if(max>=1200)return url;
        const image=await loadImage(url);if(image.naturalHeight<=max)return url;
        const canvas=document.createElement('canvas');canvas.height=max;canvas.width=Math.max(1,Math.round(image.naturalWidth*max/image.naturalHeight));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/webp',0.86);
      }).catch(()=>{portraits.delete(key);return '';}));
    }
    return portraits.get(key);
  }
  document.addEventListener('arcade-library-changed',()=>{thumbs.clear();portraits.clear();hues.clear();if(last)apply(last);});
  function characterAccent(id,name){
    const known=hues.get(id);
    if(typeof known==='string')return known;
    if(!known){
      hues.set(id,'pending');
      thumb(id).then(url=>url?hueFromImage(url):null).catch(()=>null).then(hex=>{hues.set(id,hex||fromHue(hashHue(name||id)));if(last)apply(last);});
    }
    return fromHue(hashHue(name||id));
  }
  function target(data){
    const st=data?.bot?.st,local=data?.bot?.local,app=data?.desktopChat?.kind==='local';
    const groupId=app?local?.libraryGroupId||(st?.available?st.settings?.groupId:null)||null:null;
    if(groupId){const members=Array.isArray(st?.group?.members)&&st.group.id===groupId?st.group.members.map(m=>({id:m.id,name:m.name||''})):[];return {kind:'group',id:groupId,name:st?.group?.id===groupId?st.group.name||'':'',portrait:'',members};}
    const characterId=app?local?.libraryCharacterId||(st?.available?st.settings?.characterId:null)||null:null;
    if(characterId)return {kind:'character',id:characterId,name:st?.character?.id===characterId?st.character.name||'':'',portrait:'',members:[]};
    const persona=(app?(data?.personas||[]).find(p=>p.id===local?.characterId):null)||data?.persona||{id:'sprout',name:{zh:'小芽',en:'Sprout'},portrait:'portraits/sprout-anime.png'};
    const language=data?.config?.language==='zh'?'zh':'en',social=data?.bot?.social;
    const name=!app&&social?.config?.enabled&&social.supported&&social.config.name?.trim()||persona.name?.[language]||persona.name?.en||'';
    return {kind:'persona',id:persona.id,name,portrait:persona.portrait||'',members:[]};
  }
  function resolveAccent(data){
    const chosen=data?.config?.accent;
    if(typeof chosen==='string'&&/^#[0-9a-f]{6}$/i.test(chosen))return chosen.toLowerCase();
    const who=target(data);
    if(who.kind==='persona')return PERSONA_ACCENTS[who.id]||fromHue(hashHue(who.id));
    if(who.kind==='group'){const first=who.members[0];return first?characterAccent(first.id,first.name):fromHue(hashHue(who.name||who.id));}
    return characterAccent(who.id,who.name);
  }
  const sheet=document.createElement('style');sheet.id='arcade-theme-vars';
  // Presentation memory only; unavailable storage simply means no memory.
  const remember=(key,value)=>{try{if(value===undefined)return localStorage.getItem(key);localStorage.setItem(key,value);}catch{}return null;};
  const block=tokens=>Object.entries(tokens).map(([k,v])=>`${k}:${v}`).join(';');
  function apply(data){
    last=data;const root=document.documentElement,config=data?.config||{};
    // Before the first snapshot arrives, repeat the last session's layout and accent so the window does not flash.
    const layout=['immersive','messenger','minimal'].includes(config.layout)?config.layout:data?'immersive':remember('arcade.layout')||'immersive';
    if(root.dataset.layout!==layout){root.dataset.layout=layout;if(data)remember('arcade.layout',layout);}
    const mode=typeof config.accent==='string'&&config.accent!=='auto'?'custom':'auto';
    if(root.dataset.accentMode!==mode)root.dataset.accentMode=mode;
    const cached=data?null:remember('arcade.accent'),accent=data?resolveAccent(data):/^#[0-9a-f]{6}$/.test(cached||'')?cached:lastAccent;
    if(accent===applied)return;
    applied=lastAccent=accent;if(data)remember('arcade.accent',accent);
    // Both schemes are written at once; appearance.js only flips data-color-scheme.
    // The doubled :root outranks the static fallback in theme.css wherever this element sits.
    sheet.textContent=`html:root:root{${block(palette(accent,'light'))}}html:root:root[data-color-scheme="dark"]{${block(palette(accent,'dark'))}}`;
    if(!sheet.isConnected)document.head.append(sheet);
    document.dispatchEvent(new CustomEvent('arcade:accent',{detail:{accent}}));
  }
  window.ArcadeTheme=Object.freeze({...pure,apply,target,thumb,portrait,accent:()=>lastAccent,PRESETS,PERSONA_ACCENTS});

  // ---- layout registry ----
  const layouts=new Map();let mounted=null;
  window.ArcadeLayouts=Object.freeze({
    register(name,implementation){layouts.set(name,implementation||{});},
    render(data,context){
      const name=document.documentElement.dataset.layout,next=layouts.get(name)||null;
      if(mounted&&mounted.implementation!==next){try{mounted.implementation.unmount?.(context);}catch(error){console.error(error);}mounted=null;}
      if(next&&!mounted){mounted={name,implementation:next};try{next.mount?.(context);}catch(error){console.error(error);}}
      try{next?.render?.(data,context);}catch(error){console.error(error);}
    },
    get active(){return mounted?.name||null;},
  });
  apply(null);
})();
