'use strict';
// Small DOM helpers shared by the Notes page, the Tasks page and the dispatcher card.
// Text always goes through textContent; nothing here parses HTML.
window.ArcadeKit=(()=>{
  function field(labelText,control,id,hint){
    const wrap=el('label','st-field');control.id=id;wrap.htmlFor=id;wrap.append(el('span','',labelText),control);
    if(hint){const note=el('small','st-hint',hint);note.id=id+'-hint';control.setAttribute('aria-describedby',note.id);wrap.append(note);}
    return wrap;
  }
  function check(labelText,id){const wrap=el('label','st-check'),box=el('input','');box.type='checkbox';box.id=id;wrap.htmlFor=id;wrap.append(box,el('span','',labelText));return {wrap,box};}
  function button(cls,text,run){const b=el('button',cls,text);b.type='button';if(run)b.onclick=run;return b;}
  function input(max,value=''){const node=el('input','');node.type='text';node.maxLength=max;node.autocomplete='off';node.spellcheck=false;node.value=value;return node;}
  function area(max,rows,value=''){const node=el('textarea','');node.maxLength=max;node.rows=rows;node.value=value;return node;}
  function select(options,value){const node=el('select','');node.append(...options.map(([id,text])=>{const o=el('option','',text);o.value=id;return o;}));if(value!==undefined)node.value=value;return node;}
  // Status line: {node, say(text, isError)}
  function status(cls='st-status'){const node=el('span',cls);node.setAttribute('role','status');return {node,say(text,error=false){node.textContent=text||'';node.dataset.error=String(!!error);}};}
  // A destructive button asks for a second click; leaving it disarms it.
  function twoClick(node,armedText,run){
    let idle='',armed=false;
    const reset=()=>{if(!armed)return;armed=false;node.textContent=idle;node.removeAttribute('data-armed');};
    node.addEventListener('blur',reset);
    node.onclick=()=>{if(!armed){idle=node.textContent;armed=true;node.textContent=armedText;node.dataset.armed='true';return;}reset();run();};
    return node;
  }
  // Tabs with arrow-key movement. names: [[id, panelNode]]. Returns {node, select(id), label(id,text), current()}.
  function tabs(prefix,entries,onSelect){
    const node=el('div','relationship-tabs kit-tabs');node.setAttribute('role','tablist');
    const rows=entries.map(([id,panel])=>{
      const tab=button('','');tab.id=`${prefix}-tab-${id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',`${prefix}-panel-${id}`);
      panel.id=`${prefix}-panel-${id}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.classList.add('kit-panel');
      tab.onclick=()=>select(id,true);node.append(tab);return {id,tab,panel};
    });
    let chosen=rows[0].id;
    function select(id,notify=false){
      if(!rows.some(row=>row.id===id))return;chosen=id;
      for(const row of rows){const on=row.id===id;row.tab.setAttribute('aria-selected',String(on));row.tab.tabIndex=on?0:-1;row.panel.hidden=!on;}
      if(notify)onSelect?.(id);
    }
    node.addEventListener('keydown',event=>{
      const index=rows.findIndex(row=>row.tab===document.activeElement);if(index<0)return;
      const step={ArrowRight:1,ArrowLeft:-1}[event.key],to=event.key==='Home'?0:event.key==='End'?rows.length-1:step?(index+step+rows.length)%rows.length:-1;
      if(to<0)return;event.preventDefault();select(rows[to].id,true);rows[to].tab.focus();
    });
    select(chosen);
    return {node,select,current:()=>chosen,label(id,text){const row=rows.find(item=>item.id===id);if(row&&row.tab.textContent!==text)row.tab.textContent=text;}};
  }
  function stamp(at,zh){return Number.isFinite(at)&&at>0?new Date(at).toLocaleString(zh?'zh-CN':'en',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';}
  function ago(at,zh,now=Date.now()){
    if(!Number.isFinite(at)||at<=0)return '';
    const minutes=Math.max(0,Math.floor((now-at)/60000));
    if(minutes<1)return zh?'不到 1 分钟前':'under a minute ago';
    if(minutes<60)return zh?`${minutes} 分钟前`:`${minutes} min ago`;
    const hours=Math.floor(minutes/60);if(hours<48)return zh?`${hours} 小时前`:`${hours} h ago`;
    const days=Math.floor(hours/24);return zh?`${days} 天前`:`${days} days ago`;
  }
  const codeOf=value=>typeof value?.code==='string'?value.code:/\(([a-z_]+)\)\.?$/.exec(value?.message||'')?.[1]||'';
  // {ok:false,code} and thrown errors are reported the same way: the call resolves to {ok:false,code}.
  async function call(fn){try{const result=await fn();return result&&typeof result==='object'?result:{ok:false,code:'internal'};}catch(error){return {ok:false,code:codeOf(error)||'internal'};}}
  return Object.freeze({field,check,button,input,area,select,status,twoClick,tabs,stamp,ago,codeOf,call});
})();
